-- ============================================================================
-- timescale.sql: OPTIONAL, run on Tiger Data / TimescaleDB after seed.sql.
-- Plain Postgres will fail on this file; the app still works without it
-- (compute the averages with an ordinary GROUP BY instead).
--
-- Run this file as its own script, not inside a transaction block:
-- continuous aggregates cannot be created inside one.
--
-- NOT TESTED on a live Tiger instance when written. If a statement errors,
-- check Tiger's current docs for create_hypertable / continuous aggregates.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 1. Turn the sample past-group spend into a time-series hypertable
SELECT create_hypertable(
  'sample_trip_spend', 'spent_on',
  chunk_time_interval => INTERVAL '30 days',
  migrate_data        => TRUE,
  if_not_exists       => TRUE
);

-- 2. Continuous aggregate: average spend per person per day, per destination.
--    One row per destination per day, summed over categories (food + activities + transport).
CREATE MATERIALIZED VIEW daily_spend_by_destination
WITH (timescaledb.continuous) AS
SELECT
  destination_id,
  time_bucket(INTERVAL '1 day', spent_on) AS day,
  SUM(per_person_minor)                   AS per_person_day_minor,
  MAX(currency)                           AS currency
FROM sample_trip_spend
GROUP BY destination_id, time_bucket(INTERVAL '1 day', spent_on)
WITH NO DATA;

-- 3. Fill it now, and keep it fresh
CALL refresh_continuous_aggregate('daily_spend_by_destination', NULL, NULL);

SELECT add_continuous_aggregate_policy(
  'daily_spend_by_destination',
  start_offset      => NULL,
  end_offset        => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 hour'
);

-- 4. Query used by the app: "groups of 4 spent about X per person per day in <city>"
--    SELECT d.city, ROUND(AVG(s.per_person_day_minor)) AS avg_pp_day_minor, MAX(s.currency) AS currency
--    FROM daily_spend_by_destination s
--    JOIN destinations d ON d.id = s.destination_id
--    GROUP BY d.city;
