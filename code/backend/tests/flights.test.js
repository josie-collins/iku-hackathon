const test = require('node:test');
const assert = require('node:assert/strict');
const { routeKey, routesToSearch, stillFits } = require('../logic/flights');

const RATES = { EUR: 1, GBP: 0.86, NGN: 1700 };
const lisbon = { destinationId: 'd-lis', airport: 'LIS', windowStart: '2027-06-08', windowEnd: '2027-06-13' };
const tom = { departureAirport: 'LHR', currency: 'GBP', flightBudgetMinor: 25000 };
const priya = { departureAirport: 'LHR', currency: 'GBP', flightBudgetMinor: 15000 };
const amara = { departureAirport: 'LOS', currency: 'NGN', flightBudgetMinor: 45000000 };
const lucia = { departureAirport: 'MAD', currency: 'EUR', flightBudgetMinor: 20000 };

test('one search per airport, destination and dates', () => {
  const routes = routesToSearch([lisbon], [tom, priya, amara, lucia]);
  assert.deepEqual(routes.map((r) => r.origin).sort(), ['LHR', 'LOS', 'MAD']); // Tom and Priya share LHR
  assert.equal(routes[0].outbound, '2027-06-08');
  assert.equal(routes[0].return, '2027-06-13');
});

test('no search for places without an airport, or for people who live there', () => {
  assert.deepEqual(routesToSearch([{ ...lisbon, airport: null }], [tom]), []);
  assert.deepEqual(routesToSearch([lisbon], [{ ...tom, departureAirport: 'LIS' }]), []);
});

test('the same dates for two destinations are two searches', () => {
  const routes = routesToSearch([lisbon, { ...lisbon, destinationId: 'd-opo', airport: 'OPO' }], [tom]);
  assert.equal(routes.length, 2);
});

const quote = (origin, priceMinor, currency) => [
  routeKey({ origin, destinationId: 'd-lis', outbound: '2027-06-08', return: '2027-06-13' }),
  { priceMinor, currency },
];

test('fits when every live price is within that person\'s flight budget', () => {
  const quotes = new Map([quote('LHR', 17100, 'GBP'), quote('MAD', 9000, 'EUR')]);
  assert.equal(stillFits(lisbon, [tom, lucia], quotes, RATES), true);
});

test('drops out when one person\'s live price is over their budget', () => {
  const quotes = new Map([quote('LHR', 17100, 'GBP')]);
  assert.equal(stillFits(lisbon, [tom, priya], quotes, RATES), false); // £171 > Priya's £150
});

test('converts the quote into each person\'s own currency', () => {
  // £171 quoted in GBP, checked against Amara's naira budget: about ₦338,000, under ₦450,000
  const quotes = new Map([quote('LOS', 17100, 'GBP')]);
  assert.equal(stillFits(lisbon, [amara], quotes, RATES), true);
  assert.equal(stillFits(lisbon, [{ ...amara, flightBudgetMinor: 30000000 }], quotes, RATES), false);
});

test('a missing quote does not drop the option', () => {
  assert.equal(stillFits(lisbon, [priya], new Map(), RATES), true);
});
