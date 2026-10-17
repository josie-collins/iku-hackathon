const test = require('node:test');
const assert = require('node:assert/strict');
const { splitEvenly, computeBalances, settleUp, countsTowardsPace, pace } = require('../logic/expenses');

const total = (shares) => shares.reduce((sum, s) => sum + s.shareMinor, 0);

test('even split hands the leftover cents to the first people', () => {
  const shares = splitEvenly(1000, ['a', 'b', 'c']);
  assert.deepEqual(shares.map((s) => s.shareMinor), [334, 333, 333]);
  assert.equal(total(shares), 1000);
});

test('split always adds up exactly', () => {
  for (const amount of [1, 2, 99, 100, 101, 8372, 123457]) {
    for (let n = 1; n <= 7; n++) {
      const ids = Array.from({ length: n }, (_, i) => `u${i}`);
      assert.equal(total(splitEvenly(amount, ids)), amount, `${amount} / ${n}`);
    }
  }
});

test('split needs at least one person', () => {
  assert.throws(() => splitEvenly(100, []));
});

test('balances: payer is owed what others owe', () => {
  const balances = computeBalances(['tom', 'lucia', 'amara'], [
    { payerId: 'lucia', amountBaseMinor: 900, participants: splitEvenly(900, ['tom', 'lucia', 'amara']).map((s) => ({ userId: s.userId, shareBaseMinor: s.shareMinor })) },
  ]);
  assert.deepEqual(balances, { tom: -300, lucia: 600, amara: -300 });
});

test('balances always sum to zero', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const expenses = [
    { payerId: 'a', amountBaseMinor: 1001, participants: splitEvenly(1001, ids) },
    { payerId: 'b', amountBaseMinor: 250, participants: splitEvenly(250, ['b', 'c']) },
    { payerId: 'd', amountBaseMinor: 77, participants: splitEvenly(77, ['d']) },
  ].map((e) => ({ ...e, participants: e.participants.map((s) => ({ userId: s.userId, shareBaseMinor: s.shareMinor })) }));
  const balances = computeBalances(ids, expenses);
  assert.equal(Object.values(balances).reduce((s, v) => s + v, 0), 0);
  assert.equal(balances.d, -250); // their share of a's 1001; paying for themselves cancels out
});

test('settle up clears every balance', () => {
  const balances = { a: 700, b: -300, c: -250, d: -150 };
  const transfers = settleUp(balances);
  const after = { ...balances };
  for (const t of transfers) {
    after[t.from] += t.amountMinor;
    after[t.to] -= t.amountMinor;
  }
  assert.deepEqual(after, { a: 0, b: 0, c: 0, d: 0 });
  assert.ok(transfers.length <= 3);
});

test('settle up with nothing owed makes no payments', () => {
  assert.deepEqual(settleUp({ a: 0, b: 0 }), []);
});

test('settle up uses few payments when debts line up', () => {
  // b owes exactly what a is owed, c exactly what d is owed
  const transfers = settleUp({ a: 500, b: -500, c: -200, d: 200 });
  assert.equal(transfers.length, 2);
});

test('pace counts food, extras and personal spending, not shared stays', () => {
  assert.equal(countsTowardsPace({ type: 'shared', category: 'food' }), true);
  assert.equal(countsTowardsPace({ type: 'shared', category: 'accommodation' }), false);
  assert.equal(countsTowardsPace({ type: 'shared', category: 'transport' }), false);
  assert.equal(countsTowardsPace({ type: 'extra', category: 'other' }), true);
  assert.equal(countsTowardsPace({ type: 'personal', category: 'transport' }), true);
});

test('pace compares spending with the daily budget so far', () => {
  assert.deepEqual(pace({ dailyBudgetMinor: 6000, spentMinor: 10200, days: 2 }), {
    days: 2, allowanceMinor: 12000, spentMinor: 10200, underMinor: 1800,
  });
  assert.equal(pace({ dailyBudgetMinor: 6000, spentMinor: 7000, days: 1 }).underMinor, -1000);
});
