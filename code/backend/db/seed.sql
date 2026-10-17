-- ============================================================================
-- seed.sql: DEMO DATA for the 3-minute demo (run after schema.sql)
-- Everything here is SAMPLE data. Label it "sample data" in the UI and pitch.
-- The logic that uses it (ceiling, shortlist, settlement) is real code.
-- Fixed UUIDs let tests and the demo script refer to the same people.
-- ============================================================================

-- Demo users: London / Lagos / Madrid, very different budgets and currencies.
-- Log in as tom, amara or lucia. All three use the password: demo1234
INSERT INTO users (id, username, password_hash, name, home_currency, nationality, departure_airport, dietary_needs)
SELECT u.id::uuid, u.username, 'scrypt$95d61eb22e498b22ff171719bd412cb3$25055ddca7f737c59d803d46f7201c8c78e1e891d55534ef6d26d1270a0781fde28c9d8954f6eaeb03956adc4ed57fd9d45849b9c8c20d99a3ac1c4df885064a',
       u.name, u.home_currency, u.nationality, u.departure_airport, u.dietary_needs::text[]
FROM (VALUES
  ('11111111-1111-1111-1111-111111111111', 'tom',   'Tom',   'GBP', 'GB', 'LHR', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'amara', 'Amara', 'NGN', 'NG', 'LOS', '{vegetarian}'),
  ('33333333-3333-3333-3333-333333333333', 'lucia', 'Lucia', 'EUR', 'ES', 'MAD', '{}')
) AS u(id, username, name, home_currency, nationality, departure_airport, dietary_needs);

-- Tom and Lucia are friends; Amara has sent Tom a request he hasn't answered yet.
INSERT INTO friendships (requester_id, addressee_id, status, accepted_at) VALUES
  ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'accepted', now()),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'pending',  NULL);

-- Sample destination costs (EUR cents, per person)
INSERT INTO destinations
  (city, country_code, tags, base_currency, accommodation_pp_night_minor, food_pp_day_minor, activities_pp_day_minor) VALUES
  ('Lisbon',   'PT', '{culture,beach,nightlife}', 'EUR', 5500, 3800, 2200),
  ('Porto',    'PT', '{culture,food}',            'EUR', 4800, 3200, 1800),
  ('Barcelona','ES', '{beach,culture,nightlife}', 'EUR', 7000, 4200, 2800),
  ('Valencia', 'ES', '{beach,relaxing}',          'EUR', 5000, 3300, 2000),
  ('Prague',   'CZ', '{culture,nightlife}',       'EUR', 4500, 3000, 2200),
  ('Budapest', 'HU', '{culture,nightlife}',       'EUR', 4000, 2800, 2000),
  ('Athens',   'GR', '{culture,hiking}',          'EUR', 5200, 3200, 2400),
  ('Split',    'HR', '{beach,hiking}',            'EUR', 6000, 3500, 2500);

-- The demo group (base currency EUR, invite code DEMO42)
INSERT INTO groups (id, name, invite_code, organiser_id, status, base_currency) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Summer Trip', 'DEMO42',
   '11111111-1111-1111-1111-111111111111', 'planning', 'EUR');

INSERT INTO group_members (group_id, user_id, role, trip_styles, min_nights, max_nights) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'organiser', '{culture,nightlife}', 4, 7),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member',    '{beach,culture}',    4, 7),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'member',    '{beach,nightlife}',  4, 7);

-- Private budgets, each in the member's own currency (minor units).
-- group_minor = total for accommodation + shared core costs for the whole trip.
-- Tom (GBP): flight 250.00 | group 500.00 | daily 60.00
-- Amara (NGN): flight 450,000.00 | group 850,000.00 | daily 70,000.00
-- Lucia (EUR): flight 200.00 | group 450.00 | daily 55.00
INSERT INTO budgets (group_id, user_id, flight_minor, group_minor, private_daily_minor, currency) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',    25000,    50000,    6000, 'GBP'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 45000000, 85000000, 7000000, 'NGN'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',    20000,    45000,    5500, 'EUR');

