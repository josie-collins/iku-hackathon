const express = require('express');
const db = require('./db');
const auth = require('./auth');
const router = express.Router();

router.get('/me', auth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT flight_minor, group_minor, private_daily_minor, currency
     FROM budgets WHERE group_id = $1 AND user_id = $2`,
    [req.user.groupId, req.user.userId]);
  res.json(rows[0] || null);
});

module.exports = router;