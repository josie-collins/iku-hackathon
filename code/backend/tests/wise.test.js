const test = require('node:test');
const assert = require('node:assert/strict');
const { getRates, clearCache, FALLBACK_PER_EUR } = require('../integrations/wise');

const okFetch = (rates) => async (url) => {
  const target = new URL(url).searchParams.get('target');
  return { ok: true, json: async () => [{ rate: rates[target], source: 'EUR', target }] };
};
const failingFetch = async () => { throw new Error('network down'); };

test.beforeEach(() => clearCache());

test('uses Wise rates when available', async () => {
  const r = await getRates('EUR', ['GBP', 'NGN'], { apiKey: 'test', fetchImpl: okFetch({ GBP: 0.85, NGN: 1650 }) });
  assert.equal(r.source, 'wise');
  assert.deepEqual(r.rates, { EUR: 1, GBP: 0.85, NGN: 1650 });
});

test('falls back to labelled static rates when Wise is unreachable', async () => {
  const r = await getRates('EUR', ['GBP', 'NGN'], { apiKey: 'test', fetchImpl: failingFetch });
  assert.equal(r.source, 'fallback');
  assert.equal(r.rates.GBP, FALLBACK_PER_EUR.GBP);
  assert.equal(r.rates.NGN, FALLBACK_PER_EUR.NGN);
});

test('falls back when no API key is set', async () => {
  const r = await getRates('EUR', ['GBP'], { apiKey: '', fetchImpl: okFetch({ GBP: 0.85 }) });
  assert.equal(r.source, 'fallback');
});

test('prefers the last good Wise rate over the static table', async () => {
  await getRates('EUR', ['GBP'], { apiKey: 'test', fetchImpl: okFetch({ GBP: 0.85 }), now: 0 });
  const r = await getRates('EUR', ['GBP'], { apiKey: 'test', fetchImpl: failingFetch, now: 2 * 60 * 60 * 1000 });
  assert.equal(r.source, 'fallback');
  assert.equal(r.rates.GBP, 0.85);
});

test('serves from cache within the hour without calling Wise', async () => {
  let calls = 0;
  const counting = async (url) => { calls++; return okFetch({ GBP: 0.85 })(url); };
  await getRates('EUR', ['GBP'], { apiKey: 'test', fetchImpl: counting, now: 0 });
  await getRates('EUR', ['GBP'], { apiKey: 'test', fetchImpl: counting, now: 1000 });
  assert.equal(calls, 1);
});
