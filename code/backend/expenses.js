// Expenses, balances, private pacing and settle-up for one trip.
// Mounted under /api/trips/:groupId (see trips.js).
//
// PRIVACY: personal expenses are only returned to their payer, and pacing
// (which uses the private daily budget) only to the member it belongs to.

const express = require('express');
const db = require('./db');
const { getRates } = require('./integrations/wise');
const { convertMinor, rateBetween } = require('./logic/fx');
const { splitEvenly, computeBalances, settleUp, countsTowardsPace, pace } = require('./logic/expenses');
const router = express.Router({ mergeParams: true });

const TYPES = ['shared', 'extra', 'personal'];
const CATEGORIES = ['food', 'extras', 'accommodation', 'transport', 'other'];
const LOGGABLE = ['booked', 'on_trip']; // expenses can be added before or during the trip

// Load the trip if the caller is in it, or answer 404.
async function loadTrip(req, res) {
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.status, g.base_currency, g.current_day, g.organiser_id,
            to_char(g.trip_start, 'YYYY-MM-DD') AS trip_start,
            to_char(g.trip_end, 'YYYY-MM-DD') AS trip_end,
            d.city, gm.role
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $2
     LEFT JOIN destinations d ON d.id = g.destination_id
     WHERE g.id = $1`, [req.params.groupId, req.user.userId]);
  if (!rows.length) {
    res.status(404).json({ error: 'not a member' });
    return null;
  }
  return rows[0];
}

const loadMembers = async (groupId) => (await db.query(
  `SELECT m.user_id, m.name, u.username, m.home_currency
   FROM v_member_public m JOIN users u ON u.id = m.user_id
   WHERE m.group_id = $1 ORDER BY m.name`, [groupId])).rows;

// Shared and extra expenses for everyone, plus the caller's own personal ones.
async function loadExpenses(groupId, userId) {
  const { rows } = await db.query(
    `SELECT e.id, e.payer_id, e.type, e.category, e.description, e.amount_minor, e.currency,
            e.amount_base_minor, e.fx_source, e.fx_fetched_at, e.trip_day,
            to_char(e.spent_on, 'YYYY-MM-DD') AS spent_on,
            json_agg(json_build_object('user_id', p.user_id, 'share_base_minor', p.share_base_minor)
                     ORDER BY p.user_id) AS participants
     FROM expenses e JOIN expense_participants p ON p.expense_id = e.id
     WHERE e.group_id = $1 AND (e.type <> 'personal' OR e.payer_id = $2)
     GROUP BY e.id
     ORDER BY e.spent_on DESC, e.created_at DESC`, [groupId, userId]);
  return rows.map((e) => ({
    ...e,
    amount_minor: Number(e.amount_minor),
    amount_base_minor: Number(e.amount_base_minor),
    participants: e.participants.map((p) => ({ ...p, share_base_minor: Number(p.share_base_minor) })),
  }));
}

const balancesFrom = (members, expenses) => computeBalances(
  members.map((m) => m.user_id),
  // Personal expenses are one person paying for themselves: they never move a balance.
  expenses.filter((e) => e.type !== 'personal').map((e) => ({
    payerId: e.payer_id,
    amountBaseMinor: e.amount_base_minor,
    participants: e.participants.map((p) => ({ userId: p.user_id, shareBaseMinor: p.share_base_minor })),
  })),
);

// Record an add/delete and notify the people in the split (never the actor).
// Personal expenses are logged for the payer only and notify nobody.
async function logActivity(client, { groupId, actorId, action, expense, shares }) {
  const { rows: [activity] } = await client.query(
    `INSERT INTO trip_activity (group_id, actor_id, action, expense_id, type, category, description,
                                amount_minor, currency, amount_base_minor)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [groupId, actorId, action, expense.id, expense.type, expense.category, expense.description,
      expense.amount_minor, expense.currency, expense.amount_base_minor]);
  if (expense.type === 'personal') return;
  for (const s of shares) {
    if (s.userId === actorId) continue;
    await client.query(
      'INSERT INTO notifications (user_id, activity_id, share_base_minor) VALUES ($1, $2, $3)',
      [s.userId, activity.id, s.shareMinor]);
  }
}

