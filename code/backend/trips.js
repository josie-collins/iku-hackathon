const crypto = require('node:crypto');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { recomputeQuietly, OPEN_STATUSES } = require('./shortlist');
const router = express.Router();

router.use(auth);

// Every trip is a new group. The creator organises it and adds friends, who are
// members (and so count towards the shortlist) straight away.
router.post('/', async (req, res) => {
  const me = req.user.userId;
  const name = String(req.body.name || '').trim();
  const friendIds = [...new Set(Array.isArray(req.body.friendIds) ? req.body.friendIds : [])];
  if (!name) return res.status(400).json({ error: 'Give the trip a name.' });
  if (!friendIds.length) return res.status(400).json({ error: 'Add at least one friend.' });

  // Only accepted friends can be added.
  const { rows: friends } = await db.query(
    `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id
     FROM friendships
     WHERE status = 'accepted' AND $1 IN (requester_id, addressee_id)`, [me]);
  const friendSet = new Set(friends.map((f) => f.id));
  if (!friendIds.every((id) => friendSet.has(id))) {
    return res.status(400).json({ error: 'You can only add people who are your friends.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [user] } = await client.query('SELECT home_currency FROM users WHERE id = $1', [me]);
    const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const { rows: [group] } = await client.query(
      `INSERT INTO groups (name, invite_code, organiser_id, base_currency)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, inviteCode, me, user.home_currency]);
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role)
       SELECT $1, id, CASE WHEN id = $2 THEN 'organiser' ELSE 'member' END
       FROM unnest($3::uuid[]) AS id`,
      [group.id, me, [me, ...friendIds]]);
    await client.query('COMMIT');
    res.status(201).json({ id: group.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// Drop out of a trip. Deletes the member's private data (budgets and dates
// cascade from group_members) and recomputes the shortlist for everyone left.
router.delete('/:groupId/membership', async (req, res) => {
  const me = req.user.userId;
  const { groupId } = req.params;

  const client = await db.pool.connect();
  let groupDeleted = false;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT g.status, gm.role FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
       WHERE g.id = $1 FOR UPDATE OF g`, [groupId, me]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not a member' });
    }
    if (!OPEN_STATUSES.includes(rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: "This trip is already booked, so you can't drop out here." });
    }

    await client.query(
      `DELETE FROM votes WHERE user_id = $2
       AND option_id IN (SELECT id FROM destination_options WHERE group_id = $1)`, [groupId, me]);
    await client.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, me]);

    const { rows: left } = await client.query(
      'SELECT user_id FROM group_members WHERE group_id = $1 ORDER BY joined_at, user_id', [groupId]);
    if (!left.length) {
      await client.query('DELETE FROM groups WHERE id = $1', [groupId]);
      groupDeleted = true;
    } else if (rows[0].role === 'organiser') {
      // Hand organising to whoever joined first.
      const next = left[0].user_id;
      await client.query(
        `UPDATE group_members SET role = 'organiser' WHERE group_id = $1 AND user_id = $2`, [groupId, next]);
      await client.query('UPDATE groups SET organiser_id = $2 WHERE id = $1', [groupId, next]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (!groupDeleted) await recomputeQuietly(groupId);
  res.status(204).end();
});

// Voting, booking and starting: /api/trips/:groupId/options/..., /start
router.use('/:groupId', require('./booking'));
// Expenses, balances and settle-up: /api/trips/:groupId/...
router.use('/:groupId', require('./expenses'));

module.exports = router;
