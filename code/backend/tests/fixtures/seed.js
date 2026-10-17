// The demo data from db/seed.sql, in the shape the logic functions take.
// If you change seed.sql, update this file too so the tests keep matching the demo.

const GROUP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TOM = '11111111-1111-1111-1111-111111111111';
const AMARA = '22222222-2222-2222-2222-222222222222';
const LUCIA = '33333333-3333-3333-3333-333333333333';

// Fixed test rates per 1 EUR, so results don't change when live rates do.
const RATES = { EUR: 1, GBP: 0.86, NGN: 1700 };

function members() {
  return [
    {
      userId: TOM, name: 'Tom', currency: 'GBP', departureAirport: 'LHR',
      flightBudgetMinor: 25000, groupBudgetMinor: 50000, dailyBudgetMinor: 6000,
      acceptsStretch: null, minNights: 4, maxNights: 7, tripStyles: ['culture', 'nightlife'],
      availability: [{ start: '2027-06-01', end: '2027-06-20' }],
    },
    {
      userId: AMARA, name: 'Amara', currency: 'NGN', departureAirport: 'LOS',
      flightBudgetMinor: 45000000, groupBudgetMinor: 85000000, dailyBudgetMinor: 7000000,
      acceptsStretch: null, minNights: 4, maxNights: 7, tripStyles: ['beach', 'culture'],
      availability: [{ start: '2027-06-08', end: '2027-06-30' }],
    },
    {
      userId: LUCIA, name: 'Lucia', currency: 'EUR', departureAirport: 'MAD',
      flightBudgetMinor: 20000, groupBudgetMinor: 45000, dailyBudgetMinor: 5500,
      acceptsStretch: null, minNights: 4, maxNights: 7, tripStyles: ['beach', 'nightlife'],
      availability: [{ start: '2027-06-05', end: '2027-06-25' }],
    },
  ];
}

const destinations = [
  ['Lisbon', 'PT', ['culture', 'beach', 'nightlife'], 5500, 3800, 2200],
  ['Porto', 'PT', ['culture', 'food'], 4800, 3200, 1800],
  ['Barcelona', 'ES', ['beach', 'culture', 'nightlife'], 7000, 4200, 2800],
  ['Valencia', 'ES', ['beach', 'relaxing'], 5000, 3300, 2000],
  ['Prague', 'CZ', ['culture', 'nightlife'], 4500, 3000, 2200],
  ['Budapest', 'HU', ['culture', 'nightlife'], 4000, 2800, 2000],
  ['Athens', 'GR', ['culture', 'hiking'], 5200, 3200, 2400],
  ['Split', 'HR', ['beach', 'hiking'], 6000, 3500, 2500],
].map(([city, countryCode, tags, acc, food, act]) => ({
  id: `dest-${city.toLowerCase()}`, city, countryCode, tags, baseCurrency: 'EUR',
  accommodationPpNightMinor: acc, foodPpDayMinor: food, activitiesPpDayMinor: act,
}));

const flights = [
  ['LHR', 'Lisbon', 9000, 'GBP'], ['LHR', 'Porto', 8500, 'GBP'], ['LHR', 'Barcelona', 8000, 'GBP'], ['LHR', 'Valencia', 9500, 'GBP'],
  ['LHR', 'Prague', 8800, 'GBP'], ['LHR', 'Budapest', 9200, 'GBP'], ['LHR', 'Athens', 12000, 'GBP'], ['LHR', 'Split', 11000, 'GBP'],
  ['MAD', 'Lisbon', 7000, 'EUR'], ['MAD', 'Porto', 7500, 'EUR'], ['MAD', 'Barcelona', 6000, 'EUR'], ['MAD', 'Valencia', 5500, 'EUR'],
  ['MAD', 'Prague', 11000, 'EUR'], ['MAD', 'Budapest', 12000, 'EUR'], ['MAD', 'Athens', 13000, 'EUR'], ['MAD', 'Split', 14000, 'EUR'],
  ['LOS', 'Lisbon', 38000000, 'NGN'], ['LOS', 'Porto', 40000000, 'NGN'], ['LOS', 'Barcelona', 42000000, 'NGN'], ['LOS', 'Valencia', 45000000, 'NGN'],
  ['LOS', 'Prague', 48000000, 'NGN'], ['LOS', 'Budapest', 50000000, 'NGN'], ['LOS', 'Athens', 52000000, 'NGN'], ['LOS', 'Split', 55000000, 'NGN'],
].map(([origin, city, priceMinor, currency]) => ({
  origin, destinationId: `dest-${city.toLowerCase()}`, priceMinor, currency,
}));

function input(overrides = {}) {
  return { baseCurrency: 'EUR', rates: RATES, members: members(), destinations, flights, ...overrides };
}

module.exports = { GROUP_ID, TOM, AMARA, LUCIA, RATES, members, destinations, flights, input };
