// "Why this fits your group" for a shortlist option. Pure functions.
//
// PRIVACY: the only inputs are the destination, its tags, the group's combined
// trip styles, the number of nights and the month. No money of any kind (not
// even the estimated cost), no names, no budgets.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const MAX_LENGTH = 180;

/**
 * Only the fields an explanation may use. Everything else (costs, ids, people) is dropped here,
 * so nothing private can reach the prompt by accident.
 * @param {{city, country_code, tags, window_start, window_end}} option
 * @param {string[]} groupStyles  the union of every member's trip styles
 */
function explanationInput(option, groupStyles) {
  const tags = option.tags || [];
  const styles = [...new Set(groupStyles || [])];
  return {
    city: option.city,
    country: option.country_code,
    tags,
    matching: tags.filter((t) => styles.includes(t)),
    nights: Math.round((new Date(option.window_end) - new Date(option.window_start)) / 86400000),
    month: MONTHS[Number(option.window_start.slice(5, 7)) - 1],
  };
}

const list = (words) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);

/** Prompt for an LLM (Snowflake Cortex). */
function buildPrompt(input) {
  return [
    'Write one short, friendly sentence (under 25 words) telling a group of friends why this trip suits them.',
    'Do not mention prices, money or budgets. No emojis, no quotes, no lists.',
    `Destination: ${input.city} (${input.country}).`,
    `What the place is known for: ${input.tags.join(', ') || 'not given'}.`,
    `What the group enjoys and this place offers: ${input.matching.join(', ') || 'none in particular'}.`,
    `Trip: ${input.nights} nights in ${input.month}.`,
  ].join('\n');
}

/** Plain reason used when Cortex isn't available. */
function templateReason(input) {
  const stay = `${input.nights} ${input.nights === 1 ? 'night' : 'nights'} in ${input.month}`;
  if (input.matching.length) return `Matches your group's love of ${list(input.matching)} · ${stay}.`;
  if (input.tags.length) return `Known for ${list(input.tags)} · ${stay}.`;
  return `${stay[0].toUpperCase()}${stay.slice(1)}.`;
}

/** Tidy an LLM reply into one short sentence, or null if it's unusable. */
function cleanReason(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!s) return null;
  // Never show a reply that talks about money, even though the prompt contains none.
  if (/[€£$₦]|\b(budget|price|cost|cheap|expensive|afford)/i.test(s)) return null;
  if (s.length > MAX_LENGTH) {
    const cut = s.slice(0, MAX_LENGTH);
    const end = cut.lastIndexOf('.');
    s = end > 40 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  }
  return s;
}

module.exports = { explanationInput, buildPrompt, templateReason, cleanReason };
