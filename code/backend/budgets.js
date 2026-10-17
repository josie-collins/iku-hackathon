const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { recomputeQuietly } = require('./shortlist');
const router = express.Router();

const FIELDS = ['flight_minor', 'group_minor', 'private_daily_minor'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Create or update the caller's own budget (and optionally their free dates)
// for one of their groups, then recompute the group's shortlist.
// Amounts are minor units in the caller's home currency.
router.put('/:groupId', auth, async (req, res) => {
  const { userId } = req.user;
  const { groupId } = req.params;
  for (const field of FIELDS) {
    const value = req.body[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      return res.status(400).json({ error: `${field} must be a whole number of at least 0` });
    }
  }
  const { free_from: freeFrom, free_to: freeTo } = req.body;
  const hasDates = freeFrom != null || freeTo != null;
  if (hasDates && !(DATE.test(freeFrom) && DATE.test(freeTo) && freeFrom <= freeTo)) {
    return res.status(400).json({ error: 'Free dates need a start and an end, with the end on or after the start.' });
  }

  // Must be a member of that group; the budget is always in their home currency.
  const { rows: member } = await db.query(
    `SELECT u.home_currency FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1 AND gm.user_id = $2`, [groupId, userId]);
  if (!member.length) return res.status(404).json({ error: 'not a member' });

  const client = await db.pool.connect();
  let budget;
  try {
    await client.query('BEGIN');
    ({ rows: [budget] } = await client.query(
      `INSERT INTO budgets (group_id, user_id, flight_minor, group_minor, private_daily_minor, currency)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         flight_minor = EXCLUDED.flight_minor,
         group_minor = EXCLUDED.group_minor,
         private_daily_minor = EXCLUDED.private_daily_minor,
         updated_at = now()
       RETURNING flight_minor, group_minor, private_daily_minor, currency`,
      [groupId, userId, req.body.flight_minor, req.body.group_minor, req.body.private_daily_minor, member[0].home_currency]));
    if (hasDates) {
      // The form edits one date range, so it replaces whatever was there.
      await client.query('DELETE FROM availability WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
      await client.query(
        'INSERT INTO availability (group_id, user_id, start_date, end_date) VALUES ($1, $2, $3, $4)',
        [groupId, userId, freeFrom, freeTo]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await recomputeQuietly(groupId);
  res.json(budget);
});

module.exports = router;
