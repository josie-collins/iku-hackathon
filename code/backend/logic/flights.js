// Live flight prices for the shortlist. Pure functions: no network, no database.
//
// The shortlist is screened with sample estimates (feasibility.js). Afterwards we
// fetch live round-trip prices only for the options that made it, and drop any
// option whose live price is over a member's own flight budget.
//
// PRIVACY: flight budgets never leave this check. The group only sees that an
// option is no longer on the shortlist, never whose flight was the problem.

const { convertMinor } = require('./fx');

const routeKey = (r) => `${r.origin}|${r.destinationId}|${r.outbound}|${r.return}`;

/**
 * The searches the shortlist needs: one per departure airport, destination and dates.
 * @param {Array<{destinationId, airport, windowStart, windowEnd}>} options
 * @param {Array<{departureAirport, currency}>} members
 * @returns {Array<{origin, destinationId, airport, outbound, return, currency}>}
 *          `currency` is the first member at that airport's (others are converted)
 */
function routesToSearch(options, members) {
  const routes = new Map();
  for (const o of options) {
    if (!o.airport) continue; // day-hike spots have no airport
    for (const m of members) {
      if (!m.departureAirport || m.departureAirport === o.airport) continue;
      const route = {
        origin: m.departureAirport,
        destinationId: o.destinationId,
        airport: o.airport,
        outbound: o.windowStart,
        return: o.windowEnd,
        currency: m.currency,
      };
      if (!routes.has(routeKey(route))) routes.set(routeKey(route), route);
    }
  }
  return [...routes.values()];
}

/**
 * Does an option still fit everyone once live prices are known?
 * A member with no live quote (search failed, or out of searches) is assumed to
 * still fit: the sample estimate already passed screening.
 * @param {{destinationId, windowStart, windowEnd}} option
 * @param {Array<{departureAirport, currency, flightBudgetMinor}>} members
 * @param {Map<string, {priceMinor, currency}>} quotes  keyed by routeKey
 * @param {object} rates  per 1 EUR
 */
function stillFits(option, members, quotes, rates) {
  for (const m of members) {
    const quote = quotes.get(routeKey({
      origin: m.departureAirport, destinationId: option.destinationId, outbound: option.windowStart, return: option.windowEnd,
    }));
    if (!quote) continue;
    const price = convertMinor(quote.priceMinor, quote.currency, m.currency, rates);
    if (price > m.flightBudgetMinor) return false;
  }
  return true;
}

module.exports = { routeKey, routesToSearch, stillFits };
