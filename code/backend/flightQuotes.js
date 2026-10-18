// Live flight prices for a group's shortlist. Runs in the background after a
// recompute: searches each shortlisted option's routes (cached for 12 hours),
// then drops any option a live price has pushed over someone's flight budget.
// Nothing here runs on db:reset, so resets never use up searches.

const db = require('./db');
const flights = require('./integrations/flights');
const { getRates } = require('./integrations/wise');
const { routeKey, routesToSearch, stillFits } = require('./logic/flights');

const FRESH_HOURS = 12;
const RESERVE = 20; // stop searching while this many are left this month
const MAX_PER_GROUP = 15; // searches per refresh, at most

/**
 * @returns {Promise<{ searched: number, cached: number, dropped: number, skipped?: string }>}
 */
async function refreshGroupFlights(groupId) {
  const { rows: options } = await db.query(
    `SELECT o.id, o.destination_id, d.airport, d.city,
            to_char(o.window_start, 'YYYY-MM-DD') AS window_start,
            to_char(o.window_end, 'YYYY-MM-DD') AS window_end
     FROM destination_options o
     JOIN destinations d ON d.id = o.destination_id
     JOIN groups g ON g.id = o.group_id
     WHERE o.group_id = $1 AND g.status = 'voting'`, [groupId]);
  if (!options.length) return { searched: 0, cached: 0, dropped: 0 };

  const { rows: memberRows } = await db.query(
    `SELECT u.departure_airport, COALESCE(b.currency, u.home_currency) AS currency, b.flight_minor
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     LEFT JOIN budgets b ON b.group_id = gm.group_id AND b.user_id = gm.user_id
     WHERE gm.group_id = $1`, [groupId]);
  const members = memberRows.map((m) => ({
    departureAirport: m.departure_airport, currency: m.currency, flightBudgetMinor: Number(m.flight_minor),
  }));

  const asOptions = options.map((o) => ({
    id: o.id, destinationId: o.destination_id, airport: o.airport, windowStart: o.window_start, windowEnd: o.window_end,
  }));
  const routes = routesToSearch(asOptions, members);

  // Cached quotes still fresh enough
  const quotes = new Map();
  const { rows: cachedRows } = await db.query(
    `SELECT origin, destination_id, to_char(outbound_date, 'YYYY-MM-DD') AS outbound,
            to_char(return_date, 'YYYY-MM-DD') AS ret, price_minor, currency
     FROM flight_quotes
     WHERE destination_id = ANY($1::uuid[]) AND fetched_at > now() - make_interval(hours => $2)`,
    [[...new Set(asOptions.map((o) => o.destinationId))], FRESH_HOURS]);
  for (const q of cachedRows) {
    quotes.set(routeKey({ origin: q.origin, destinationId: q.destination_id, outbound: q.outbound, return: q.ret }),
      { priceMinor: Number(q.price_minor), currency: q.currency });
  }
  const missing = routes.filter((r) => !quotes.has(routeKey(r)));

  let searched = 0;
  let skipped;
  if (missing.length && flights.isConfigured()) {
    const left = await flights.searchesLeft().catch(() => 0);
    const allowed = Math.min(MAX_PER_GROUP, Math.max(0, left - RESERVE));
    if (allowed < missing.length) skipped = `only ${allowed} of ${missing.length} searches allowed (${left} left this month)`;
    for (const r of missing.slice(0, allowed)) {
      try {
        const found = await flights.searchRoundTrip({
          origin: r.origin, destination: r.airport, outbound: r.outbound, ret: r.return, currency: r.currency,
        });
        searched += 1;
        if (!found) continue;
        await db.query(
          `INSERT INTO flight_quotes (origin, destination_id, outbound_date, return_date, price_minor, currency,
                                      airline, stops, google_flights_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (origin, destination_id, outbound_date, return_date, currency) DO UPDATE SET
             price_minor = EXCLUDED.price_minor, airline = EXCLUDED.airline, stops = EXCLUDED.stops,
             google_flights_url = EXCLUDED.google_flights_url, fetched_at = now()`,
          [r.origin, r.destinationId, r.outbound, r.return, found.priceMinor, found.currency,
            found.airline, found.stops, found.googleFlightsUrl]);
        quotes.set(routeKey(r), { priceMinor: found.priceMinor, currency: found.currency });
      } catch (err) {
        console.error(`flight search ${r.origin}->${r.airport} failed: ${err.message}`);
      }
    }
  } else if (missing.length) {
    skipped = 'SERPAPI_KEY not set';
  }

  // Drop options a live price has pushed over someone's own flight budget.
  const { rates } = await getRates('EUR', [...members.map((m) => m.currency), ...[...quotes.values()].map((q) => q.currency)]);
  const failing = asOptions.filter((o) => !stillFits(o, members, quotes, rates)).map((o) => o.id);
  if (failing.length) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [groupId]); // same lock as the recompute
      await client.query('DELETE FROM destination_options WHERE id = ANY($1::uuid[])', [failing]);
      await client.query(
        `UPDATE groups SET status = 'resolving'
         WHERE id = $1 AND status = 'voting' AND NOT EXISTS (SELECT 1 FROM destination_options WHERE group_id = $1)`,
        [groupId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return { searched, cached: routes.length - missing.length, dropped: failing.length, ...(skipped && { skipped }) };
}

function flightsInBackground(groupId) {
  refreshGroupFlights(groupId)
    .then((r) => {
      if (r.searched || r.dropped || r.skipped) console.log(`flights for group ${groupId}:`, r);
    })
    .catch((err) => console.error(`flights failed for group ${groupId}:`, err.message));
}

module.exports = { refreshGroupFlights, flightsInBackground };
