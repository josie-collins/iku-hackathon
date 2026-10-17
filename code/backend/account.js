const express = require('express');
const db = require('./db');
const auth = require('./auth');
const router = express.Router();

// The logged-in user's profile and every group they're in, with their OWN budget
// for each. Never returns anyone else's budget: the budgets join is on the caller.
router.get('/', auth, async (req, res) => {
  const { userId } = req.user;
  const { rows: users } = await db.query(
    `SELECT id, name, home_currency, nationality, departure_airport
     FROM users WHERE id = $1`, [userId]);
  if (!users.length) return res.status(404).json({ error: 'user not found' });

  const { rows: trips } = await db.query(
    `SELECT g.id AS group_id, g.name, g.status, g.invite_code, g.base_currency,
            to_char(g.trip_start, 'YYYY-MM-DD') AS trip_start, -- text, so timezones can't shift the day
            to_char(g.trip_end, 'YYYY-MM-DD') AS trip_end, gm.role,
            d.city, d.country_code,
            (SELECT count(*)::int FROM group_members x WHERE x.group_id = g.id) AS member_count,
            b.flight_minor, b.group_minor, b.private_daily_minor, b.currency AS budget_currency
     FROM group_members gm
     JOIN groups g ON g.id = gm.group_id
     LEFT JOIN destinations d ON d.id = g.destination_id
     LEFT JOIN budgets b ON b.group_id = gm.group_id AND b.user_id = gm.user_id
     WHERE gm.user_id = $1
     ORDER BY g.trip_start NULLS LAST, g.created_at`, [userId]);

  res.json({
    user: users[0],
    trips: trips.map(({ flight_minor, group_minor, private_daily_minor, budget_currency, ...trip }) => ({
      ...trip,
      budget: flight_minor == null ? null : { flight_minor, group_minor, private_daily_minor, currency: budget_currency },
    })),
  });
});

module.exports = router;
