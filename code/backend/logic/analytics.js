// Anonymised analytics rows for the Snowflake warehouse, and the
// "past groups spent about X per person per day here" figure.
// Pure functions: no network, no database.
//
// PRIVACY: nothing here carries a budget, a name or a user id. Trips are
// identified by a salted hash, only shared and extra spending is included
// (personal spending is private), and trips smaller than MIN_GROUP_SIZE are
// left out so no one's spending can be picked out.

const crypto = require('node:crypto');
const { convertMinor } = require('./fx');

const MIN_GROUP_SIZE = 3;
const SHARED_TYPES = ['shared', 'extra'];

/** Stable, non-reversible id for a trip. */
function tripKey(groupId, salt) {
  return crypto.createHash('sha256').update(`${salt}:${groupId}`).digest('hex').slice(0, 16);
}

/**
 * @param {Array<{id, city, country_code, status, group_size, trip_start, trip_end, base_currency}>} trips
 * @returns {Array<object>} one row per trip big enough to be anonymous
 */
function buildTripRows(trips, salt) {
  return trips
    .filter((t) => t.group_size >= MIN_GROUP_SIZE)
    .map((t) => ({
      trip_key: tripKey(t.id, salt),
      destination_city: t.city || null,
      country_code: t.country_code || null,
      status: t.status,
      group_size: t.group_size,
      nights: t.trip_start && t.trip_end
        ? Math.round((new Date(t.trip_end) - new Date(t.trip_start)) / 86400000)
        : null,
      trip_month: t.trip_start ? `${t.trip_start.slice(0, 7)}-01` : null, // month only, not exact dates
      base_currency: t.base_currency,
    }));
}

/**
 * Total shared + extra spending per trip, day and category, in EUR minor units.
 * @param {Array<{group_id, spent_on, category, type, amount_base_minor}>} expenses
 * @param {Map<string, {id, city, group_size, base_currency}>} tripsById  only trips allowed in the warehouse
 * @param {object} rates  per 1 EUR, from integrations/wise.js
 */
function buildDailySpendRows(expenses, tripsById, rates, salt) {
  const totals = new Map();
  for (const e of expenses) {
    const trip = tripsById.get(e.group_id);
    if (!trip || trip.group_size < MIN_GROUP_SIZE || !SHARED_TYPES.includes(e.type)) continue;
    const key = `${e.group_id}|${e.spent_on}|${e.category}`;
    const eur = convertMinor(Number(e.amount_base_minor), trip.base_currency, 'EUR', rates);
    const row = totals.get(key) || {
      trip_key: tripKey(trip.id, salt),
      destination_city: trip.city,
      spent_on: e.spent_on,
      category: e.category,
      group_size: trip.group_size,
      total_eur_minor: 0,
      is_sample: false,
    };
    row.total_eur_minor += eur;
    totals.set(key, row);
  }
  return [...totals.values()].map((r) => ({
    ...r,
    per_person_eur_minor: Math.round(r.total_eur_minor / r.group_size),
  }));
}

/**
 * Average spend per person per day for each city: add up each trip-day's
 * per-person spend across categories, then average over those trip-days.
 * Same calculation as the DESTINATION_DAILY_SPEND view in Snowflake.
 * @param {Array<{trip_key, destination_city, spent_on, per_person_eur_minor, is_sample}>} rows
 * @returns {Object<string, {perPersonDayMinor: number, days: number, sampleOnly: boolean}>}
 */
function averageDailySpend(rows) {
  const days = new Map(); // city|trip|day -> per-person total
  const sampleFlags = new Map(); // city -> all rows sample?
  for (const r of rows) {
    if (!r.destination_city) continue;
    const key = `${r.destination_city}|${r.trip_key}|${r.spent_on}`;
    days.set(key, (days.get(key) || 0) + r.per_person_eur_minor);
    sampleFlags.set(r.destination_city, (sampleFlags.get(r.destination_city) ?? true) && Boolean(r.is_sample));
  }
  const byCity = {};
  for (const [key, total] of days) {
    const city = key.split('|')[0];
    byCity[city] = byCity[city] || { sum: 0, days: 0 };
    byCity[city].sum += total;
    byCity[city].days += 1;
  }
  return Object.fromEntries(Object.entries(byCity).map(([city, { sum, days: n }]) => [
    city,
    { perPersonDayMinor: Math.round(sum / n), days: n, sampleOnly: sampleFlags.get(city) },
  ]));
}

module.exports = { MIN_GROUP_SIZE, tripKey, buildTripRows, buildDailySpendRows, averageDailySpend };
