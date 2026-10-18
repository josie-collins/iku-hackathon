-- ============================================================================
-- Wise Piggy: schema.sql  (Tier 1: the "spine")
-- Target: PostgreSQL 13+ (works on Tiger Cloud / TimescaleDB, plain Postgres too)
--
-- Conventions
--   * Money is ALWAYS integer minor units (pence, cents, kobo). Never floats.
--   * Currencies are ISO 4217 codes (char(3)).
--   * "base currency" = groups.base_currency. Budgets and expenses are converted
--     to it (using the saved Wise/fallback rate) so they can be compared.
--
-- PRIVACY MODEL (read this before writing any endpoint)
--   Private tables:  budgets, availability, resolution_prompts, daily_checkins,
--                    and expenses where type = 'personal'.
--   The Express server connects with ONE database role, so Postgres cannot
--   enforce "user A can't read user B's budget" on its own. The server must:
--     1. identify the caller from the session token on every request,
--     2. filter private rows with WHERE user_id = <caller>,
--     3. compute the hidden ceiling inside ONE server function that returns
--        only the shortlist, never budgets or the ceiling.
--   Use the v_member_public view for anything shown to the group.
--
-- Run order:  schema.sql -> seed.sql -> (optional) timescale.sql
-- Re-runnable: drops everything first. DO NOT run on a database with real data.
-- ============================================================================

DROP VIEW  IF EXISTS v_member_public CASCADE;
DROP TABLE IF EXISTS sample_trip_spend      CASCADE;
DROP TABLE IF EXISTS notifications          CASCADE;
DROP TABLE IF EXISTS trip_activity          CASCADE;
DROP TABLE IF EXISTS daily_checkins         CASCADE;
DROP TABLE IF EXISTS settlements            CASCADE;
DROP TABLE IF EXISTS expense_participants   CASCADE;
DROP TABLE IF EXISTS expenses               CASCADE;
DROP TABLE IF EXISTS resolution_prompts     CASCADE;
DROP TABLE IF EXISTS resolution_rounds      CASCADE;
DROP TABLE IF EXISTS votes                  CASCADE;
DROP TABLE IF EXISTS destination_options    CASCADE;
DROP TABLE IF EXISTS flight_quotes          CASCADE;
DROP TABLE IF EXISTS flight_estimates       CASCADE;
DROP TABLE IF EXISTS availability           CASCADE;
DROP TABLE IF EXISTS budgets                CASCADE;
DROP TABLE IF EXISTS group_members          CASCADE;
DROP TABLE IF EXISTS groups                 CASCADE;
DROP TABLE IF EXISTS destinations           CASCADE;
DROP TABLE IF EXISTS friendships            CASCADE;
DROP TABLE IF EXISTS users                  CASCADE;
DROP FUNCTION IF EXISTS check_expense_shares() CASCADE;

-- ----------------------------------------------------------------------------
-- Users
-- Auth is username + password (scrypt hash, see passwords.js), then the server
-- issues a signed session token. Usernames are stored lowercase.
-- ----------------------------------------------------------------------------
CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username         text        NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,20}$'),
  password_hash    text        NOT NULL,
  name             text        NOT NULL,
  home_currency    char(3)     NOT NULL,           -- e.g. GBP, NGN, EUR
  nationality      char(2),                        -- ISO 3166-1 alpha-2, for entry-requirement links
  departure_airport char(3),                       -- IATA code, for flights
  dietary_needs    text[]      NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Friendships: one row per pair, whoever asked first is the requester.
-- status 'pending' until the addressee accepts. Declining deletes the row.
-- ----------------------------------------------------------------------------
CREATE TABLE friendships (
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);
-- Only one row per pair, whichever direction it was sent in.
CREATE UNIQUE INDEX idx_friendships_pair
  ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX idx_friendships_addressee ON friendships (addressee_id);

-- ----------------------------------------------------------------------------
-- Destinations: SAMPLE cost data. Label it "sample data" in the UI and demo.
-- Costs are per person, in the destination row's base_currency.
-- ----------------------------------------------------------------------------
CREATE TABLE destinations (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city                         text    NOT NULL,
  country_code                 char(2) NOT NULL,
  tags                         text[]  NOT NULL DEFAULT '{}',   -- beach, culture, hiking, nightlife, ...
  base_currency                char(3) NOT NULL DEFAULT 'EUR',
  accommodation_pp_night_minor bigint  NOT NULL CHECK (accommodation_pp_night_minor >= 0), -- shared room, per person
  food_pp_day_minor            bigint  NOT NULL CHECK (food_pp_day_minor >= 0),
  activities_pp_day_minor      bigint  NOT NULL CHECK (activities_pp_day_minor >= 0),
  source                       text    NOT NULL DEFAULT 'sample',
  airport                      char(3),         -- IATA code for flight searches (NULL for day-hike spots)
  image_url                    text,            -- photo from Wikimedia Commons
  image_credit_url             text,            -- its Commons file page (author and licence)
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city, country_code)
);