-- Free dates: overlap is 2027-06-08 to 2027-06-20
INSERT INTO availability (group_id, user_id, start_date, end_date) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '2027-06-01', '2027-06-20'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', '2027-06-08', '2027-06-30'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '2027-06-05', '2027-06-25');

-- Sample flight estimates in each traveller's own currency (source = 'sample').
-- Amara's flight budget (₦450,000) rules out Prague, Budapest, Athens and Split,
-- which shows the per-person flight filter working in the demo.
INSERT INTO flight_estimates (origin, destination_id, price_minor, currency, source)
SELECT f.origin, d.id, f.price_minor, f.currency, 'sample'
FROM (VALUES
  ('LHR','Lisbon',     9000,'GBP'), ('LHR','Porto',      8500,'GBP'), ('LHR','Barcelona', 8000,'GBP'), ('LHR','Valencia', 9500,'GBP'),
  ('LHR','Prague',     8800,'GBP'), ('LHR','Budapest',   9200,'GBP'), ('LHR','Athens',    12000,'GBP'), ('LHR','Split',   11000,'GBP'),
  ('MAD','Lisbon',     7000,'EUR'), ('MAD','Porto',      7500,'EUR'), ('MAD','Barcelona', 6000,'EUR'), ('MAD','Valencia', 5500,'EUR'),
  ('MAD','Prague',    11000,'EUR'), ('MAD','Budapest',  12000,'EUR'), ('MAD','Athens',    13000,'EUR'), ('MAD','Split',   14000,'EUR'),
  ('LOS','Lisbon',  38000000,'NGN'), ('LOS','Porto',  40000000,'NGN'), ('LOS','Barcelona', 42000000,'NGN'), ('LOS','Valencia', 45000000,'NGN'),
  ('LOS','Prague',  48000000,'NGN'), ('LOS','Budapest',50000000,'NGN'), ('LOS','Athens',  52000000,'NGN'), ('LOS','Split',  55000000,'NGN')
) AS f(origin, city, price_minor, currency)
JOIN destinations d ON d.city = f.city;

-- Sample past-group spending: 30 days x 3 categories x 8 destinations.
-- Deterministic pseudo-random noise (hashtext) so re-running gives the same numbers.
INSERT INTO sample_trip_spend (destination_id, spent_on, group_size, category, per_person_minor, currency)
SELECT
  d.id,
  (DATE '2026-05-01' + g)::date,
  4,
  c.category,
  CASE c.category
    WHEN 'food'       THEN d.food_pp_day_minor
    WHEN 'activities' THEN d.activities_pp_day_minor
    ELSE 800
  END + (abs(hashtext(d.city || g::text || c.category)) % 600),
  'EUR'
FROM destinations d
CROSS JOIN generate_series(0, 29) AS g
CROSS JOIN (VALUES ('food'), ('activities'), ('transport')) AS c(category);

-- Extra groups so the account page has a current and a past trip to show.
-- The demo group above stays the one used by the 3-minute demo and the tests.
INSERT INTO groups (id, name, invite_code, organiser_id, status, base_currency, destination_id, trip_start, trip_end, current_day)
SELECT v.id::uuid, v.name, v.code, v.organiser::uuid, v.status, 'EUR', d.id, v.trip_start::date, v.trip_end::date, v.current_day
FROM (VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Porto Weekend', 'PORTO1', '33333333-3333-3333-3333-333333333333', 'on_trip', 'Porto',  '2026-10-16', '2026-10-19', 2),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Spring Break',  'LISB26', '11111111-1111-1111-1111-111111111111', 'settled', 'Lisbon', '2026-04-03', '2026-04-08', 0)
) AS v(id, name, code, organiser, status, city, trip_start, trip_end, current_day)
JOIN destinations d ON d.city = v.city;

INSERT INTO group_members (group_id, user_id, role, trip_styles) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'organiser', '{food}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'member',    '{culture}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'member',    '{food}'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'organiser', '{beach}'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'member',    '{beach}'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'member',    '{nightlife}');

