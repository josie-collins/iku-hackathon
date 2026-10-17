const express = require('express');
const db = require('./db');
const auth = require('./auth');
const router = express.Router();

// The logged-in user's profile and every group they're in, with their OWN budget
// and dates for each. Never returns anyone else's budget: those joins are on the caller.
router.get('/', auth, async (req, res) => {
  const { userId } = req.user;
  const { rows: users } = await db.query(
    `SELECT id, username, name, home_currency, nationality, departure_airport
     FROM users WHERE id = $1`, [userId]);
  if (!users.length) return res.status(404).json({ error: 'user not found' });

  const { rows: trips } = await db.query(
    `SELECT g.id AS group_id, g.name, g.status, g.invite_code, g.base_currency,
            to_char(g.trip_start, 'YYYY-MM-DD') AS trip_start, -- text, so timezones can't shift the day
            to_char(g.trip_end, 'YYYY-MM-DD') AS trip_end, gm.role,
            d.city, d.country_code,
            b.flight_minor, b.group_minor, b.private_daily_minor, b.currency AS budget_currency,
            (SELECT to_char(min(a.start_date), 'YYYY-MM-DD') FROM availability a
             WHERE a.group_id = g.id AND a.user_id = $1) AS free_from,
            (SELECT to_char(max(a.end_date), 'YYYY-MM-DD') FROM availability a
             WHERE a.group_id = g.id AND a.user_id = $1) AS free_to,
            -- How many members have entered both a budget and dates (a count, never who).
            (SELECT count(*)::int FROM group_members x
             WHERE x.group_id = g.id
               AND EXISTS (SELECT 1 FROM budgets bx WHERE bx.group_id = x.group_id AND bx.user_id = x.user_id)
               AND EXISTS (SELECT 1 FROM availability ax WHERE ax.group_id = x.group_id AND ax.user_id = x.user_id)
            ) AS ready_count
     FROM group_members gm
     JOIN groups g ON g.id = gm.group_id
     LEFT JOIN destinations d ON d.id = g.destination_id
     LEFT JOIN budgets b ON b.group_id = gm.group_id AND b.user_id = gm.user_id
     WHERE gm.user_id = $1
     ORDER BY g.trip_start NULLS LAST, g.created_at`, [userId]);

  const groupIds = trips.map((t) => t.group_id);
  const { rows: members } = await db.query(
    `SELECT m.group_id, m.user_id, m.name, u.username, m.role
     FROM v_member_public m JOIN users u ON u.id = m.user_id
     WHERE m.group_id = ANY($1::uuid[])
     ORDER BY m.name`, [groupIds]);
  const { rows: options } = await db.query(
    `SELECT o.id, o.group_id, d.city, d.country_code, d.tags,
            to_char(o.window_start, 'YYYY-MM-DD') AS window_start,
            to_char(o.window_end, 'YYYY-MM-DD') AS window_end,
            o.est_cost_pp_minor, o.currency
     FROM destination_options o JOIN destinations d ON d.id = o.destination_id
     WHERE o.group_id = ANY($1::uuid[])
     ORDER BY o.generated_at, o.id`, [groupIds]);

  res.json({
    user: users[0],
    trips: trips.map(({ flight_minor, group_minor, private_daily_minor, budget_currency, ...trip }) => ({
      ...trip,
      members: members.filter((m) => m.group_id === trip.group_id).map(({ group_id, ...m }) => m),
      options: options.filter((o) => o.group_id === trip.group_id).map(({ group_id, ...o }) => o),
      budget: flight_minor == null ? null : { flight_minor, group_minor, private_daily_minor, currency: budget_currency },
    })),
  });
});

module.exports = router;