// Days of the trip that count for pacing.
function tripDays(trip) {
  if (trip.status === 'on_trip') return Math.max(trip.current_day, 1);
  if (trip.status === 'settled' && trip.trip_start && trip.trip_end) {
    return Math.round((new Date(trip.trip_end) - new Date(trip.trip_start)) / 86400000) + 1;
  }
  return 0; // not started yet
}

// Wise payment link for one settlement (opens Wise's send flow; amounts are shown in the app).
const wiseLink = () => 'https://wise.com/send';

// Everything the trip page needs in one call
router.get('/', async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;
  const me = req.user.userId;
  const [members, expenses] = await Promise.all([loadMembers(trip.id), loadExpenses(trip.id, me)]);
  const { rows: [budget] } = await db.query(
    'SELECT private_daily_minor, currency FROM budgets WHERE group_id = $1 AND user_id = $2', [trip.id, me]);

  const currencies = [...members.map((m) => m.home_currency), ...(budget ? [budget.currency] : [])];
  const fx = await getRates(trip.base_currency, currencies);

  // Private pace: my share of food, extras and personal spending vs my daily budget.
  let myPace = null;
  const days = tripDays(trip);
  if (budget && days > 0) {
    const spentBase = expenses
      .filter(countsTowardsPace)
      .reduce((sum, e) => sum + (e.participants.find((p) => p.user_id === me)?.share_base_minor || 0), 0);
    myPace = {
      ...pace({
        dailyBudgetMinor: Number(budget.private_daily_minor),
        spentMinor: convertMinor(spentBase, trip.base_currency, budget.currency, fx.rates),
        days,
      }),
      currency: budget.currency,
    };
  }

  const balances = balancesFrom(members, expenses);
  // Latest activity; personal entries only for the person who paid.
  const { rows: activity } = await db.query(
    `SELECT id, actor_id, action, type, category, description, amount_minor, currency, created_at
     FROM trip_activity
     WHERE group_id = $1 AND (type <> 'personal' OR actor_id = $2)
     ORDER BY created_at DESC LIMIT 30`, [trip.id, me]);
  // Opening the trip counts as having seen its notifications.
  await db.query(
    `UPDATE notifications SET read_at = now()
     WHERE user_id = $1 AND read_at IS NULL
       AND activity_id IN (SELECT id FROM trip_activity WHERE group_id = $2)`, [me, trip.id]);

  const { rows: settlements } = await db.query(
    `SELECT id, from_user, to_user, amount_base_minor, amount_minor, currency, fx_source, wise_link, settled_at
     FROM settlements WHERE group_id = $1 ORDER BY created_at, id`, [trip.id]);

  // Before settling, suggest the payments, converted to each payer's currency at today's rate.
  const homeCurrency = Object.fromEntries(members.map((m) => [m.user_id, m.home_currency]));
  const suggested = settlements.length ? [] : settleUp(balances).map((t) => ({
    from_user: t.from,
    to_user: t.to,
    amount_base_minor: t.amountMinor,
    amount_minor: convertMinor(t.amountMinor, trip.base_currency, homeCurrency[t.from], fx.rates),
    currency: homeCurrency[t.from],
  }));

  res.json({
    trip,
    me,
    members,
    expenses,
    balances: members.map((m) => ({ user_id: m.user_id, balance_base_minor: balances[m.user_id] || 0 })),
    suggested,
    settlements,
    pace: myPace,
    activity: activity.map((a) => ({ ...a, amount_minor: Number(a.amount_minor) })),
    rates: { source: fx.source, fetched_at: fx.fetchedAt },
  });
});

