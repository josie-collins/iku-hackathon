// "Past groups spent about X per person per day here", for the shortlist.
// Read from Snowflake when it's configured, otherwise (or if it's slow or down)
// worked out from our own database with the same calculation. The result says
// which source it came from.

const crypto = require('node:crypto');
const db = require('./db');
const snowflake = require('./integrations/snowflake');
const { getRates } = require('./integrations/wise');
const { convertMinor } = require('./logic/fx');
const { buildTripRows, buildDailySpendRows, averageDailySpend } = require('./logic/analytics');

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

  const { rates } = await getRates('EUR', [...trips.map((t) => t.base_currency), ...sample.map((s) => s.currency)]);
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

  return {
    trips: buildTripRows(trips, s),
    dailySpend: [...buildDailySpendRows(expenses, allowed, rates, s), ...sampleRows],
  };
}

async function fromSnowflake() {
  const rows = await snowflake.query(
    'SELECT DESTINATION_CITY, PER_PERSON_DAY_EUR_MINOR, TRIP_DAYS, SAMPLE_ONLY FROM DESTINATION_DAILY_SPEND');
  return Object.fromEntries(rows.map((r) => [r.DESTINATION_CITY, {
    perPersonDayMinor: Number(r.PER_PERSON_DAY_EUR_MINOR),
    days: Number(r.TRIP_DAYS),
    sampleOnly: Boolean(r.SAMPLE_ONLY),
  }]));
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)),
]);

/**
 * @returns {Promise<{ byCity: Object<string, {perPersonDayMinor, days, sampleOnly}>, source: 'snowflake'|'local' }>}
 *          amounts in EUR minor units
 */
async function destinationSpend() {
  if (cache && Date.now() - cache.at < cache.ttl) return cache.value;
  let value;
  if (snowflake.isConfigured()) {
    try {
      value = { byCity: await withTimeout(fromSnowflake(), SNOWFLAKE_TIMEOUT_MS), source: 'snowflake' };
    } catch (err) {
      console.error('Snowflake insights unavailable, using local data:', err.message);
    }
  }
  if (!value) value = { byCity: averageDailySpend((await loadAnalyticsRows()).dailySpend), source: 'local' };
  const fellBack = value.source === 'local' && snowflake.isConfigured();
  cache = { at: Date.now(), ttl: fellBack ? FALLBACK_CACHE_MS : CACHE_MS, value };
  return value;
}

module.exports = { loadAnalyticsRows, destinationSpend };