-- ----------------------------------------------------------------------------
-- Groups
--   status flow: planning -> voting -> resolving (if nothing fits) -> booked
--                -> on_trip -> settled
--   current_day is the demo clock: the "simulate next day" button increments it.
-- ----------------------------------------------------------------------------
CREATE TABLE groups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text    NOT NULL,
  invite_code    text    NOT NULL UNIQUE,
  organiser_id   uuid    REFERENCES users(id) ON DELETE SET NULL,
  status         text    NOT NULL DEFAULT 'planning'
                 CHECK (status IN ('planning','voting','resolving','booked','on_trip','settled')),
  base_currency  char(3) NOT NULL DEFAULT 'EUR',   -- currency used to compare budgets and settle
  destination_id uuid    REFERENCES destinations(id) ON DELETE SET NULL,
  trip_start     date,
  trip_end       date,
  current_day    int     NOT NULL DEFAULT 0,       -- demo clock (trip day number)
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (trip_end IS NULL OR trip_start IS NULL OR trip_end >= trip_start)
);

-- ----------------------------------------------------------------------------
-- Group members + non-sensitive preferences
-- Deleting a row here cascades to that member's budgets and availability
-- ("when a member leaves, their private data is deleted").
-- ----------------------------------------------------------------------------
CREATE TABLE group_members (
  group_id   uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('organiser','member')),
  trip_styles text[] NOT NULL DEFAULT '{}',
  min_nights int  NOT NULL DEFAULT 3 CHECK (min_nights > 0),
  max_nights int  NOT NULL DEFAULT 7,
  -- groups of 2 must acknowledge that budgets can be roughly inferred
  accepted_small_group_warning boolean NOT NULL DEFAULT false,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id),
  CHECK (max_nights >= min_nights)
);

-- ----------------------------------------------------------------------------
-- PRIVATE: budgets (all amounts in the member's own currency, minor units)
--   flight_minor         their own flight only
--   group_minor          their private max for accommodation + shared core costs
--   private_daily_minor  daily food/extras pace (only the owner ever sees it)
--   accepts_stretch      NULL = not asked yet, true/false = private answer to
--                        "accept options slightly above your number?"
-- NEVER return rows from this table to anyone but the owner.
-- ----------------------------------------------------------------------------
CREATE TABLE budgets (
  group_id            uuid    NOT NULL,
  user_id             uuid    NOT NULL,
  flight_minor        bigint  NOT NULL CHECK (flight_minor >= 0),
  group_minor         bigint  NOT NULL CHECK (group_minor >= 0),
  private_daily_minor bigint  NOT NULL CHECK (private_daily_minor >= 0),
  currency            char(3) NOT NULL,
  accepts_stretch     boolean,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id, user_id) REFERENCES group_members(group_id, user_id) ON DELETE CASCADE
);

-- ----------------------------------------------------------------------------
-- PRIVATE: free date ranges (a member can have several)
-- The server intersects these, keeps windows >= everyone's min_nights, caps at 3.
-- ----------------------------------------------------------------------------
CREATE TABLE availability (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL,
  user_id    uuid NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  CHECK (end_date >= start_date),
  FOREIGN KEY (group_id, user_id) REFERENCES group_members(group_id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_availability_group ON availability (group_id);

-- ----------------------------------------------------------------------------
-- Flight estimates (cache + labelled fallback). One latest row per route.
-- source tells the UI what to label it: 'sample' | 'serpapi' | 'cached'.
-- ----------------------------------------------------------------------------
CREATE TABLE flight_estimates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin         char(3) NOT NULL,                  -- IATA
  destination_id uuid    NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  price_minor    bigint  NOT NULL CHECK (price_minor >= 0),
  currency       char(3) NOT NULL,
  source         text    NOT NULL DEFAULT 'sample' CHECK (source IN ('sample','serpapi','cached')),
  google_flights_url text,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin, destination_id)
);

-- ----------------------------------------------------------------------------
-- Live round-trip prices from SerpApi (Google Flights), per route AND dates.
-- flight_estimates above stay as the date-less sample/fallback used for screening.
-- price_minor is the round-trip price per person in `currency`.
-- ----------------------------------------------------------------------------
CREATE TABLE flight_quotes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin             char(3) NOT NULL,
  destination_id     uuid    NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  outbound_date      date    NOT NULL,
  return_date        date    NOT NULL,
  price_minor        bigint  NOT NULL CHECK (price_minor >= 0),
  currency           char(3) NOT NULL,
  airline            text,
  stops              int,
  google_flights_url text,
  source             text    NOT NULL DEFAULT 'serpapi' CHECK (source IN ('serpapi')),
  fetched_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin, destination_id, outbound_date, return_date, currency)
);

