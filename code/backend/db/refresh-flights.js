// Live flight prices for every trip that's voting:  npm run flights:refresh
// Shows how many SerpApi searches it would use; add --yes to actually search:
//   npm run flights:refresh -- --yes
// (The free plan has 250 searches a month. Prices are cached for 12 hours.)

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const db = require('../db');
const flights = require('../integrations/flights');
const { refreshGroupFlights } = require('../flightQuotes');
const { routesToSearch, routeKey } = require('../logic/flights');

async function plannedSearches(groupId) {
  const { rows: options } = await db.query(
    `SELECT o.destination_id, d.airport, to_char(o.window_start, 'YYYY-MM-DD') AS s, to_char(o.window_end, 'YYYY-MM-DD') AS e
     FROM destination_options o JOIN destinations d ON d.id = o.destination_id WHERE o.group_id = $1`, [groupId]);
  const { rows: members } = await db.query(
    `SELECT u.departure_airport, u.home_currency FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1`, [groupId]);
  const routes = routesToSearch(
    options.map((o) => ({ destinationId: o.destination_id, airport: o.airport, windowStart: o.s, windowEnd: o.e })),
    members.map((m) => ({ departureAirport: m.departure_airport, currency: m.home_currency })));
  const { rows: fresh } = await db.query(
    `SELECT origin, destination_id, to_char(outbound_date, 'YYYY-MM-DD') AS o, to_char(return_date, 'YYYY-MM-DD') AS r
     FROM flight_quotes WHERE fetched_at > now() - interval '12 hours'`);
  const cached = new Set(fresh.map((q) => routeKey({ origin: q.origin, destinationId: q.destination_id, outbound: q.o, return: q.r })));
  return routes.filter((r) => !cached.has(routeKey(r))).length;
}

async function main() {
  if (!flights.isConfigured()) throw new Error('SERPAPI_KEY is not set in code/backend/.env');
  const go = process.argv.includes('--yes');
  const { rows: groups } = await db.query(`SELECT id, name FROM groups WHERE status = 'voting' ORDER BY name`);
  const left = await flights.searchesLeft();

  let total = 0;
  for (const g of groups) {
    const n = await plannedSearches(g.id);
    total += n;
    console.log(`▸ ${g.name}: ${n} search(es) needed`);
  }
  console.log(`▸ ${total} search(es) in total, ${left} left this month`);
  if (!go) {
    console.log('  Nothing searched. Run again with --yes to search:  npm run flights:refresh -- --yes');
    return;
  }
  for (const g of groups) {
    const r = await refreshGroupFlights(g.id);
    console.log(`▸ ${g.name}: searched ${r.searched}, cached ${r.cached}, dropped ${r.dropped}${r.skipped ? ` (${r.skipped})` : ''}`);
  }
  console.log(`▸ done, ${await flights.searchesLeft()} search(es) left this month`);
}

main()
  .catch((err) => {
    console.error('✖', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