INSERT INTO budgets (group_id, user_id, flight_minor, group_minor, private_daily_minor, currency) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333',    10000,    25000,    4500, 'EUR'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111',    12000,    30000,    5000, 'GBP'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 40000000, 50000000, 6000000, 'NGN'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111',    15000,    40000,    5000, 'GBP'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 38000000, 70000000, 6500000, 'NGN'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333',    15000,    35000,    5000, 'EUR');

-- ============================================================================
-- MORE SAMPLE DATA: extra friends and trips of every kind and stage, so the
-- account and friends pages have something to show. Each group is one trip.
--   Day hikes:        Peak District (settled), Saxon Switzerland (settled),
--                     Guadarrama (on the trip today), Sintra (booked)
--   Weekend stays:    Prague (settled), Budapest (booked),
--                     February Weekend Away (planning -> options),
--                     Birthday Weekend (planning, one person still to fill in)
--   Spring holidays:  Easter in Athens (booked),
--                     Spring Holiday 2027 (planning -> options),
--                     Spring Island Hopping (planning -> nothing fits yet)
-- The demo group above is unchanged: the hiking spots have no Lagos flights,
-- so they can never appear in its shortlist.
-- ============================================================================

-- More people, same password as the demo users (demo1234)
INSERT INTO users (id, username, password_hash, name, home_currency, nationality, departure_airport, dietary_needs)
SELECT u.id::uuid, u.username, (SELECT password_hash FROM users WHERE username = 'tom'),
       u.name, u.home_currency, u.nationality, u.departure_airport, u.dietary_needs::text[]
FROM (VALUES
  ('44444444-4444-4444-4444-444444444444', 'priya', 'Priya', 'GBP', 'GB', 'LHR', '{vegetarian}'),
  ('55555555-5555-5555-5555-555555555555', 'mateo', 'Mateo', 'EUR', 'ES', 'MAD', '{}'),
  ('66666666-6666-6666-6666-666666666666', 'kemi',  'Kemi',  'NGN', 'NG', 'LOS', '{}'),
  ('77777777-7777-7777-7777-777777777777', 'jonas', 'Jonas', 'EUR', 'DE', 'BER', '{vegan}'),
  ('88888888-8888-8888-8888-888888888888', 'aisha', 'Aisha', 'GBP', 'GB', 'LHR', '{halal}')
) AS u(id, username, name, home_currency, nationality, departure_airport, dietary_needs);

-- Friendships between everyone who shares a trip below, plus two open requests
INSERT INTO friendships (requester_id, addressee_id, status, accepted_at)
SELECT a.id, b.id, f.status, CASE WHEN f.status = 'accepted' THEN now() END
FROM (VALUES
  ('tom', 'priya', 'accepted'), ('tom', 'aisha', 'accepted'), ('tom', 'jonas', 'accepted'),
  ('priya', 'aisha', 'accepted'), ('priya', 'jonas', 'accepted'), ('priya', 'mateo', 'accepted'),
  ('priya', 'kemi', 'accepted'), ('priya', 'lucia', 'accepted'), ('priya', 'amara', 'accepted'),
  ('aisha', 'jonas', 'accepted'), ('aisha', 'kemi', 'accepted'),
  ('lucia', 'mateo', 'accepted'), ('lucia', 'jonas', 'accepted'), ('lucia', 'amara', 'accepted'),
  ('mateo', 'jonas', 'accepted'), ('mateo', 'amara', 'accepted'), ('mateo', 'kemi', 'accepted'),
  ('amara', 'kemi', 'accepted'),
  ('mateo', 'tom', 'pending'), ('kemi', 'lucia', 'pending')
) AS f(requester, addressee, status)
JOIN users a ON a.username = f.requester
JOIN users b ON b.username = f.addressee;

-- Day-hike spots (SAMPLE costs, EUR cents per person). No stay, just food and transport.
INSERT INTO destinations
  (city, country_code, tags, base_currency, accommodation_pp_night_minor, food_pp_day_minor, activities_pp_day_minor) VALUES
  ('Peak District',     'GB', '{hiking}',         'EUR', 0, 1800,  800),
  ('Sintra',            'PT', '{hiking,culture}', 'EUR', 0, 2000, 1200),
  ('Saxon Switzerland', 'DE', '{hiking}',         'EUR', 0, 1600,  600),
  ('Guadarrama',        'ES', '{hiking}',         'EUR', 0, 1500,  400);

