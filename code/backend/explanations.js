// "Why this fits your group" text for shortlist options, written by Snowflake
// Cortex and saved in destination_options.summary. Runs in the background after
// a recompute; until (or unless) Cortex writes one, the account page shows a
// plain template reason instead (logic/explain.js).
//
// Cortex is not available on Snowflake trial accounts. When the account can't
// use it, we stop asking for an hour instead of failing on every save.

const db = require('./db');
const snowflake = require('./integrations/snowflake');
const { explanationInput, buildPrompt, cleanReason } = require('./logic/explain');

const MODEL = () => process.env.SNOWFLAKE_CORTEX_MODEL || 'mistral-large2';
const CALL_TIMEOUT_MS = 15000;
const BACKOFF_MS = 60 * 60 * 1000;
let unavailableUntil = 0;

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)),
]);

// Errors that mean "this account can't use Cortex", as opposed to one bad call.
const isAccountLevel = (err) => /not available for trial|not authorized|insufficient privileges|unknown function|does not exist/i
  .test(err.message);

async function complete(prompt) {
  const [row] = await snowflake.query('SELECT SNOWFLAKE.CORTEX.COMPLETE(?, ?) AS T', [MODEL(), prompt]);
  return row && row.T;
}

/**
 * Write reasons for a group's options that don't have one yet.
 * @returns {Promise<{ written: number, skipped?: string }>}
 */
async function explainGroup(groupId) {
  if (!snowflake.isConfigured()) return { written: 0, skipped: 'snowflake not configured' };
  if (Date.now() < unavailableUntil) return { written: 0, skipped: 'cortex unavailable' };

  const { rows: options } = await db.query(
    `SELECT o.id, d.city, d.country_code, d.tags,
            to_char(o.window_start, 'YYYY-MM-DD') AS window_start,
            to_char(o.window_end, 'YYYY-MM-DD') AS window_end
     FROM destination_options o JOIN destinations d ON d.id = o.destination_id
     WHERE o.group_id = $1 AND o.summary IS NULL`, [groupId]);
  if (!options.length) return { written: 0 };
  // The group's combined styles: a set of tags, never who likes what.
  const { rows: [{ styles }] } = await db.query(
    `SELECT COALESCE(array_agg(DISTINCT s), '{}') AS styles
     FROM group_members gm, unnest(gm.trip_styles) AS s WHERE gm.group_id = $1`, [groupId]);

  let written = 0;
  for (const option of options) {
    try {
      const reason = cleanReason(await withTimeout(complete(buildPrompt(explanationInput(option, styles))), CALL_TIMEOUT_MS));
      if (!reason) continue;
      const { rowCount } = await db.query(
        'UPDATE destination_options SET summary = $2 WHERE id = $1 AND summary IS NULL', [option.id, reason]);
      written += rowCount;
    } catch (err) {
      if (isAccountLevel(err)) {
        unavailableUntil = Date.now() + BACKOFF_MS;
        console.error(`Cortex unavailable, using template reasons for the next hour: ${err.message}`);
        break;
      }
      console.error(`Cortex reason failed for option ${option.id}: ${err.message}`);
    }
  }
  return { written };
}

// For request handlers: fire and forget, never blocks or fails the request.
function explainInBackground(groupId) {
  explainGroup(groupId).catch((err) => console.error(`explanations failed for group ${groupId}:`, err.message));
}

module.exports = { explainGroup, explainInBackground };