// Log something you paid for
router.post('/expenses', async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;
  const me = req.user.userId;
  if (!LOGGABLE.includes(trip.status)) {
    return res.status(409).json({ error: trip.status === 'settled'
      ? 'This trip is settled, so no more expenses can be added.'
      : 'Expenses can be added once the trip is booked.' });
  }

  const { type, category = 'other', description = '' } = req.body;
  const amountMinor = req.body.amount_minor;
  const currency = String(req.body.currency || '').toUpperCase();
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return res.status(400).json({ error: 'Enter an amount above 0.' });
  }
  if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ error: 'Currency must be a 3-letter code.' });
  if (!TYPES.includes(type)) return res.status(400).json({ error: `Type must be one of: ${TYPES.join(', ')}.` });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}.` });

  const members = await loadMembers(trip.id);
  const memberIds = new Set(members.map((m) => m.user_id));
  let participantIds = type === 'personal' ? [me] : [...new Set(req.body.participant_ids || [])];
  if (!participantIds.length) return res.status(400).json({ error: 'Pick who this was for.' });
  if (!participantIds.every((id) => memberIds.has(id))) {
    return res.status(400).json({ error: 'Everyone in the split has to be on the trip.' });
  }
  // Keep member order so the leftover cent always lands on the same people.
  participantIds = members.map((m) => m.user_id).filter((id) => participantIds.includes(id));

  let fx;
  try {
    fx = await getRates(trip.base_currency, [currency]);
  } catch {
    return res.status(400).json({ error: `No exchange rate available for ${currency}.` });
  }
  const amountBaseMinor = convertMinor(amountMinor, currency, trip.base_currency, fx.rates);
  if (amountBaseMinor <= 0) return res.status(400).json({ error: 'That amount is too small to record.' });
  const shares = splitEvenly(amountBaseMinor, participantIds);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [expense] } = await client.query(
      `INSERT INTO expenses (group_id, payer_id, type, category, description, amount_minor, currency,
                             fx_rate_to_base, amount_base_minor, fx_source, fx_fetched_at, trip_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [trip.id, me, type, category, String(description).trim() || null, amountMinor, currency,
        rateBetween(currency, trip.base_currency, fx.rates), amountBaseMinor,
        currency === trip.base_currency ? 'wise' : fx.source, fx.fetchedAt,
        trip.status === 'on_trip' ? trip.current_day : null]);
    // Shares must add up to the base amount; the trigger checks this at COMMIT.
    for (const s of shares) {
      await client.query(
        'INSERT INTO expense_participants (expense_id, user_id, share_base_minor) VALUES ($1, $2, $3)',
        [expense.id, s.userId, s.shareMinor]);
    }
    await logActivity(client, {
      groupId: trip.id,
      actorId: me,
      action: 'expense_added',
      expense: { id: expense.id, type, category, description: String(description).trim() || null,
        amount_minor: amountMinor, currency, amount_base_minor: amountBaseMinor },
      shares,
    });
    await client.query('COMMIT');
    res.status(201).json({ id: expense.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// Delete an expense you logged (until the trip is settled)
router.delete('/expenses/:expenseId', async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;
  if (!LOGGABLE.includes(trip.status)) return res.status(409).json({ error: 'This trip is settled.' });
  const me = req.user.userId;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Snapshot it first, so the log and notifications can say what was deleted.
    const { rows: [expense] } = await client.query(
      `SELECT id, type, category, description, amount_minor, currency, amount_base_minor
       FROM expenses WHERE id = $1 AND group_id = $2 AND payer_id = $3 FOR UPDATE`,
      [req.params.expenseId, trip.id, me]);
    if (!expense) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'You can only delete expenses you paid for.' });
    }
    const { rows: participants } = await client.query(
      'SELECT user_id, share_base_minor FROM expense_participants WHERE expense_id = $1', [expense.id]);
    await client.query('DELETE FROM expenses WHERE id = $1', [expense.id]);
    await logActivity(client, {
      groupId: trip.id,
      actorId: me,
      action: 'expense_deleted',
      expense,
      shares: participants.map((p) => ({ userId: p.user_id, shareMinor: Number(p.share_base_minor) })),
    });
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// Work out who pays whom and write it down. Used by the settle endpoint and db:reset.
async function createSettlements(client, groupId) {
  const { rows: [group] } = await client.query('SELECT base_currency FROM groups WHERE id = $1', [groupId]);
  const members = (await client.query(
    'SELECT user_id, home_currency FROM v_member_public WHERE group_id = $1', [groupId])).rows;
  const { rows: expenseRows } = await client.query(
    `SELECT e.payer_id, e.amount_base_minor,
            json_agg(json_build_object('user_id', p.user_id, 'share_base_minor', p.share_base_minor)) AS participants
     FROM expenses e JOIN expense_participants p ON p.expense_id = e.id
     WHERE e.group_id = $1 AND e.type <> 'personal'
     GROUP BY e.id`, [groupId]);
  const expenses = expenseRows.map((e) => ({
    type: 'shared',
    payer_id: e.payer_id,
    amount_base_minor: Number(e.amount_base_minor),
    participants: e.participants.map((p) => ({ user_id: p.user_id, share_base_minor: Number(p.share_base_minor) })),
  }));

  const transfers = settleUp(balancesFrom(members, expenses));
  const homeCurrency = Object.fromEntries(members.map((m) => [m.user_id, m.home_currency]));
  const fx = await getRates(group.base_currency, members.map((m) => m.home_currency));
  for (const t of transfers) {
    const currency = homeCurrency[t.from];
    await client.query(
      `INSERT INTO settlements (group_id, from_user, to_user, amount_base_minor, amount_minor, currency,
                                rate_used, fx_source, wise_link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [groupId, t.from, t.to, t.amountMinor,
        Math.max(1, convertMinor(t.amountMinor, group.base_currency, currency, fx.rates)), currency,
        rateBetween(group.base_currency, currency, fx.rates),
        currency === group.base_currency ? 'wise' : fx.source, wiseLink()]);
  }
  return transfers.length;
}

// End the trip: freeze the payments and mark it settled. Organiser only.
router.post('/settle', async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;
  if (trip.role !== 'organiser') return res.status(403).json({ error: 'Only the organiser can settle up.' });
  if (!LOGGABLE.includes(trip.status)) return res.status(409).json({ error: 'This trip is already settled.' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the group so two clicks can't create the payments twice.
    const { rows: [locked] } = await client.query('SELECT status FROM groups WHERE id = $1 FOR UPDATE', [trip.id]);
    if (!LOGGABLE.includes(locked.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This trip is already settled.' });
    }
    const count = await createSettlements(client, trip.id);
    await client.query(`UPDATE groups SET status = 'settled' WHERE id = $1`, [trip.id]);
    await client.query('COMMIT');
    res.json({ payments: count });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// The payer marks a payment as sent
router.post('/settlements/:settlementId/paid', async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;
  const { rowCount } = await db.query(
    `UPDATE settlements SET settled_at = now()
     WHERE id = $1 AND group_id = $2 AND from_user = $3 AND settled_at IS NULL`,
    [req.params.settlementId, trip.id, req.user.userId]);
  if (!rowCount) return res.status(404).json({ error: 'No unpaid payment from you with that id.' });
  res.json({ ok: true });
});

// Demo clock: move an ongoing trip to the next day. Organiser only.
router.post('/next-day', async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;
  if (trip.role !== 'organiser') return res.status(403).json({ error: 'Only the organiser can move the trip on.' });
  if (trip.status !== 'on_trip') return res.status(409).json({ error: 'The trip has to be under way.' });
  const { rows: [g] } = await db.query(
    'UPDATE groups SET current_day = current_day + 1 WHERE id = $1 RETURNING current_day', [trip.id]);
  res.json({ current_day: g.current_day });
});

module.exports = router;
module.exports.createSettlements = createSettlements;