-- ----------------------------------------------------------------------------
-- Shortlist ("fits everyone"). Stores NO budgets and NO ceiling.
-- est_cost_pp_minor is an estimate from destination data, in the group's base currency.
-- ----------------------------------------------------------------------------
CREATE TABLE destination_options (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  destination_id    uuid NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  window_start      date NOT NULL,
  window_end        date NOT NULL,
  est_cost_pp_minor bigint NOT NULL CHECK (est_cost_pp_minor >= 0),
  currency          char(3) NOT NULL,
  summary           text,                            -- Gemini "why this fits" (gets no budget data)
  generated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end >= window_start),
  UNIQUE (group_id, destination_id, window_start, window_end)
);

-- ----------------------------------------------------------------------------
-- Anonymous votes: the API returns TOTALS only, never who voted for what.
-- ----------------------------------------------------------------------------
CREATE TABLE votes (
  option_id uuid    NOT NULL REFERENCES destination_options(id) ON DELETE CASCADE,
  user_id   uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approve   boolean NOT NULL,
  voted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);

-- ----------------------------------------------------------------------------
-- Private-first resolution when nothing fits.
-- Round 1: every member gets a private prompt at the same moment (24h).
-- If still nothing fits, the group sees one neutral message. Prompt text is
-- stored per member and is NEVER shown to anyone else.
-- ----------------------------------------------------------------------------
CREATE TABLE resolution_rounds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  round_no    int  NOT NULL DEFAULT 1,
  status      text NOT NULL DEFAULT 'private' CHECK (status IN ('private','group','resolved')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (group_id, round_no)
);

