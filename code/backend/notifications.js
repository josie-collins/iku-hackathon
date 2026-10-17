const express = require('express');
const db = require('./db');
const auth = require('./auth');
const router = express.Router();

router.use(auth);

// The caller's latest notifications, newest first, with how many are unread.
router.get('/', async (req, res) => {
  const me = req.user.userId;
  const { rows } = await db.query(
    `SELECT n.id, n.share_base_minor, n.read_at, n.created_at,
            a.action, a.group_id, a.description, a.category, a.type, a.amount_minor, a.currency,
            g.name AS trip_name, g.base_currency, u.name AS actor_name, u.username AS actor_username
     FROM notifications n
     JOIN trip_activity a ON a.id = n.activity_id
     JOIN groups g ON g.id = a.group_id
     JOIN users u ON u.id = a.actor_id
     WHERE n.user_id = $1
     ORDER BY n.created_at DESC
     LIMIT 50`, [me]);
  const { rows: [{ unread }] } = await db.query(
    'SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL', [me]);
  res.json({
    unread,
    notifications: rows.map((n) => ({
      ...n,
      amount_minor: Number(n.amount_minor),
      share_base_minor: n.share_base_minor == null ? null : Number(n.share_base_minor),
    })),
  });
});

// Mark everything as read
router.post('/read', async (req, res) => {
  await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.userId]);
  res.json({ ok: true });
});

module.exports = router;
