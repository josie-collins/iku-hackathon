// Exchange rates from Wise, with a labelled fallback.
//
// Uses the Wise rates endpoint: GET {WISE_API_URL}/v1/rates?source=EUR&target=GBP
// with `Authorization: Bearer <WISE_API_KEY>`. Check the response shape against
// Wise's current API docs when wiring up the key; parseWiseRate() is the one
// place to adjust if it differs.
//
// Returns rates in the shape logic/fx.js expects: { CCY: units per 1 base }.

const WISE_API_URL = process.env.WISE_BASE_URL;
const CACHE_MS = 60 * 60 * 1000; // one hour

// APPROXIMATE placeholder rates, per 1 EUR. Only used when Wise can't be reached,
// and always returned with source 'fallback' so the UI can label them.
// Update these before the demo.
const FALLBACK_PER_EUR = { EUR: 1, GBP: 0.86, NGN: 1700, USD: 1.08 };

const cache = new Map(); // `${base}:${ccy}` -> { rate, fetchedAt }

function parseWiseRate(body) {
  const row = Array.isArray(body) ? body[0] : body;
  const rate = Number(row && row.rate);
  if (!(rate > 0)) throw new Error('Unexpected Wise response');
  return rate;
}

function fallbackRate(base, currency) {
  const fromBase = FALLBACK_PER_EUR[base];
  const toCcy = FALLBACK_PER_EUR[currency];
  if (!fromBase || !toCcy) throw new Error(`No fallback rate for ${base}->${currency}`);
  return toCcy / fromBase;
}

/**
 * @param {string} base         e.g. 'EUR'
 * @param {string[]} currencies e.g. ['GBP', 'NGN']
 * @param {object} [opts]       fetchImpl and now can be injected for tests
 * @returns {Promise<{ rates: object, source: 'wise'|'fallback', fetchedAt: string }>}
 */
async function getRates(base, currencies, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const now = opts.now ?? Date.now();
  const apiKey = opts.apiKey ?? process.env.WISE_API_KEY;

  const rates = { [base]: 1 };
  let source = 'wise';
  let oldest = now;

  for (const ccy of new Set(currencies)) {
    if (ccy === base) continue;
    const key = `${base}:${ccy}`;
    const hit = cache.get(key);
    if (hit && now - hit.fetchedAt < CACHE_MS && !opts.noCache) {
      rates[ccy] = hit.rate;
      oldest = Math.min(oldest, hit.fetchedAt);
      continue;
    }
    try {
      if (!apiKey) throw new Error('WISE_API_KEY not set');
      const res = await fetchImpl(`${WISE_API_URL}/v1/rates?source=${base}&target=${ccy}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`Wise responded ${res.status}`);
      const rate = parseWiseRate(await res.json());
      cache.set(key, { rate, fetchedAt: now });
      rates[ccy] = rate;
    } catch (err) {
      // Last good Wise rate beats the static table, but either way it's labelled fallback.
      rates[ccy] = hit ? hit.rate : fallbackRate(base, ccy);
      if (hit) oldest = Math.min(oldest, hit.fetchedAt);
      source = 'fallback';
    }
  }

  return { rates, source, fetchedAt: new Date(oldest).toISOString() };
}

function clearCache() {
  cache.clear();
}

module.exports = { getRates, clearCache, FALLBACK_PER_EUR };