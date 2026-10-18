// Live flight prices from SerpApi's Google Flights engine.
//   GET https://serpapi.com/search.json?engine=google_flights&departure_id=LHR&arrival_id=LIS
//       &outbound_date=2027-06-08&return_date=2027-06-13&type=1&currency=GBP&sort_by=2
// For a round trip (type=1), each itinerary's `price` is the whole round trip for
// one adult, in whole units of `currency` (e.g. 171 = £171). Checked with a real
// search on 18 Oct 2026.
//
// SERPAPI_KEY in .env. The free plan has 250 searches a month, so callers cache
// results and check searchesLeft() (free, doesn't use a search) before a batch.

const API = 'https://serpapi.com';
const TIMEOUT_MS = 20000;
// Google Flights doesn't price in every currency (NGN is rejected, checked 18 Oct 2026).
// Those are searched in EUR instead and converted by the caller with the Wise rates.
const FALLBACK_CURRENCY = 'EUR';
const unsupported = new Set(['NGN']);

const isConfigured = () => Boolean(process.env.SERPAPI_KEY);

async function getJson(path, params) {
  const url = `${API}${path}?${new URLSearchParams({ ...params, api_key: process.env.SERPAPI_KEY })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`SerpApi: ${body.error || `responded ${res.status}`}`);
  return body;
}

/** Searches left this month (the Account API doesn't use a search). */
async function searchesLeft() {
  const account = await getJson('/account.json', {});
  return Number(account.total_searches_left ?? 0);
}

/**
 * Cheapest round trip for one adult, economy.
 * @returns {Promise<{priceMinor, currency, airline, stops, googleFlightsUrl} | null>} null if no flights
 */
async function searchRoundTrip({ origin, destination, outbound, ret, currency: wanted }) {
  let currency = unsupported.has(wanted) ? FALLBACK_CURRENCY : wanted;
  let body;
  try {
    body = await search({ origin, destination, outbound, ret, currency });
  } catch (err) {
    if (currency === FALLBACK_CURRENCY || !/unsupported .*currency/i.test(err.message)) throw err;
    unsupported.add(currency); // don't waste a search on it again
    currency = FALLBACK_CURRENCY;
    body = await search({ origin, destination, outbound, ret, currency });
  }
  const itineraries = [...(body.best_flights || []), ...(body.other_flights || [])].filter((i) => i.price > 0);
  if (!itineraries.length) return null;
  const cheapest = itineraries.reduce((a, b) => (b.price < a.price ? b : a));
  const legs = cheapest.flights || [];
  return {
    priceMinor: Math.round(cheapest.price * 100),
    currency, // may differ from the one asked for (see FALLBACK_CURRENCY)
    airline: legs.length ? legs[0].airline : null,
    stops: Math.max(0, legs.length - 1), // outbound legs; 0 = direct
    googleFlightsUrl: body.search_metadata ? body.search_metadata.google_flights_url : null,
  };
}

function search({ origin, destination, outbound, ret, currency }) {
  return getJson('/search.json', {
    engine: 'google_flights',
    departure_id: origin,
    arrival_id: destination,
    outbound_date: outbound,
    return_date: ret,
    type: '1',
    currency,
    hl: 'en',
    adults: '1',
    sort_by: '2', // price
  });
}

module.exports = { isConfigured, searchesLeft, searchRoundTrip };