-- Sample flights from Berlin, so Jonas can join trips that are still being planned
INSERT INTO flight_estimates (origin, destination_id, price_minor, currency, source)
SELECT 'BER', d.id, f.price_minor, 'EUR', 'sample'
FROM (VALUES
  ('Lisbon', 12000), ('Porto', 11000), ('Barcelona', 9000), ('Valencia', 10000),
  ('Prague',  6000), ('Budapest', 7000), ('Athens',  11000), ('Split',    9500)
) AS f(city, price_minor)
JOIN destinations d ON d.city = f.city;

-- The trips. Booked and finished ones have a destination and dates; ones still
-- being planned get their shortlist from the recompute that db:reset runs.
INSERT INTO groups (id, name, invite_code, organiser_id, status, base_currency, destination_id, trip_start, trip_end, current_day)
SELECT v.id::uuid, v.name, v.code, o.id, v.status, v.base_currency, d.id, v.trip_start::date, v.trip_end::date, v.current_day
FROM (VALUES
  ('20000000-0000-0000-0000-000000000001', 'Peak District Day Hike',  'HIKE01', 'priya', 'settled',  'GBP', 'Peak District',     '2026-09-13', '2026-09-13', 0),
  ('20000000-0000-0000-0000-000000000002', 'Sintra Hike',             'HIKE02', 'lucia', 'booked',   'EUR', 'Sintra',            '2026-10-31', '2026-10-31', 0),
  ('20000000-0000-0000-0000-000000000003', 'Saxon Switzerland Hike',  'HIKE03', 'jonas', 'settled',  'EUR', 'Saxon Switzerland', '2026-06-20', '2026-06-20', 0),
  ('20000000-0000-0000-0000-000000000004', 'Guadarrama Sunrise Hike', 'HIKE04', 'mateo', 'on_trip',  'EUR', 'Guadarrama',        '2026-10-17', '2026-10-17', 1),
  ('20000000-0000-0000-0000-000000000005', 'Prague Weekend',          'WKND01', 'jonas', 'settled',  'EUR', 'Prague',            '2026-03-13', '2026-03-15', 0),
  ('20000000-0000-0000-0000-000000000006', 'Budapest Long Weekend',   'WKND02', 'aisha', 'booked',   'GBP', 'Budapest',          '2026-11-20', '2026-11-23', 0),
  ('20000000-0000-0000-0000-000000000007', 'February Weekend Away',   'WKND03', 'mateo', 'planning', 'EUR', NULL,                NULL,         NULL,         0),
  ('20000000-0000-0000-0000-000000000008', 'Birthday Weekend',        'WKND04', 'kemi',  'planning', 'NGN', NULL,                NULL,         NULL,         0),
  ('20000000-0000-0000-0000-000000000009', 'Easter in Athens',        'SPRG01', 'priya', 'booked',   'GBP', 'Athens',            '2027-03-26', '2027-04-02', 0),
  ('20000000-0000-0000-0000-000000000010', 'Spring Holiday 2027',     'SPRG02', 'tom',   'planning', 'GBP', NULL,                NULL,         NULL,         0),
  ('20000000-0000-0000-0000-000000000011', 'Spring Island Hopping',   'SPRG03', 'kemi',  'planning', 'NGN', NULL,                NULL,         NULL,         0)
) AS v(id, name, code, organiser, status, base_currency, city, trip_start, trip_end, current_day)
JOIN users o ON o.username = v.organiser
LEFT JOIN destinations d ON d.city = v.city;

-- Members. Weekends accept 2-3 nights, spring holidays 5-8, the rest keep the defaults.
INSERT INTO group_members (group_id, user_id, role, trip_styles, min_nights, max_nights)
SELECT m.group_id::uuid, u.id, CASE WHEN g.organiser_id = u.id THEN 'organiser' ELSE 'member' END,
       m.styles::text[], m.min_nights, m.max_nights
