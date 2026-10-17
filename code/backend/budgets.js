const express = require('express');
const db = require('./db');
const auth = require('./auth');
const router = express.Router();

const FIELDS = ['flight_minor', 'group_minor', 'private_daily_minor'];

router.get('/me', auth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT flight_minor, group_minor, private_daily_minor, currency
     FROM budgets WHERE group_id = $1 AND user_id = $2`,
    [req.user.groupId, req.user.userId]);
  res.json(rows[0] || null);
});

// Create or update the caller's own budget for one of their groups.
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

  // Must be a member of that group; the budget is always in their home currency.
  const { rows: member } = await db.query(
    `SELECT u.home_currency FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1 AND gm.user_id = $2`, [groupId, userId]);
  if (!member.length) return res.status(404).json({ error: 'not a member' });

  // TODO: rerun feasibility for the group once that endpoint exists.
  const { rows } = await db.query(
    `INSERT INTO budgets (group_id, user_id, flight_minor, group_minor, private_daily_minor, currency)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (group_id, user_id) DO UPDATE SET
       flight_minor = EXCLUDED.flight_minor,
       group_minor = EXCLUDED.group_minor,
       private_daily_minor = EXCLUDED.private_daily_minor,
       updated_at = now()
     RETURNING flight_minor, group_minor, private_daily_minor, currency`,
    [groupId, userId, req.body.flight_minor, req.body.group_minor, req.body.private_daily_minor, member[0].home_currency]);
  res.json(rows[0]);
});

module.exports = router;
