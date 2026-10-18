const test = require('node:test');
const assert = require('node:assert/strict');
const { computeCeiling } = require('../logic/ceiling');

// Seed group budgets in EUR cents: Tom £500 ≈ €581.40, Amara €500, Lucia €450
const seed = (luciaAnswer = null) => [
  { userId: 'tom', groupBudgetBase: 58140, acceptsStretch: null },
  { userId: 'amara', groupBudgetBase: 50000, acceptsStretch: null },
  { userId: 'lucia', groupBudgetBase: 45000, acceptsStretch: luciaAnswer },
];

test('stretch ceiling follows the formula', () => {
  // lowest 45000 + min(10% of 13140, 10% of 45000) = 45000 + 1314
  assert.equal(computeCeiling(seed()).stretchCeiling, 46314);
});

test('unanswered stretch keeps the ceiling at the lowest budget', () => {
  const r = computeCeiling(seed(null));
  assert.equal(r.ceiling, 45000);
  assert.deepEqual(r.pendingConsent, ['lucia']);
});

test('saying no keeps the ceiling at their budget', () => {
  const r = computeCeiling(seed(false));
  assert.equal(r.ceiling, 45000);
  assert.deepEqual(r.pendingConsent, []);
});

test('saying yes raises it to the stretch ceiling', () => {
  assert.equal(computeCeiling(seed(true)).ceiling, 46314);
});

test('stretch is capped at 10% of the lowest budget', () => {
  const r = computeCeiling([
    { userId: 'a', groupBudgetBase: 10000, acceptsStretch: true },
    { userId: 'b', groupBudgetBase: 90000, acceptsStretch: true },
  ]);
  assert.equal(r.ceiling, 11000);
});

test('if two people are below the stretch ceiling, either can hold it down', () => {
  const r = computeCeiling([
    { userId: 'a', groupBudgetBase: 40000, acceptsStretch: true },
    { userId: 'b', groupBudgetBase: 41000, acceptsStretch: false },
    { userId: 'c', groupBudgetBase: 80000, acceptsStretch: null },
  ]);
  assert.equal(r.stretchCeiling, 44000);
  assert.equal(r.ceiling, 41000);
});

test('limitingUserIds lists who sits at or under the ceiling (server-only)', () => {
  assert.deepEqual(computeCeiling(seed()).limitingUserIds, ['lucia']);
});

test('one member: no stretch', () => {
  assert.equal(computeCeiling([{ userId: 'a', groupBudgetBase: 30000, acceptsStretch: true }]).ceiling, 30000);
});
