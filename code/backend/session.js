
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('./db');
const router = express.Router();

// List the people in a group by invite code (names only, no budgets)
router.get('/group/:inviteCode/members', async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.user_id, m.name, m.home_currency
     FROM v_member_public m JOIN groups g ON g.id = m.group_id
     WHERE g.invite_code = $1`, [req.params.inviteCode]);
  res.json(rows);
});

// "Log in as" one member
router.post('/login', async (req, res) => {
  const { inviteCode, userId } = req.body;
  const { rows } = await db.query(
    `SELECT g.id AS group_id FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE g.invite_code = $1 AND gm.user_id = $2`, [inviteCode, userId]);
  if (!rows.length) return res.status(404).json({ error: 'not a member' });
  const token = jwt.sign({ userId, groupId: rows[0].group_id }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

module.exports = router;