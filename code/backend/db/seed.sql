-- ============================================================================
-- seed.sql: DEMO DATA for the 3-minute demo (run after schema.sql)
-- Everything here is SAMPLE data. Label it "sample data" in the UI and pitch.
-- The logic that uses it (ceiling, shortlist, settlement) is real code.
-- Fixed UUIDs let tests and the demo script refer to the same people.
-- ============================================================================

-- Demo users: London / Lagos / Madrid, very different budgets and currencies
INSERT INTO users (id, name, home_currency, nationality, departure_airport, dietary_needs) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Tom',   'GBP', 'GB', 'LHR', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'Amara', 'NGN', 'NG', 'LOS', '{vegetarian}'),
  ('33333333-3333-3333-3333-333333333333', 'Lucia', 'EUR', 'ES', 'MAD', '{}');

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
