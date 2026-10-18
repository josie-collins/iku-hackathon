const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { destinationSpend } = require('./insights');
const { getRates } = require('./integrations/wise');
const { convertMinor } = require('./logic/fx');
const { explanationInput, templateReason } = require('./logic/explain');
const router = express.Router();

// A month's figure needs at least this many trip-days behind it, or we use the yearly one.
const MIN_MONTH_DAYS = 5;

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
            d.city, d.country_code, d.image_url, d.image_credit_url,
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
    `SELECT m.group_id, m.user_id, m.name, u.username, m.role, m.trip_styles
     FROM v_member_public m JOIN users u ON u.id = m.user_id
     WHERE m.group_id = ANY($1::uuid[])
     ORDER BY m.name`, [groupIds]);
  // Votes are anonymous: totals per option, plus only the caller's own vote.
  const { rows: options } = await db.query(
    `SELECT o.id, o.group_id, o.destination_id, d.city, d.country_code, d.tags, d.image_url, d.image_credit_url,
            to_char(o.window_start, 'YYYY-MM-DD') AS window_start,
            to_char(o.window_end, 'YYYY-MM-DD') AS window_end,
            o.est_cost_pp_minor, o.currency, o.summary,
            count(v.option_id) FILTER (WHERE v.approve)::int     AS yes_votes,
            count(v.option_id) FILTER (WHERE NOT v.approve)::int AS no_votes,
            bool_or(v.approve) FILTER (WHERE v.user_id = $2)     AS my_vote
     FROM destination_options o
     JOIN destinations d ON d.id = o.destination_id
     LEFT JOIN votes v ON v.option_id = o.id
     WHERE o.group_id = ANY($1::uuid[])
     GROUP BY o.id, d.id
     ORDER BY o.generated_at, o.id`, [groupIds, userId]);

  // "Past groups spent about X per person per day here", in each option's currency.
  // Nice to have: if it fails, the page still loads without it.
  let pastSpend = () => null;
  if (options.length) {
    try {
      const [{ byCity, byCityMonth, source }, fx] = await Promise.all([
        destinationSpend(),
        getRates('EUR', options.map((o) => o.currency)),
      ]);
      // The month the option starts in, when there's enough data for that month; otherwise the yearly figure.
      pastSpend = (o) => {
        const month = Number(o.window_start.slice(5, 7));
        const inMonth = byCityMonth?.[o.city]?.[month];
        const figure = inMonth && inMonth.days >= MIN_MONTH_DAYS ? inMonth : byCity[o.city];
        if (!figure) return null;
        return {
          per_person_day_minor: convertMinor(figure.perPersonDayMinor, 'EUR', o.currency, fx.rates),
          currency: o.currency,
          month: figure === inMonth ? month : null, // null = yearly average
          days: figure.days,
          sample_only: figure.sampleOnly,
          source,
        };
      };
    } catch (err) {
      console.error('past spend unavailable:', err.message);
    }
  }

  // The caller's OWN flight for each option: a live quote for those dates if we have
  // one, otherwise the sample estimate. Other members' flights are never sent.
  const me = users[0];
  const destIds = [...new Set(options.map((o) => o.destination_id))];
  const { rows: myQuotes } = me.departure_airport && destIds.length ? await db.query(
    `SELECT destination_id, to_char(outbound_date, 'YYYY-MM-DD') AS outbound, to_char(return_date, 'YYYY-MM-DD') AS ret,
            price_minor, currency, airline, stops, google_flights_url, fetched_at
     FROM flight_quotes WHERE origin = $1 AND destination_id = ANY($2::uuid[])
     ORDER BY fetched_at DESC`, [me.departure_airport, destIds]) : { rows: [] };
  const { rows: mySamples } = me.departure_airport && destIds.length ? await db.query(
    `SELECT destination_id, price_minor, currency, google_flights_url
     FROM flight_estimates WHERE origin = $1 AND destination_id = ANY($2::uuid[])`, [me.departure_airport, destIds]) : { rows: [] };
  let flightFx = null;
  if (myQuotes.length || mySamples.length) {
    flightFx = await getRates('EUR', [me.home_currency, ...myQuotes.map((q) => q.currency), ...mySamples.map((q) => q.currency)])
      .catch(() => null);
  }
  const yourFlight = (o) => {
    const live = myQuotes.find((q) => q.destination_id === o.destination_id && q.outbound === o.window_start && q.ret === o.window_end);
    const pick = live || mySamples.find((q) => q.destination_id === o.destination_id);
    if (!pick || !flightFx) return null;
    return {
      from: me.departure_airport,
      price_minor: convertMinor(Number(pick.price_minor), pick.currency, me.home_currency, flightFx.rates),
      currency: me.home_currency,
      airline: live ? live.airline : null,
      stops: live ? live.stops : null,
      google_flights_url: pick.google_flights_url,
      source: live ? 'live' : 'sample',
      fetched_at: live ? live.fetched_at : null,
    };
  };

  // Each trip's combined trip styles (for the reasons), without saying who likes what.
  const groupStyles = (groupId) => [...new Set(members.filter((m) => m.group_id === groupId).flatMap((m) => m.trip_styles || []))];

  res.json({
    user: users[0],
    trips: trips.map(({ flight_minor, group_minor, private_daily_minor, budget_currency, ...trip }) => ({
      ...trip,
      members: members.filter((m) => m.group_id === trip.group_id).map(({ group_id, trip_styles, ...m }) => m),
      options: options.filter((o) => o.group_id === trip.group_id).map(({ group_id, summary, ...o }) => ({
        ...o,
        past_spend: pastSpend(o),
        your_flight: yourFlight(o),
        // Cortex's sentence if it wrote one, otherwise a plain template reason.
        reason: summary
          ? { text: summary, source: 'cortex' }
          : { text: templateReason(explanationInput(o, groupStyles(trip.group_id))), source: 'template' },
      })),
      budget: flight_minor == null ? null : { flight_minor, group_minor, private_daily_minor, currency: budget_currency },
    })),
  });
});

module.exports = router;