FROM (VALUES
  ('20000000-0000-0000-0000-000000000001', 'tom',   '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000001', 'priya', '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000001', 'aisha', '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000002', 'lucia', '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000002', 'mateo', '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000002', 'jonas', '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000003', 'jonas', '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000003', 'priya', '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000003', 'tom',   '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000004', 'mateo', '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000004', 'jonas', '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000004', 'priya', '{hiking}', 3, 7),
  ('20000000-0000-0000-0000-000000000005', 'jonas', '{culture,nightlife}', 2, 3),
  ('20000000-0000-0000-0000-000000000005', 'mateo', '{nightlife}',         2, 3),
  ('20000000-0000-0000-0000-000000000005', 'lucia', '{culture}',           2, 3),
  ('20000000-0000-0000-0000-000000000006', 'aisha', '{culture}',           2, 3),
  ('20000000-0000-0000-0000-000000000006', 'priya', '{culture,food}',      2, 3),
  ('20000000-0000-0000-0000-000000000006', 'tom',   '{nightlife}',         2, 3),
  ('20000000-0000-0000-0000-000000000006', 'jonas', '{culture}',           2, 3),
  ('20000000-0000-0000-0000-000000000007', 'mateo', '{beach,food}',        2, 3),
  ('20000000-0000-0000-0000-000000000007', 'lucia', '{culture,food}',      2, 3),
  ('20000000-0000-0000-0000-000000000007', 'priya', '{culture}',           2, 3),
  ('20000000-0000-0000-0000-000000000008', 'kemi',  '{nightlife}',         2, 3),
  ('20000000-0000-0000-0000-000000000008', 'amara', '{beach,nightlife}',   2, 3),
  ('20000000-0000-0000-0000-000000000008', 'aisha', '{culture}',           2, 3),
  ('20000000-0000-0000-0000-000000000009', 'priya', '{culture,hiking}',    5, 8),
  ('20000000-0000-0000-0000-000000000009', 'kemi',  '{culture}',           5, 8),
  ('20000000-0000-0000-0000-000000000009', 'amara', '{culture,beach}',     5, 8),
  ('20000000-0000-0000-0000-000000000010', 'tom',   '{culture,nightlife}', 5, 8),
  ('20000000-0000-0000-0000-000000000010', 'priya', '{culture,food}',      5, 8),
  ('20000000-0000-0000-0000-000000000010', 'jonas', '{hiking,culture}',    5, 8),
  ('20000000-0000-0000-0000-000000000010', 'aisha', '{beach,culture}',     5, 8),
  ('20000000-0000-0000-0000-000000000011', 'kemi',  '{beach}',             4, 7),
  ('20000000-0000-0000-0000-000000000011', 'amara', '{beach}',             4, 7),
  ('20000000-0000-0000-0000-000000000011', 'mateo', '{beach,hiking}',      4, 7)
) AS m(group_id, username, styles, min_nights, max_nights)
JOIN users u ON u.username = m.username
JOIN groups g ON g.id = m.group_id::uuid;

