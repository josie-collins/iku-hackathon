const test = require('node:test');
const assert = require('node:assert/strict');
const { findOptions } = require('../logic/feasibility');
const { input, members, AMARA, LUCIA, TOM } = require('./fixtures/seed');

const cities = (result) => result.options.map((o) => o.city).sort();

function withMember(userId, changes) {
  return members().map((m) => (m.userId === userId ? { ...m, ...changes } : m));
}

test('seed shortlist is Lisbon, Porto and Valencia', () => {
  const r = findOptions(input());
  assert.equal(r.status, 'options');
  assert.deepEqual(cities(r), ['Lisbon', 'Porto', 'Valencia']);
});

test("Amara's flight budget rules out Prague, Budapest, Athens and Split", () => {
  const r = findOptions(input());
  assert.deepEqual(r.diagnostics.blockedFlight[AMARA], ['Prague', 'Budapest', 'Athens', 'Split']);
  assert.deepEqual(r.diagnostics.blockedFlight[TOM], []);
});

test("Barcelona's food costs more per day than Amara's daily budget", () => {
  const r = findOptions(input());
  assert.ok(r.diagnostics.blockedFood[AMARA].includes('Barcelona'));
});

test('trip length keeps shared cost under 90% of the ceiling', () => {
  const byCity = Object.fromEntries(findOptions(input()).options.map((o) => [o.city, o]));
  // ceiling €450 -> headroom €405
  assert.equal(byCity.Lisbon.nights, 5); // 5 x €77 = €385
  assert.equal(byCity.Lisbon.estCostPpMinor, 38500);
  assert.equal(byCity.Porto.nights, 6); // 6 x €66 = €396
  assert.equal(byCity.Valencia.nights, 5); // 5 x €70 = €350
  for (const o of Object.values(byCity)) {
    assert.ok(o.estCostPpMinor <= 40500);
    assert.equal(o.windowStart, '2027-06-08');
    assert.equal(o.currency, 'EUR');
  }
});

test('options contain no budgets, ceiling or margins', () => {
  const allowed = [
    'destinationId', 'city', 'tags', 'windowStart', 'windowEnd', 'nights',
    'estCostPpMinor', 'currency', 'matchingStyles',
  ].sort();
  for (const o of findOptions(input()).options) {
    assert.deepEqual(Object.keys(o).sort(), allowed);
  }
});

test('raising Amara\'s flight budget adds Prague and Budapest', () => {
  const r = findOptions(input({ members: withMember(AMARA, { flightBudgetMinor: 50000000 }) }));
  assert.deepEqual(cities(r), ['Budapest', 'Lisbon', 'Porto', 'Prague', 'Valencia']);
});

test('the same options come back however budgets change, never with extra fields', () => {
  const before = findOptions(input()).options;
  const after = findOptions(input({ members: withMember(TOM, { groupBudgetMinor: 90000 }) })).options;
  assert.deepEqual(Object.keys(after[0]).sort(), Object.keys(before[0]).sort());
});

test('a very low group budget gives a neutral no-match', () => {
  const r = findOptions(input({ members: withMember(LUCIA, { groupBudgetMinor: 20000 }) }));
  assert.equal(r.status, 'no_match');
  assert.equal(r.diagnostics.reason, 'budget');
  assert.deepEqual(r.options, []);
  assert.deepEqual(r.diagnostics.tooExpensiveShared.sort(), ['Lisbon', 'Porto', 'Valencia']);
  assert.deepEqual(r.diagnostics.limitingUserIds, [LUCIA]);
});

test('no shared dates gives a no-match for dates', () => {
  const r = findOptions(input({ members: withMember(TOM, { availability: [{ start: '2027-01-01', end: '2027-01-10' }] }) }));
  assert.equal(r.status, 'no_match');
  assert.equal(r.diagnostics.reason, 'dates');
});

test('incompatible trip lengths give a no-match for trip length', () => {
  const r = findOptions(input({ members: withMember(TOM, { minNights: 8, maxNights: 10 }) }));
  assert.equal(r.diagnostics.reason, 'trip_length');
});

test('a missing flight estimate counts as not fitting', () => {
  const r = findOptions(input({ flights: input().flights.filter((f) => !(f.origin === 'LHR' && f.destinationId === 'dest-lisbon')) }));
  assert.ok(!cities(r).includes('Lisbon'));
});

test('stretch consent can only add options, never remove them', () => {
  const base = cities(findOptions(input()));
  const stretched = cities(findOptions(input({ members: withMember(LUCIA, { acceptsStretch: true }) })));
  for (const c of base) assert.ok(stretched.includes(c));
});
