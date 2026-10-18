// Copy anonymised trip and spending data into Snowflake:  npm run snowflake:sync
//
// Full refresh each time (small data): creates the tables and view if needed,
// then replaces their contents in one transaction. What goes over is decided by
// logic/analytics.js: no budgets, names or user ids, no personal spending, and
// no trips with fewer than 3 people.

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const db = require('../db');
const snowflake = require('../integrations/snowflake');
const { loadAnalyticsRows } = require('../insights');

const TABLES = [
  `CREATE TABLE IF NOT EXISTS TRIPS (
     TRIP_KEY STRING PRIMARY KEY, DESTINATION_CITY STRING, COUNTRY_CODE STRING, STATUS STRING,
     GROUP_SIZE NUMBER, NIGHTS NUMBER, TRIP_MONTH DATE, BASE_CURRENCY STRING,
     SYNCED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP())`,
  // Reference costs per city: SAMPLE data, the same figures the shortlist uses.
  `CREATE TABLE IF NOT EXISTS DESTINATIONS (
     CITY STRING PRIMARY KEY, COUNTRY_CODE STRING, TAGS STRING,
     STAY_PP_NIGHT_EUR_MINOR NUMBER, FOOD_PP_DAY_EUR_MINOR NUMBER, ACTIVITIES_PP_DAY_EUR_MINOR NUMBER,
     IS_SAMPLE BOOLEAN DEFAULT TRUE, SYNCED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP())`,
  `CREATE TABLE IF NOT EXISTS DAILY_SPEND (
     TRIP_KEY STRING, DESTINATION_CITY STRING, SPENT_ON DATE, CATEGORY STRING, GROUP_SIZE NUMBER,
     TOTAL_EUR_MINOR NUMBER, PER_PERSON_EUR_MINOR NUMBER, IS_SAMPLE BOOLEAN,
     SYNCED_AT TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP())`,
  // Same calculation as averageDailySpend() in logic/analytics.js
  `CREATE OR REPLACE VIEW DESTINATION_DAILY_SPEND AS
     SELECT DESTINATION_CITY,
            ROUND(AVG(DAY_TOTAL)) AS PER_PERSON_DAY_EUR_MINOR,
            COUNT(*)              AS TRIP_DAYS,
            BOOLAND_AGG(IS_SAMPLE) AS SAMPLE_ONLY
     FROM (SELECT DESTINATION_CITY, TRIP_KEY, SPENT_ON,
                  SUM(PER_PERSON_EUR_MINOR) AS DAY_TOTAL, BOOLAND_AGG(IS_SAMPLE) AS IS_SAMPLE
           FROM DAILY_SPEND GROUP BY DESTINATION_CITY, TRIP_KEY, SPENT_ON)
     GROUP BY DESTINATION_CITY`,
  // Same calculation by calendar month: averageDailySpendByMonth() in logic/analytics.js
  `CREATE OR REPLACE VIEW DESTINATION_MONTHLY_SPEND AS
     SELECT DESTINATION_CITY, MONTH(SPENT_ON) AS MONTH,
            ROUND(AVG(DAY_TOTAL)) AS PER_PERSON_DAY_EUR_MINOR,
            COUNT(*)              AS TRIP_DAYS,
            BOOLAND_AGG(IS_SAMPLE) AS SAMPLE_ONLY
     FROM (SELECT DESTINATION_CITY, TRIP_KEY, SPENT_ON,
                  SUM(PER_PERSON_EUR_MINOR) AS DAY_TOTAL, BOOLAND_AGG(IS_SAMPLE) AS IS_SAMPLE
           FROM DAILY_SPEND GROUP BY DESTINATION_CITY, TRIP_KEY, SPENT_ON)
     GROUP BY DESTINATION_CITY, MONTH(SPENT_ON)`,
];

async function main() {
  if (!snowflake.isConfigured()) {
    throw new Error('Snowflake is not configured. Add the SNOWFLAKE_* values to code/backend/.env (see integrations/snowflake.js).');
  }
  const { destinations, trips, dailySpend } = await loadAnalyticsRows();

  for (const sql of TABLES) await snowflake.query(sql);
  await snowflake.query('BEGIN');
  try {
    await snowflake.query('DELETE FROM DESTINATIONS');
    await snowflake.query('DELETE FROM TRIPS');
    if (destinations.length) {
      await snowflake.query(
        `INSERT INTO DESTINATIONS (CITY, COUNTRY_CODE, TAGS, STAY_PP_NIGHT_EUR_MINOR, FOOD_PP_DAY_EUR_MINOR, ACTIVITIES_PP_DAY_EUR_MINOR)
         VALUES (?, ?, ?, ?, ?, ?)`,
        destinations.map((d) => [d.city, d.country_code, d.tags, d.stay_pp_night_eur_minor, d.food_pp_day_eur_minor, d.activities_pp_day_eur_minor]));
    }
    await snowflake.query('DELETE FROM DAILY_SPEND');
    if (trips.length) {
      await snowflake.query(
        `INSERT INTO TRIPS (TRIP_KEY, DESTINATION_CITY, COUNTRY_CODE, STATUS, GROUP_SIZE, NIGHTS, TRIP_MONTH, BASE_CURRENCY)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        trips.map((t) => [t.trip_key, t.destination_city, t.country_code, t.status, t.group_size, t.nights, t.trip_month, t.base_currency]));
    }
    if (dailySpend.length) {
      await snowflake.query(
        `INSERT INTO DAILY_SPEND (TRIP_KEY, DESTINATION_CITY, SPENT_ON, CATEGORY, GROUP_SIZE, TOTAL_EUR_MINOR, PER_PERSON_EUR_MINOR, IS_SAMPLE)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        dailySpend.map((r) => [r.trip_key, r.destination_city, r.spent_on, r.category, r.group_size, r.total_eur_minor, r.per_person_eur_minor, r.is_sample]));
    }
    await snowflake.query('COMMIT');
  } catch (err) {
    await snowflake.query('ROLLBACK').catch(() => {});
    throw err;
  }
  const real = dailySpend.filter((r) => !r.is_sample).length;
  console.log(`▸ Snowflake: ${destinations.length} destination(s), ${trips.length} trip(s), ${dailySpend.length} daily spend row(s) (${real} from real trips, ${dailySpend.length - real} sample)`);
}

main()
  .catch((err) => {
    console.error('✖', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await snowflake.close();
    await db.pool.end();
  });
