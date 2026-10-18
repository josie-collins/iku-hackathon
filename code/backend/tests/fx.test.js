const test = require('node:test');
const assert = require('node:assert/strict');
const { convertMinor, rateBetween } = require('../logic/fx');
const { RATES } = require('./fixtures/seed');

test('same currency is unchanged', () => {
  assert.equal(convertMinor(12345, 'EUR', 'EUR', RATES), 12345);
});

test("Tom's £500 group budget is about €581.40", () => {
  assert.equal(convertMinor(50000, 'GBP', 'EUR', RATES), 58140);
});

test("Amara's ₦850,000 group budget is €500", () => {
  assert.equal(convertMinor(85000000, 'NGN', 'EUR', RATES), 50000);
});

test('€42 of food is ₦71,400', () => {
  assert.equal(convertMinor(4200, 'EUR', 'NGN', RATES), 7140000);
});

test('round trip stays within one minor unit', () => {
  const back = convertMinor(convertMinor(12345, 'GBP', 'NGN', RATES), 'NGN', 'GBP', RATES);
  assert.ok(Math.abs(back - 12345) <= 1);
});

test('zero-decimal currencies use whole units', () => {
  assert.equal(convertMinor(1000, 'EUR', 'JPY', { EUR: 1, JPY: 160 }), 1600);
});

test('missing rate throws instead of guessing', () => {
  assert.throws(() => convertMinor(100, 'EUR', 'USD', RATES), /No exchange rate for USD/);
});

test('rateBetween gives units of target per unit of source', () => {
  assert.equal(rateBetween('EUR', 'NGN', RATES), 1700);
  assert.ok(Math.abs(rateBetween('GBP', 'EUR', RATES) - 1 / 0.86) < 1e-12);
});
