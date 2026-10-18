const test = require('node:test');
const assert = require('node:assert/strict');
const { explanationInput, buildPrompt, templateReason, cleanReason } = require('../logic/explain');

const lisbon = {
  city: 'Lisbon', country_code: 'PT', tags: ['culture', 'beach', 'nightlife'],
  window_start: '2027-06-08', window_end: '2027-06-13',
  // Fields that must never reach a prompt:
  est_cost_pp_minor: 38500, currency: 'EUR', group_id: 'g1', yes_votes: 2,
};

test('input keeps only safe fields', () => {
  const input = explanationInput(lisbon, ['culture', 'nightlife', 'hiking']);
  assert.deepEqual(input, {
    city: 'Lisbon', country: 'PT', tags: ['culture', 'beach', 'nightlife'],
    matching: ['culture', 'nightlife'], nights: 5, month: 'June',
  });
});

test('prompt contains no money, ids or votes', () => {
  const prompt = buildPrompt(explanationInput(lisbon, ['culture']));
  assert.ok(!/38500|385|EUR|€|g1/.test(prompt));
  assert.match(prompt, /Lisbon/);
  assert.match(prompt, /5 nights in June/);
});

test('template names the shared styles', () => {
  assert.equal(
    templateReason(explanationInput(lisbon, ['culture', 'nightlife'])),
    "Matches your group's love of culture and nightlife · 5 nights in June.",
  );
});

test('template falls back to what the place is known for', () => {
  assert.equal(
    templateReason(explanationInput(lisbon, ['hiking'])),
    'Known for culture, beach and nightlife · 5 nights in June.',
  );
});

test('clean reason strips quotes and whitespace', () => {
  assert.equal(cleanReason('  "Sunny beaches and late nights suit you all."  '), 'Sunny beaches and late nights suit you all.');
});

test('clean reason rejects anything about money', () => {
  assert.equal(cleanReason('Great value and cheap eats!'), null);
  assert.equal(cleanReason('Fits your budget perfectly.'), null);
  assert.equal(cleanReason('Only €40 a night.'), null);
  assert.equal(cleanReason(''), null);
});

test('clean reason shortens long replies', () => {
  const long = `${'Lovely old streets and great food for everyone. '.repeat(6)}`;
  const out = cleanReason(long);
  assert.ok(out.length <= 181);
  assert.ok(out.endsWith('.') || out.endsWith('…'));
});