-- Private budgets, in each member's home currency (minor units).
-- Aisha hasn't filled in the Birthday Weekend yet, so that trip waits for her.
-- Spring Island Hopping's group budgets are too low for any stay: nothing fits yet.
INSERT INTO budgets (group_id, user_id, flight_minor, group_minor, private_daily_minor, currency)
SELECT b.group_id::uuid, u.id, b.flight, b.grp, b.daily, u.home_currency
FROM (VALUES
  -- Day hikes: no flights, a little for transport and lunch
  ('20000000-0000-0000-0000-000000000001', 'tom',          0,     3000,     2500),
  ('20000000-0000-0000-0000-000000000001', 'priya',        0,     2500,     2000),
  ('20000000-0000-0000-0000-000000000001', 'aisha',        0,     2000,     2000),
  ('20000000-0000-0000-0000-000000000002', 'lucia',        0,     3000,     2500),
  ('20000000-0000-0000-0000-000000000002', 'mateo',        0,     3500,     3000),
  ('20000000-0000-0000-0000-000000000002', 'jonas',    18000,     3000,     2500),
  ('20000000-0000-0000-0000-000000000003', 'jonas',        0,     2500,     2000),
  ('20000000-0000-0000-0000-000000000003', 'priya',    12000,     2500,     2000),
  ('20000000-0000-0000-0000-000000000003', 'tom',      12000,     3000,     2500),
  ('20000000-0000-0000-0000-000000000004', 'mateo',        0,     2000,     2000),
  ('20000000-0000-0000-0000-000000000004', 'jonas',    15000,     2000,     2000),
  ('20000000-0000-0000-0000-000000000004', 'priya',    13000,     2000,     2000),
  -- Weekend stays
  ('20000000-0000-0000-0000-000000000005', 'jonas',    10000,    30000,     5000),
  ('20000000-0000-0000-0000-000000000005', 'mateo',    15000,    28000,     4500),
  ('20000000-0000-0000-0000-000000000005', 'lucia',    15000,    25000,     4500),
  ('20000000-0000-0000-0000-000000000006', 'aisha',    12000,    30000,     5000),
  ('20000000-0000-0000-0000-000000000006', 'priya',    12000,    25000,     4500),
  ('20000000-0000-0000-0000-000000000006', 'tom',      15000,    35000,     6000),
  ('20000000-0000-0000-0000-000000000006', 'jonas',    10000,    28000,     5000),
  ('20000000-0000-0000-0000-000000000007', 'mateo',    15000,    40000,     6000),
  ('20000000-0000-0000-0000-000000000007', 'lucia',    15000,    35000,     5000),
  ('20000000-0000-0000-0000-000000000007', 'priya',    15000,    30000,     5000),
  ('20000000-0000-0000-0000-000000000008', 'kemi',  45000000, 60000000,  8000000),
  ('20000000-0000-0000-0000-000000000008', 'amara', 50000000, 70000000,  9000000),
  -- Spring holidays
  ('20000000-0000-0000-0000-000000000009', 'priya',    15000,    60000,     5000),
  ('20000000-0000-0000-0000-000000000009', 'kemi',  55000000, 110000000, 9000000),
  ('20000000-0000-0000-0000-000000000009', 'amara', 55000000, 120000000, 9000000),
  ('20000000-0000-0000-0000-000000000010', 'tom',      20000,    90000,     6000),
  ('20000000-0000-0000-0000-000000000010', 'priya',    15000,    70000,     5000),
  ('20000000-0000-0000-0000-000000000010', 'jonas',    15000,    80000,     5500),
  ('20000000-0000-0000-0000-000000000010', 'aisha',    18000,    60000,     5500),
  ('20000000-0000-0000-0000-000000000011', 'kemi',  55000000, 10000000,  8000000),
  ('20000000-0000-0000-0000-000000000011', 'amara', 55000000, 12000000,  8000000),
  ('20000000-0000-0000-0000-000000000011', 'mateo',    15000,    20000,     5000)
) AS b(group_id, username, flight, grp, daily)
JOIN users u ON u.username = b.username;

-- Free dates for the trips still being planned
INSERT INTO availability (group_id, user_id, start_date, end_date)
SELECT a.group_id::uuid, u.id, a.start_date::date, a.end_date::date
FROM (VALUES
  -- February Weekend Away: everyone free 12-15 Feb
  ('20000000-0000-0000-0000-000000000007', 'mateo', '2027-02-12', '2027-02-15'),
  ('20000000-0000-0000-0000-000000000007', 'lucia', '2027-02-11', '2027-02-16'),
  ('20000000-0000-0000-0000-000000000007', 'priya', '2027-02-12', '2027-02-15'),
  -- Birthday Weekend: Aisha hasn't added her dates yet
  ('20000000-0000-0000-0000-000000000008', 'kemi',  '2027-01-15', '2027-01-18'),
  ('20000000-0000-0000-0000-000000000008', 'amara', '2027-01-14', '2027-01-18'),
  -- Spring Holiday 2027: overlap is 3-14 April
  ('20000000-0000-0000-0000-000000000010', 'tom',   '2027-04-01', '2027-04-20'),
  ('20000000-0000-0000-0000-000000000010', 'priya', '2027-04-03', '2027-04-18'),
  ('20000000-0000-0000-0000-000000000010', 'jonas', '2027-04-02', '2027-04-14'),
  ('20000000-0000-0000-0000-000000000010', 'aisha', '2027-04-03', '2027-04-16'),
  -- Spring Island Hopping: dates line up, budgets don't
  ('20000000-0000-0000-0000-000000000011', 'kemi',  '2027-05-01', '2027-05-15'),
  ('20000000-0000-0000-0000-000000000011', 'amara', '2027-05-03', '2027-05-20'),
  ('20000000-0000-0000-0000-000000000011', 'mateo', '2027-05-01', '2027-05-12')
) AS a(group_id, username, start_date, end_date)
JOIN users u ON u.username = a.username;

