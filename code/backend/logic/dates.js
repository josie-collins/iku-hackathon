// Date-overlap logic. Dates are 'YYYY-MM-DD' strings.
// An availability range means the person is free from `start` through `end`
// (inclusive), so a trip can leave on `start` and come back on `end`.
// Nights in a range = days between start and end.

const DAY_MS = 24 * 60 * 60 * 1000;

function toDay(date) {
  const day = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(day)) throw new Error(`Invalid date: ${date}`);
  return Math.round(day / DAY_MS);
}

function fromDay(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function addDays(date, days) {
  return fromDay(toDay(date) + days);
}

function nightsBetween(start, end) {
  return toDay(end) - toDay(start);
}

// Merge one person's ranges so overlapping or touching ranges become one.
function mergeRanges(ranges) {
  const sorted = ranges
    .map((r) => [toDay(r.start), toDay(r.end)])
    .filter(([s, e]) => e >= s)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

function intersect(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e >= s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/**
 * The trip length everyone accepts: at least the largest min_nights,
 * at most the smallest max_nights. Returns null if those don't overlap.
 */
function groupNightsRange(members) {
  const min = Math.max(...members.map((m) => m.minNights));
  const max = Math.min(...members.map((m) => m.maxNights));
  return min <= max ? { min, max } : null;
}

/**
 * Date windows when everyone is free, at least `minNights` long.
 * @param {Array<Array<{start: string, end: string}>>} rangesPerMember
 * @returns {Array<{start: string, end: string, nights: number}>} earliest first
 */
function overlapWindows(rangesPerMember, { minNights = 1, maxWindows = 3 } = {}) {
  if (!rangesPerMember.length) return [];
  let common = mergeRanges(rangesPerMember[0]);
  for (const ranges of rangesPerMember.slice(1)) {
    common = intersect(common, mergeRanges(ranges));
    if (!common.length) return [];
  }
  return common
    .map(([s, e]) => ({ start: fromDay(s), end: fromDay(e), nights: e - s }))
    .filter((w) => w.nights >= minNights)
    .slice(0, maxWindows);
}

module.exports = { overlapWindows, groupNightsRange, addDays, nightsBetween };
