const express = require('express');
const db = require('./db');
const auth = require('./auth');
const router = express.Router();

router.use(auth);

// Friends plus pending requests in both directions. Public profile fields only.
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.name, u.home_currency, f.status,
            (f.requester_id = $1) AS sent_by_me
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE $1 IN (f.requester_id, f.addressee_id)
     ORDER BY u.name`, [req.user.userId]);
  const strip = ({ status, sent_by_me, ...user }) => user;
  res.json({
    friends: rows.filter((r) => r.status === 'accepted').map(strip),
    incoming: rows.filter((r) => r.status === 'pending' && !r.sent_by_me).map(strip),
    outgoing: rows.filter((r) => r.status === 'pending' && r.sent_by_me).map(strip),
  });
});

// Send a friend request by username. If they already asked you, this accepts it.
router.post('/requests', async (req, res) => {
  const me = req.user.userId;
  const username = String(req.body.username || '').trim().replace(/^@/, '').toLowerCase();
  const { rows: found } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
  if (!found.length) return res.status(404).json({ error: `No one is called @${username}.` });
  const them = found[0].id;
  if (them === me) return res.status(400).json({ error: "That's you!" });

  const { rows: existing } = await db.query(
    `SELECT requester_id, status FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`, [me, them]);
  if (existing.length) {
    const { requester_id, status } = existing[0];
    if (status === 'accepted') return res.status(409).json({ error: "You're already friends." });
    if (requester_id === me) return res.status(409).json({ error: 'Request already sent.' });
    await db.query(
      `UPDATE friendships SET status = 'accepted', accepted_at = now()
       WHERE requester_id = $1 AND addressee_id = $2`, [them, me]);
    return res.json({ status: 'accepted' });
  }

  await db.query('INSERT INTO friendships (requester_id, addressee_id) VALUES ($1, $2)', [me, them]);
  res.status(201).json({ status: 'pending' });
});

// Accept a request someone sent you
router.post('/requests/:userId/accept', async (req, res) => {
  const { rowCount } = await db.query(
    `UPDATE friendships SET status = 'accepted', accepted_at = now()
     WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`,
    [req.params.userId, req.user.userId]);
  if (!rowCount) return res.status(404).json({ error: 'No pending request from that person.' });
  res.json({ status: 'accepted' });
});

// Decline a request, cancel one you sent, or remove a friend
router.delete('/:userId', async (req, res) => {
  const { rowCount } = await db.query(
    `DELETE FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [req.user.userId, req.params.userId]);
  if (!rowCount) return res.status(404).json({ error: 'Not found.' });
  res.status(204).end();
});

module.exports = router;