-- ============================================================================
-- SAMPLE EXPENSES for trips that are under way or finished.
-- Conversions use the static fallback rates (per 1 EUR: GBP 0.86, NGN 1700),
-- labelled 'fallback'. Shares split evenly; leftover cents go to the first
-- people listed, exactly like logic/expenses.js splitEvenly().
-- db:reset then writes settle-up payments for the settled trips.
-- ============================================================================
CREATE TEMP TABLE seed_expenses (
  group_id uuid, payer text, type text, category text, description text,
  amount_minor bigint, currency char(3), trip_day int, spent_on date, participants text[]
) ON COMMIT DROP;

INSERT INTO seed_expenses VALUES
  -- Porto Weekend (on the trip, day 2, EUR)
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'lucia', 'shared',   'accommodation', 'Ribeira apartment, 3 nights', 36000,   'EUR', 1, '2026-10-16', '{lucia,tom,amara}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tom',   'shared',   'food',          'Dinner at a tasca',            7200,   'GBP', 1, '2026-10-16', '{tom,lucia,amara}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'lucia', 'shared',   'transport',     'Metro day passes',             2100,   'EUR', 2, '2026-10-17', '{lucia,tom,amara}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'amara', 'extra',    'extras',        'Port wine tasting',         7650000,   'NGN', 2, '2026-10-17', '{amara,lucia}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'tom',   'personal', 'food',          'Pastéis de nata',               650,   'EUR', 2, '2026-10-17', '{tom}'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'amara', 'personal', 'other',         'Souvenirs',                 3400000,   'NGN', 2, '2026-10-17', '{amara}'),
  -- Guadarrama Sunrise Hike (on the trip today, EUR)
  ('20000000-0000-0000-0000-000000000004', 'mateo', 'shared',   'transport',     'Car hire and fuel',            6000,   'EUR', 1, '2026-10-17', '{mateo,jonas,priya}'),
  ('20000000-0000-0000-0000-000000000004', 'priya', 'shared',   'food',          'Picnic lunch',                 2400,   'GBP', 1, '2026-10-17', '{priya,mateo,jonas}'),
  ('20000000-0000-0000-0000-000000000004', 'jonas', 'personal', 'food',          'Coffee at the trailhead',       350,   'EUR', 1, '2026-10-17', '{jonas}'),
  -- Spring Break, Lisbon (settled, EUR)
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'tom',   'shared',   'accommodation', 'Alfama apartment, 5 nights', 82500,   'EUR', 1, '2026-04-03', '{tom,amara,lucia}'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'lucia', 'shared',   'food',          'Seafood dinner',               9600,   'EUR', 2, '2026-04-04', '{lucia,tom,amara}'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'amara', 'shared',   'transport',     'Tram 28 and train to Cascais', 5100000, 'NGN', 3, '2026-04-05', '{amara,tom,lucia}'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'lucia', 'extra',    'extras',        'Surf lesson',                  9000,   'EUR', 4, '2026-04-06', '{lucia,tom}'),
  -- Prague Weekend (settled, EUR)
  ('20000000-0000-0000-0000-000000000005', 'jonas', 'shared',   'accommodation', 'Old Town flat, 2 nights',     24000,   'EUR', 1, '2026-03-13', '{jonas,mateo,lucia}'),
  ('20000000-0000-0000-0000-000000000005', 'mateo', 'shared',   'food',          'Beer hall dinner',             5400,   'EUR', 1, '2026-03-13', '{mateo,jonas,lucia}'),
  ('20000000-0000-0000-0000-000000000005', 'lucia', 'shared',   'other',         'Castle tickets',               4500,   'EUR', 2, '2026-03-14', '{lucia,jonas,mateo}'),
  -- Peak District Day Hike (settled, GBP)
  ('20000000-0000-0000-0000-000000000001', 'tom',   'shared',   'transport',     'Train to Edale',               6300,   'GBP', 1, '2026-09-13', '{tom,priya,aisha}'),
  ('20000000-0000-0000-0000-000000000001', 'aisha', 'shared',   'food',          'Pub lunch',                    4200,   'GBP', 1, '2026-09-13', '{aisha,tom,priya}'),
  -- Saxon Switzerland Hike (settled, EUR)
  ('20000000-0000-0000-0000-000000000003', 'jonas', 'shared',   'transport',     'S-Bahn day tickets',           2700,   'EUR', 1, '2026-06-20', '{jonas,priya,tom}');

