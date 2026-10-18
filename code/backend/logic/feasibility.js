// Which destinations fit everyone. Pure function: the caller loads rows from
// the database and passes them in.
//
// An option fits only if, for EVERY member:
//   1. their flight estimate is within their flight budget (compared in their currency)
//   2. the daily food estimate is within their private daily budget
//   3. the shared cost per person (accommodation + activities, per night x nights)
//      is within the hidden group ceiling (compared in the group's base currency)
//
// PRIVACY: `options` is safe to send to clients. `diagnostics` is SERVER-ONLY
// (it names who blocks what) and must only be used to write each member's own
// private prompt.

const { convertMinor } = require('./fx');
const { overlapWindows, groupNightsRange, addDays } = require('./dates');
const { computeCeiling } = require('./ceiling');

// Pick a trip length that keeps the shared cost at or below this share of the
// ceiling, so shown prices don't sit right at someone's limit.
const DEFAULT_HEADROOM = 0.9;

/**
 * @param {object} input
 * @param {string} input.baseCurrency  group base currency, e.g. 'EUR'
 * @param {object} input.rates         { CCY: units per 1 base }
 * @param {Array}  input.members       see tests/fixtures/seed.js for the shape
 * @param {Array}  input.destinations  rows from `destinations`
 * @param {Array}  input.flights       rows from `flight_estimates`
 */
function findOptions(input) {
  const {
    baseCurrency,
    rates,
    members,
    destinations,
    flights,
    maxOptions = 5,
    headroom = DEFAULT_HEADROOM,
  } = input;

  const diagnostics = {
    reason: null,
    blockedFlight: {}, // userId -> [city]
    blockedFood: {}, // userId -> [city]
    tooExpensiveShared: [], // [city]
    pendingConsent: [],
    limitingUserIds: [],
  };
  for (const m of members) {
    diagnostics.blockedFlight[m.userId] = [];
    diagnostics.blockedFood[m.userId] = [];
  }
  const noMatch = (reason) => ({ status: 'no_match', options: [], diagnostics: { ...diagnostics, reason } });

  const nights = groupNightsRange(members);
  if (!nights) return noMatch('trip_length');

  const windows = overlapWindows(
    members.map((m) => m.availability),
    { minNights: nights.min, maxWindows: 3 },
  );
  if (!windows.length) return noMatch('dates');

  const ceilingResult = computeCeiling(
    members.map((m) => ({
      userId: m.userId,
      groupBudgetBase: convertMinor(m.groupBudgetMinor, m.currency, baseCurrency, rates),
      acceptsStretch: m.acceptsStretch ?? null,
    })),
  );
  const { ceiling } = ceilingResult;
  diagnostics.pendingConsent = ceilingResult.pendingConsent;
  diagnostics.limitingUserIds = ceilingResult.limitingUserIds;

  const styles = new Set(members.flatMap((m) => m.tripStyles || []));
  const options = [];

  for (const d of destinations) {
    let fitsEveryone = true;
    let margin = 1; // smallest slack ratio across all members and checks

    for (const m of members) {
      const flight = flights.find((f) => f.origin === m.departureAirport && f.destinationId === d.id);
      const flightCost = flight ? convertMinor(flight.priceMinor, flight.currency, m.currency, rates) : null;
      if (flightCost === null || flightCost > m.flightBudgetMinor) {
        diagnostics.blockedFlight[m.userId].push(d.city);
        fitsEveryone = false;
      } else if (m.flightBudgetMinor > 0) {
        margin = Math.min(margin, (m.flightBudgetMinor - flightCost) / m.flightBudgetMinor);
      }

      const foodCost = convertMinor(d.foodPpDayMinor, d.baseCurrency, m.currency, rates);
      if (foodCost > m.dailyBudgetMinor) {
        diagnostics.blockedFood[m.userId].push(d.city);
        fitsEveryone = false;
      } else if (m.dailyBudgetMinor > 0) {
        margin = Math.min(margin, (m.dailyBudgetMinor - foodCost) / m.dailyBudgetMinor);
      }
    }
    if (!fitsEveryone) continue;

    const perNight = convertMinor(
      d.accommodationPpNightMinor + d.activitiesPpDayMinor,
      d.baseCurrency,
      baseCurrency,
      rates,
    );

    // Longest stay that stays under the headroom; otherwise the minimum stay if
    // that still fits under the ceiling itself.
    let best = null;
    for (const w of windows) {
      const maxNights = Math.min(nights.max, w.nights);
      let n = Math.min(maxNights, Math.floor((ceiling * headroom) / perNight));
      if (n < nights.min && perNight * nights.min <= ceiling) n = nights.min;
      if (n >= nights.min && (!best || n > best.nights)) best = { window: w, nights: n };
    }
    if (!best) {
      diagnostics.tooExpensiveShared.push(d.city);
      continue;
    }

    const cost = perNight * best.nights;
    margin = Math.min(margin, (ceiling - cost) / ceiling);

    options.push({
      destinationId: d.id,
      city: d.city,
      tags: d.tags,
      windowStart: best.window.start,
      windowEnd: addDays(best.window.start, best.nights),
      nights: best.nights,
      estCostPpMinor: cost,
      currency: baseCurrency,
      matchingStyles: d.tags.filter((t) => styles.has(t)),
      _margin: margin,
    });
  }

  if (!options.length) return noMatch('budget');

  // Most comfortable for everyone first, then best match with the group's styles.
  options.sort(
    (a, b) => b._margin - a._margin || b.matchingStyles.length - a.matchingStyles.length,
  );

  return {
    status: 'options',
    options: options.slice(0, maxOptions).map(({ _margin, ...safe }) => safe),
    diagnostics,
  };
}

module.exports = { findOptions };
