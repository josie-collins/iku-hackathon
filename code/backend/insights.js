// "Past groups spent about X per person per day here", for the shortlist.
// Read from Snowflake when it's configured, otherwise (or if it's slow or down)
// worked out from our own database with the same calculation. The result says
// which source it came from.

const crypto = require('node:crypto');
const db = require('./db');
const snowflake = require('./integrations/snowflake');
const { getRates } = require('./integrations/wise');
const { convertMinor } = require('./logic/fx');
const { buildTripRows, buildDailySpendRows, averageDailySpend, averageDailySpendByMonth } = require('./logic/analytics');

const CACHE_MS = 60 * 60 * 1000; // one hour
const FALLBACK_CACHE_MS = 5 * 60 * 1000; // retry Snowflake sooner after a failure
const SNOWFLAKE_TIMEOUT_MS = 4000;
let cache = null; // { at, ttl, value }

// Salt for trip keys. Separate from the JWT secret itself, but derived from it by default.
const salt = () => process.env.ANALYTICS_SALT
  || crypto.createHash('sha256').update(`analytics:${process.env.JWT_SECRET || ''}`).digest('hex');

/** Anonymised rows from Postgres: what the Snowflake sync sends, and what the fallback uses. */
async function loadAnalyticsRows() {
  const { rows: trips } = await db.query(
    `SELECT g.id, g.status, g.base_currency, d.city, d.country_code,
            to_char(g.trip_start, 'YYYY-MM-DD') AS trip_start,
            to_char(g.trip_end, 'YYYY-MM-DD') AS trip_end,
            (SELECT count(*)::int FROM group_members gm WHERE gm.group_id = g.id) AS group_size
     FROM groups g JOIN destinations d ON d.id = g.destination_id`);
  const { rows: expenses } = await db.query(
    `SELECT group_id, to_char(spent_on, 'YYYY-MM-DD') AS spent_on, category, type, amount_base_minor
     FROM expenses WHERE type <> 'personal'`);
  const { rows: sample } = await db.query(
    `SELECT d.city, to_char(s.spent_on, 'YYYY-MM-DD') AS spent_on, s.category, s.group_size,
            s.per_person_minor, s.currency
     FROM sample_trip_spend s JOIN destinations d ON d.id = s.destination_id`);

  // Reference costs per city (sample data, nothing private): for the spend split.
  const { rows: places } = await db.query(
    `SELECT city, country_code, tags, base_currency,
            accommodation_pp_night_minor, food_pp_day_minor, activities_pp_day_minor
     FROM destinations ORDER BY city`);

  const { rates } = await getRates('EUR', [
    ...trips.map((t) => t.base_currency), ...sample.map((s) => s.currency), ...places.map((p) => p.base_currency),
  ]);
  const s = salt();
  const allowed = new Map(trips.map((t) => [t.id, t]));
  const sampleRows = sample.map((r) => {
    const perPerson = convertMinor(Number(r.per_person_minor), r.currency, 'EUR', rates);
    return {
      trip_key: `sample:${r.city}`,
      destination_city: r.city,
      spent_on: r.spent_on,
      category: r.category,
      group_size: r.group_size,
      total_eur_minor: perPerson * r.group_size,
      per_person_eur_minor: perPerson,
      is_sample: true,
    };
  });

  const toEur = (minor, currency) => convertMinor(Number(minor), currency, 'EUR', rates);
  return {
    destinations: places.map((p) => ({
      city: p.city,
      country_code: p.country_code,
      tags: p.tags.join(','),
      stay_pp_night_eur_minor: toEur(p.accommodation_pp_night_minor, p.base_currency),
      food_pp_day_eur_minor: toEur(p.food_pp_day_minor, p.base_currency),
      activities_pp_day_eur_minor: toEur(p.activities_pp_day_minor, p.base_currency),
    })),
    trips: buildTripRows(trips, s),
    dailySpend: [...buildDailySpendRows(expenses, allowed, rates, s), ...sampleRows],
  };
}

const fromRow = (r) => ({
  perPersonDayMinor: Number(r.PER_PERSON_DAY_EUR_MINOR),
  days: Number(r.TRIP_DAYS),
  sampleOnly: Boolean(r.SAMPLE_ONLY),
});

// A typical day's reference costs per city, in EUR minor units
const splitOf = (stay, food, activities) => ({ stayMinor: Number(stay), foodMinor: Number(food), activitiesMinor: Number(activities) });

async function fromSnowflake() {
  const [yearly, monthly, places] = await Promise.all([
    snowflake.query('SELECT DESTINATION_CITY, PER_PERSON_DAY_EUR_MINOR, TRIP_DAYS, SAMPLE_ONLY FROM DESTINATION_DAILY_SPEND'),
    snowflake.query('SELECT DESTINATION_CITY, MONTH, PER_PERSON_DAY_EUR_MINOR, TRIP_DAYS, SAMPLE_ONLY FROM DESTINATION_MONTHLY_SPEND'),
    snowflake.query(`SELECT CITY, COUNTRY_CODE, STAY_PP_NIGHT_EUR_MINOR, FOOD_PP_DAY_EUR_MINOR, ACTIVITIES_PP_DAY_EUR_MINOR
                     FROM DESTINATIONS`),
  ]);
  const byCityMonth = {};
  for (const r of monthly) (byCityMonth[r.DESTINATION_CITY] = byCityMonth[r.DESTINATION_CITY] || {})[Number(r.MONTH)] = fromRow(r);
  return {
    byCity: Object.fromEntries(yearly.map((r) => [r.DESTINATION_CITY, fromRow(r)])),
    byCityMonth,
    byCitySplit: Object.fromEntries(places.map((p) => [p.CITY, {
      countryCode: p.COUNTRY_CODE,
      ...splitOf(p.STAY_PP_NIGHT_EUR_MINOR, p.FOOD_PP_DAY_EUR_MINOR, p.ACTIVITIES_PP_DAY_EUR_MINOR),
    }])),
  };
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)),
]);

/**
 * @returns {Promise<{ byCity, byCityMonth, byCitySplit, source: 'snowflake'|'local' }>}
 *          byCity[city] and byCityMonth[city][1-12] are {perPersonDayMinor, days, sampleOnly};
 *          byCitySplit[city] is {countryCode, stayMinor, foodMinor, activitiesMinor}. All in EUR minor units.
 */
async function destinationSpend() {
  if (cache && Date.now() - cache.at < cache.ttl) return cache.value;
  let value;
  if (snowflake.isConfigured()) {
    try {
      value = { ...(await withTimeout(fromSnowflake(), SNOWFLAKE_TIMEOUT_MS)), source: 'snowflake' };
    } catch (err) {
      console.error('Snowflake insights unavailable, using local data:', err.message);
    }
  }
  if (!value) {
    const { dailySpend, destinations } = await loadAnalyticsRows();
    value = {
      byCity: averageDailySpend(dailySpend),
      byCityMonth: averageDailySpendByMonth(dailySpend),
      byCitySplit: Object.fromEntries(destinations.map((d) => [d.city, {
        countryCode: d.country_code,
        ...splitOf(d.stay_pp_night_eur_minor, d.food_pp_day_eur_minor, d.activities_pp_day_eur_minor),
      }])),
      source: 'local',
    };
  }
  const fellBack = value.source === 'local' && snowflake.isConfigured();
  cache = { at: Date.now(), ttl: fellBack ? FALLBACK_CACHE_MS : CACHE_MS, value };
  return value;
}

module.exports = { loadAnalyticsRows, destinationSpend };