-- Convert to each trip's base currency with the fallback table, then insert.
CREATE TEMP TABLE seed_expense_rows ON COMMIT DROP AS
SELECT gen_random_uuid() AS id, s.*, g.base_currency,
       (r_base.per_eur / r_ccy.per_eur)::numeric(18,8) AS fx_rate_to_base,
       round(s.amount_minor * r_base.per_eur / r_ccy.per_eur)::bigint AS amount_base_minor
FROM seed_expenses s
JOIN groups g ON g.id = s.group_id
JOIN (VALUES ('EUR', 1.0), ('GBP', 0.86), ('NGN', 1700.0)) AS r_ccy(ccy, per_eur)  ON r_ccy.ccy  = s.currency
JOIN (VALUES ('EUR', 1.0), ('GBP', 0.86), ('NGN', 1700.0)) AS r_base(ccy, per_eur) ON r_base.ccy = g.base_currency;

INSERT INTO expenses (id, group_id, payer_id, type, category, description, amount_minor, currency,
                      fx_rate_to_base, amount_base_minor, fx_source, trip_day, spent_on, fx_fetched_at)
SELECT e.id, e.group_id, u.id, e.type, e.category, e.description, e.amount_minor, e.currency,
       e.fx_rate_to_base, e.amount_base_minor,
       CASE WHEN e.currency = e.base_currency THEN 'wise' ELSE 'fallback' END,
       e.trip_day, e.spent_on, e.spent_on::timestamptz
FROM seed_expense_rows e JOIN users u ON u.username = e.payer;

INSERT INTO expense_participants (expense_id, user_id, share_base_minor)
SELECT e.id, u.id,
       e.amount_base_minor / cardinality(e.participants)
       + CASE WHEN p.n <= e.amount_base_minor % cardinality(e.participants) THEN 1 ELSE 0 END
FROM seed_expense_rows e
CROSS JOIN LATERAL unnest(e.participants) WITH ORDINALITY AS p(username, n)
JOIN users u ON u.username = p.username;

-- Activity log for the sample expenses, as if each was added on the day it was
-- spent. Everyone in a split is notified; only Porto Weekend and the Guadarrama
-- hike (under way now) still have unread ones.
INSERT INTO trip_activity (group_id, actor_id, action, expense_id, type, category, description,
                           amount_minor, currency, amount_base_minor, created_at)
SELECT group_id, payer_id, 'expense_added', id, type, category, description,
       amount_minor, currency, amount_base_minor, spent_on + time '19:00'
FROM expenses;

INSERT INTO notifications (user_id, activity_id, share_base_minor, read_at, created_at)
SELECT p.user_id, a.id, p.share_base_minor,
       CASE WHEN g.status = 'on_trip' THEN NULL ELSE a.created_at + interval '1 hour' END,
       a.created_at
FROM trip_activity a
JOIN groups g ON g.id = a.group_id
JOIN expense_participants p ON p.expense_id = a.expense_id
WHERE a.type <> 'personal' AND p.user_id <> a.actor_id;
