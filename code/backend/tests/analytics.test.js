const test = require('node:test');
const assert = require('node:assert/strict');
const { tripKey, buildTripRows, buildDailySpendRows, averageDailySpend, averageDailySpendByMonth } = require('../logic/analytics');

const SALT = 'test-salt';
const RATES = { EUR: 1, GBP: 0.86 };
const porto = { id: 'g-porto', city: 'Porto', country_code: 'PT', status: 'on_trip', group_size: 3,
  trip_start: '2026-10-16', trip_end: '2026-10-19', base_currency: 'EUR' };
const pair = { id: 'g-pair', city: 'Lisbon', country_code: 'PT', status: 'settled', group_size: 2,
  trip_start: '2026-04-03', trip_end: '2026-04-08', base_currency: 'EUR' };
const london = { id: 'g-gbp', city: 'Peak District', country_code: 'GB', status: 'settled', group_size: 3,
  trip_start: '2026-09-13', trip_end: '2026-09-13', base_currency: 'GBP' };

test('trip keys are stable, salted and hide the id', () => {
  assert.equal(tripKey('g-porto', SALT), tripKey('g-porto', SALT));
  assert.notEqual(tripKey('g-porto', SALT), tripKey('g-porto', 'other-salt'));
  assert.ok(!tripKey('g-porto', SALT).includes('porto'));
});

test('trip rows leave out small groups and exact dates', () => {
  const rows = buildTripRows([porto, pair], SALT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].destination_city, 'Porto');
  assert.equal(rows[0].nights, 3);
  assert.equal(rows[0].trip_month, '2026-10-01');
  assert.equal(rows[0].trip_key, tripKey('g-porto', SALT));
});

test('trip rows carry no ids, names or budgets', () => {
  const [row] = buildTripRows([{ ...porto, budget: 50000, name: 'Porto Weekend' }], SALT);
  assert.deepEqual(Object.keys(row).sort(), [
    'base_currency', 'country_code', 'destination_city', 'group_size', 'nights', 'status', 'trip_key', 'trip_month',
  ]);
});

test('daily spend: shared and extra only, personal left out', () => {
  const trips = new Map([[porto.id, porto]]);
  const rows = buildDailySpendRows([
    { group_id: 'g-porto', spent_on: '2026-10-16', category: 'food', type: 'shared', amount_base_minor: 9000 },
    { group_id: 'g-porto', spent_on: '2026-10-16', category: 'food', type: 'extra', amount_base_minor: 3000 },
    { group_id: 'g-porto', spent_on: '2026-10-16', category: 'food', type: 'personal', amount_base_minor: 99999 },
  ], trips, RATES, SALT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total_eur_minor, 12000);
  assert.equal(rows[0].per_person_eur_minor, 4000);
});

test('daily spend skips trips that are too small or not allowed', () => {
  const trips = new Map([[pair.id, pair]]);
  const rows = buildDailySpendRows([
    { group_id: 'g-pair', spent_on: '2026-04-03', category: 'food', type: 'shared', amount_base_minor: 5000 },
    { group_id: 'g-unknown', spent_on: '2026-04-03', category: 'food', type: 'shared', amount_base_minor: 5000 },
  ], trips, RATES, SALT);
  assert.deepEqual(rows, []);
});

test('daily spend converts to EUR', () => {
  const trips = new Map([[london.id, london]]);
  const [row] = buildDailySpendRows([
    { group_id: 'g-gbp', spent_on: '2026-09-13', category: 'food', type: 'shared', amount_base_minor: 8600 },
  ], trips, RATES, SALT);
  assert.equal(row.total_eur_minor, 10000);
});

test('average adds categories within a day, then averages over days', () => {
  const avg = averageDailySpend([
    { trip_key: 'a', destination_city: 'Porto', spent_on: '2026-10-16', per_person_eur_minor: 3000, is_sample: false },
    { trip_key: 'a', destination_city: 'Porto', spent_on: '2026-10-16', per_person_eur_minor: 1000, is_sample: false },
    { trip_key: 'a', destination_city: 'Porto', spent_on: '2026-10-17', per_person_eur_minor: 2000, is_sample: false },
    { trip_key: 's', destination_city: 'Prague', spent_on: '2026-05-01', per_person_eur_minor: 6000, is_sample: true },
  ]);
  assert.deepEqual(avg.Porto, { perPersonDayMinor: 3000, days: 2, sampleOnly: false });
  assert.equal(avg.Prague.sampleOnly, true);
});

test('monthly average splits by calendar month', () => {
  const rows = [
    { trip_key: 's', destination_city: 'Porto', spent_on: '2026-06-01', per_person_eur_minor: 9000, is_sample: true },
    { trip_key: 's', destination_city: 'Porto', spent_on: '2026-06-02', per_person_eur_minor: 7000, is_sample: true },
    { trip_key: 's', destination_city: 'Porto', spent_on: '2026-01-10', per_person_eur_minor: 5000, is_sample: true },
    { trip_key: 'a', destination_city: 'Porto', spent_on: '2026-06-01', per_person_eur_minor: 2000, is_sample: false },
  ];
  const byMonth = averageDailySpendByMonth(rows);
  assert.deepEqual(byMonth.Porto[6], { perPersonDayMinor: 6000, days: 3, sampleOnly: false });
  assert.deepEqual(byMonth.Porto[1], { perPersonDayMinor: 5000, days: 1, sampleOnly: true });
  assert.equal(byMonth.Porto[3], undefined);
});

test('monthly and yearly averages agree when there is one month', () => {
  const rows = [
    { trip_key: 'a', destination_city: 'Split', spent_on: '2026-07-01', per_person_eur_minor: 4000, is_sample: false },
    { trip_key: 'a', destination_city: 'Split', spent_on: '2026-07-02', per_person_eur_minor: 6000, is_sample: false },
  ];
  assert.deepEqual(averageDailySpendByMonth(rows).Split[7], averageDailySpend(rows).Split);
});
