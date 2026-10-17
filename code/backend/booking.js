// Voting on the shortlist, booking the winner and starting the trip.
// Mounted under /api/trips/:groupId (see trips.js).
//
// PRIVACY: votes are anonymous. The API only ever returns totals per option
// plus the caller's own vote, never who voted for what.

const express = require('express');
const db = require('./db');
const router = express.Router({ mergeParams: true });

async function loadMembership(req, res) {
  const { rows } = await db.query(
    `SELECT g.id, g.status, gm.role FROM groups g
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
     WHERE g.id = $1`, [req.params.groupId, req.user.userId]);
  if (!rows.length) {
    res.status(404).json({ error: 'not a member' });
    return null;
  }
  return rows[0];
}

// Yes / no / take back your vote on one shortlist option
router.put('/options/:optionId/vote', async (req, res) => {
  const trip = await loadMembership(req, res);
  if (!trip) return;
  if (trip.status !== 'voting') return res.status(409).json({ error: "This trip isn't open for voting." });
  const { approve } = req.body;
  if (approve !== true && approve !== false && approve !== null) {
    return res.status(400).json({ error: 'approve must be true, false or null' });
  }

  const { rows: option } = await db.query(
    'SELECT id FROM destination_options WHERE id = $1 AND group_id = $2', [req.params.optionId, trip.id]);
  if (!option.length) return res.status(404).json({ error: 'That option is no longer on the shortlist.' });

  if (approve === null) {
    await db.query('DELETE FROM votes WHERE option_id = $1 AND user_id = $2', [req.params.optionId, req.user.userId]);
  } else {
    await db.query(
      `INSERT INTO votes (option_id, user_id, approve) VALUES ($1, $2, $3)
       ON CONFLICT (option_id, user_id) DO UPDATE SET approve = EXCLUDED.approve, voted_at = now()`,
      [req.params.optionId, req.user.userId, approve]);
  }
  res.json({ ok: true });
});

// Organiser books an option most of the group said yes to
router.post('/options/:optionId/book', async (req, res) => {
  const trip = await loadMembership(req, res);
  if (!trip) return;
  if (trip.role !== 'organiser') return res.status(403).json({ error: 'Only the organiser can book.' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the group so a recompute or a second click can't change things underneath us.
    const { rows: [group] } = await client.query('SELECT status FROM groups WHERE id = $1 FOR UPDATE', [trip.id]);
    if (group.status !== 'voting') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: "This trip isn't open for voting." });
    }
    const { rows: [option] } = await client.query(
      `SELECT o.destination_id, o.window_start, o.window_end,
              (SELECT count(*)::int FROM votes v WHERE v.option_id = o.id AND v.approve) AS approvals,
              (SELECT count(*)::int FROM group_members gm WHERE gm.group_id = o.group_id) AS members
       FROM destination_options o WHERE o.id = $1 AND o.group_id = $2`, [req.params.optionId, trip.id]);
    if (!option) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That option is no longer on the shortlist.' });
    }
    if (option.approvals * 2 <= option.members) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'More than half the group needs to vote yes first.' });
    }
    await client.query(
      `UPDATE groups SET status = 'booked', destination_id = $2, trip_start = $3, trip_end = $4
       WHERE id = $1`, [trip.id, option.destination_id, option.window_start, option.window_end]);
    await client.query('COMMIT');
    res.json({ status: 'booked' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// Organiser starts a booked trip: day 1 of the demo clock, pacing begins
router.post('/start', async (req, res) => {
  const trip = await loadMembership(req, res);
  if (!trip) return;
  if (trip.role !== 'organiser') return res.status(403).json({ error: 'Only the organiser can start the trip.' });
  const { rowCount } = await db.query(
    `UPDATE groups SET status = 'on_trip', current_day = 1 WHERE id = $1 AND status = 'booked'`, [trip.id]);
  if (!rowCount) return res.status(409).json({ error: 'Only a booked trip can be started.' });
  res.json({ status: 'on_trip' });
});

module.exports = router;
