const test = require('node:test');
const assert = require('node:assert/strict');
const { overlapWindows, groupNightsRange, addDays, nightsBetween } = require('../logic/dates');
const { members } = require('./fixtures/seed');

test('seed overlap is 8–20 June 2027 (12 nights)', () => {
  const windows = overlapWindows(members().map((m) => m.availability), { minNights: 4 });
  assert.deepEqual(windows, [{ start: '2027-06-08', end: '2027-06-20', nights: 12 }]);
});

test('no overlap gives no windows', () => {
  const windows = overlapWindows([
    [{ start: '2027-06-01', end: '2027-06-05' }],
    [{ start: '2027-06-10', end: '2027-06-15' }],
  ]);
  assert.deepEqual(windows, []);
});

test('windows shorter than the minimum stay are dropped', () => {
  const windows = overlapWindows(
    [
      [{ start: '2027-06-01', end: '2027-06-03' }, { start: '2027-06-10', end: '2027-06-20' }],
      [{ start: '2027-06-01', end: '2027-06-30' }],
    ],
    { minNights: 4 },
  );
  assert.deepEqual(windows, [{ start: '2027-06-10', end: '2027-06-20', nights: 10 }]);
});

test('several ranges per person, capped at three windows, earliest first', () => {
  const a = [
    { start: '2027-01-01', end: '2027-01-10' },
    { start: '2027-02-01', end: '2027-02-10' },
    { start: '2027-03-01', end: '2027-03-10' },
    { start: '2027-04-01', end: '2027-04-10' },
  ];
  const b = [{ start: '2027-01-01', end: '2027-12-31' }];
  const windows = overlapWindows([a, b], { minNights: 3 });
  assert.equal(windows.length, 3);
  assert.equal(windows[0].start, '2027-01-01');
});

test('overlapping ranges for one person are merged', () => {
  const windows = overlapWindows([
    [{ start: '2027-06-01', end: '2027-06-05' }, { start: '2027-06-04', end: '2027-06-12' }],
    [{ start: '2027-06-01', end: '2027-06-30' }],
  ]);
  assert.deepEqual(windows, [{ start: '2027-06-01', end: '2027-06-12', nights: 11 }]);
});

test('trip length everyone accepts', () => {
  assert.deepEqual(groupNightsRange(members()), { min: 4, max: 7 });
  assert.equal(groupNightsRange([{ minNights: 5, maxNights: 7 }, { minNights: 2, maxNights: 4 }]), null);
});

test('date helpers', () => {
  assert.equal(addDays('2027-06-28', 5), '2027-07-03');
  assert.equal(nightsBetween('2027-06-08', '2027-06-20'), 12);
});