CREATE TABLE resolution_prompts (
  round_id     uuid NOT NULL REFERENCES resolution_rounds(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message      text NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  PRIMARY KEY (round_id, user_id)
);

-- ----------------------------------------------------------------------------
-- Expenses
--   type: 'shared'   split among chosen participants, visible in the group ledger
--         'extra'    split only among members who opted in
--         'personal' visible only to the payer (exactly one participant row: the payer)
--   Every expense has participant rows, so each person's private pacing is simply
--   SUM(their share) over food/extras.
--   Original amount + currency are kept; amount_base_minor is converted at entry
--   time with the saved rate, so settlement is auditable and stays in integers.
--
--   expenses is a plain table (not a hypertable) because expense_participants
--   needs a foreign key to it, and Timescale hypertables can't be referenced by
--   foreign keys. The time-series demo lives in sample_trip_spend (see timescale.sql).
-- ----------------------------------------------------------------------------
CREATE TABLE expenses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid    NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payer_id          uuid    NOT NULL REFERENCES users(id),
  type              text    NOT NULL CHECK (type IN ('shared','extra','personal')),
  category          text    NOT NULL DEFAULT 'other'
                    CHECK (category IN ('food','extras','accommodation','transport','other')),
  description       text,
  amount_minor      bigint  NOT NULL CHECK (amount_minor > 0),   -- original currency
  currency          char(3) NOT NULL,                             -- original currency
  fx_rate_to_base   numeric(18,8) NOT NULL CHECK (fx_rate_to_base > 0),
  amount_base_minor bigint  NOT NULL CHECK (amount_base_minor > 0),
  fx_source         text    NOT NULL DEFAULT 'wise' CHECK (fx_source IN ('wise','fallback')),
  fx_fetched_at     timestamptz NOT NULL DEFAULT now(),
  input_method      text    NOT NULL DEFAULT 'manual' CHECK (input_method IN ('manual','receipt','voice')),
  trip_day          int,                                          -- matches groups.current_day
  spent_on          date    NOT NULL DEFAULT current_date,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_group_day ON expenses (group_id, trip_day);
CREATE INDEX idx_expenses_payer     ON expenses (payer_id);

CREATE TABLE expense_participants (
  expense_id       uuid   NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id          uuid   NOT NULL REFERENCES users(id),
  share_base_minor bigint NOT NULL CHECK (share_base_minor >= 0),  -- in the group's base currency
  PRIMARY KEY (expense_id, user_id)
);
CREATE INDEX idx_expense_participants_user ON expense_participants (user_id);

-- Integrity: the shares of an expense must add up EXACTLY to its base amount.
-- Checked at COMMIT, so insert the expense and its participants in ONE transaction.
CREATE FUNCTION check_expense_shares() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  eid    uuid;
  total  bigint;
  shares bigint;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN
    eid := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    eid := OLD.expense_id;
  ELSE
    eid := NEW.expense_id;
  END IF;

  SELECT amount_base_minor INTO total FROM expenses WHERE id = eid;
  IF total IS NULL THEN
    RETURN NULL;   -- the expense itself was deleted; nothing to check
  END IF;

  SELECT COALESCE(SUM(share_base_minor), 0) INTO shares
  FROM expense_participants WHERE expense_id = eid;

  IF shares <> total THEN
    RAISE EXCEPTION 'Expense % shares (%) do not equal its base amount (%)', eid, shares, total;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_expense_shares_on_expense
  AFTER INSERT OR UPDATE ON expenses
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_shares();

CREATE CONSTRAINT TRIGGER trg_expense_shares_on_participant
  AFTER INSERT OR UPDATE OR DELETE ON expense_participants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_expense_shares();

-- ----------------------------------------------------------------------------
-- Activity log: who added or deleted what, per trip. Keeps a snapshot of the
-- expense (no foreign key to expenses), so deleted ones still show in the log.
-- Personal expenses are logged too but, like the expenses themselves, are
-- only ever shown to the person who paid (filter on type = 'personal').
-- ----------------------------------------------------------------------------
CREATE TABLE trip_activity (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid   NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_id          uuid   NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  action            text   NOT NULL CHECK (action IN ('expense_added','expense_deleted')),
  expense_id        uuid,                                   -- may no longer exist
  type              text   NOT NULL CHECK (type IN ('shared','extra','personal')),
  category          text   NOT NULL,
  description       text,
  amount_minor      bigint NOT NULL,
  currency          char(3) NOT NULL,
  amount_base_minor bigint NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trip_activity_group ON trip_activity (group_id, created_at DESC);

-- One row per person to tell about an activity: the people in the split,
-- never the person who made the change. share_base_minor is THEIR share.
CREATE TABLE notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id      uuid   NOT NULL REFERENCES trip_activity(id) ON DELETE CASCADE,
  share_base_minor bigint,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, activity_id)
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- Settlement: who pays whom, with the fewest payments (computed by server code).
-- amount_base_minor is the debt in the group's base currency. amount_minor is
-- what the payer actually sends, in the PAYER's home currency, at rate_used.
-- settled_at stays NULL until marked paid.
-- ----------------------------------------------------------------------------
CREATE TABLE settlements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid    NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user         uuid    NOT NULL REFERENCES users(id),
  to_user           uuid    NOT NULL REFERENCES users(id),
  amount_base_minor bigint  NOT NULL CHECK (amount_base_minor > 0),
  amount_minor      bigint  NOT NULL CHECK (amount_minor > 0),
  currency          char(3) NOT NULL,                 -- payer's home currency
  rate_used         numeric(18,8) NOT NULL CHECK (rate_used > 0),
  fx_source         text    NOT NULL DEFAULT 'wise' CHECK (fx_source IN ('wise','fallback')),
  wise_link         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  settled_at        timestamptz,
  CHECK (from_user <> to_user)
);
CREATE INDEX idx_settlements_group ON settlements (group_id);

-- ----------------------------------------------------------------------------
-- Evening nudge log (powers "something's missing" and the demo clock)
-- PRIVATE per user.
-- ----------------------------------------------------------------------------
CREATE TABLE daily_checkins (
  group_id     uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  day          int  NOT NULL,
  prompted_at  timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  had_expenses boolean,
  PRIMARY KEY (group_id, user_id, day)
);

-- ----------------------------------------------------------------------------
-- Sample past-group spending (SEEDED DUMMY DATA, label it "sample data").
-- One row = average spend per person for one category on one day at a destination.
-- timescale.sql turns this into a hypertable + continuous aggregate.
-- No primary key on purpose: hypertable unique keys must include the time column.
-- ----------------------------------------------------------------------------
CREATE TABLE sample_trip_spend (
  destination_id   uuid    NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  spent_on         date    NOT NULL,
  group_size       int     NOT NULL DEFAULT 4,
  category         text    NOT NULL CHECK (category IN ('food','activities','transport')),
  per_person_minor bigint  NOT NULL CHECK (per_person_minor >= 0),
  currency         char(3) NOT NULL DEFAULT 'EUR'
);
CREATE INDEX idx_sample_spend_dest_day ON sample_trip_spend (destination_id, spent_on);

-- ----------------------------------------------------------------------------
-- Safe view for anything shown to the whole group: no budgets, no availability.
-- ----------------------------------------------------------------------------
CREATE VIEW v_member_public AS
SELECT gm.group_id, u.id AS user_id, u.name, gm.role, gm.trip_styles, u.home_currency
FROM group_members gm
JOIN users u ON u.id = gm.user_id;