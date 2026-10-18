// Recompute a group's "fits everyone" shortlist from every member's private
// budget and dates. Call it whenever a budget or the membership changes.
//
// PRIVACY: the ceiling and diagnostics stay inside this function. Only the
// shortlist (destination_options) and the group status are written out.

const db = require('./db');
const { findOptions } = require('./logic/feasibility');
const { getRates } = require('./integrations/wise');

// Once a trip is booked the destination is fixed, so stop recomputing.
const OPEN_STATUSES = ['planning', 'voting', 'resolving'];

async function loadInput(client, group) {
  const { rows: memberRows } = await client.query(
    `SELECT gm.user_id, u.name, u.home_currency, u.departure_airport,
            gm.trip_styles, gm.min_nights, gm.max_nights,
            b.flight_minor, b.group_minor, b.private_daily_minor, b.currency, b.accepts_stretch,
            COALESCE(json_agg(json_build_object(
                       'start', to_char(a.start_date, 'YYYY-MM-DD'),
                       'end',   to_char(a.end_date, 'YYYY-MM-DD')))
                     FILTER (WHERE a.id IS NOT NULL), '[]') AS availability
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     LEFT JOIN budgets b ON b.group_id = gm.group_id AND b.user_id = gm.user_id
     LEFT JOIN availability a ON a.group_id = gm.group_id AND a.user_id = gm.user_id
     WHERE gm.group_id = $1
     GROUP BY gm.group_id, gm.user_id, u.id, b.group_id, b.user_id`, [group.id]);

  const members = memberRows.map((m) => ({
    userId: m.user_id,
    name: m.name,
    currency: m.currency || m.home_currency,
    departureAirport: m.departure_airport,
    flightBudgetMinor: Number(m.flight_minor),
    groupBudgetMinor: Number(m.group_minor),
    dailyBudgetMinor: Number(m.private_daily_minor),
    acceptsStretch: m.accepts_stretch,
    minNights: m.min_nights,
    maxNights: m.max_nights,
    tripStyles: m.trip_styles,
    availability: m.availability,
    ready: m.flight_minor != null && m.availability.length > 0,
  }));

  const { rows: destRows } = await client.query(
    `SELECT id, city, tags, base_currency, accommodation_pp_night_minor, food_pp_day_minor, activities_pp_day_minor
     FROM destinations`);
  const destinations = destRows.map((d) => ({
    id: d.id,
    city: d.city,
    tags: d.tags,
    baseCurrency: d.base_currency,
    accommodationPpNightMinor: Number(d.accommodation_pp_night_minor),
    foodPpDayMinor: Number(d.food_pp_day_minor),
    activitiesPpDayMinor: Number(d.activities_pp_day_minor),
  }));

  const { rows: flightRows } = await client.query(
    'SELECT origin, destination_id, price_minor, currency FROM flight_estimates');
  const flights = flightRows.map((f) => ({
    origin: f.origin,
    destinationId: f.destination_id,
    priceMinor: Number(f.price_minor),
    currency: f.currency,
  }));

  return { members, destinations, flights };
}

/**
 * @returns {Promise<{ status: string, optionCount: number } | null>} null if the trip is past planning
 */
async function recomputeGroup(groupId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // One recompute per group at a time, so two saves can't interleave.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [groupId]);

    const { rows: groups } = await client.query(
      'SELECT id, status, base_currency FROM groups WHERE id = $1', [groupId]);
    const group = groups[0];
    if (!group || !OPEN_STATUSES.includes(group.status)) {
      await client.query('ROLLBACK');
      return null;
    }

    const { members, destinations, flights } = await loadInput(client, group);

    // Can't compute until everyone has entered a budget and their free dates.
    let status = 'planning';
    let options = [];
    if (members.length && members.every((m) => m.ready)) {
      const currencies = [
        ...members.map((m) => m.currency),
        ...destinations.map((d) => d.baseCurrency),
        ...flights.map((f) => f.currency),
      ];
      const { rates } = await getRates(group.base_currency, currencies);
      const result = findOptions({ baseCurrency: group.base_currency, rates, members, destinations, flights });
      options = result.options;
      status = result.status === 'options' ? 'voting' : 'resolving';
    }

    // Upsert so votes on options that still fit are kept; drop the rest.
    const keep = [];
    for (const o of options) {
      const { rows } = await client.query(
        `INSERT INTO destination_options (group_id, destination_id, window_start, window_end, est_cost_pp_minor, currency)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (group_id, destination_id, window_start, window_end) DO UPDATE SET
           est_cost_pp_minor = EXCLUDED.est_cost_pp_minor,
           currency = EXCLUDED.currency,
           generated_at = now()
         RETURNING id`,
        [groupId, o.destinationId, o.windowStart, o.windowEnd, o.estCostPpMinor, o.currency]);
      keep.push(rows[0].id);
    }
    await client.query(
      'DELETE FROM destination_options WHERE group_id = $1 AND NOT (id = ANY($2::uuid[]))', [groupId, keep]);
    await client.query('UPDATE groups SET status = $2 WHERE id = $1', [groupId, status]);

    await client.query('COMMIT');
    return { status, optionCount: options.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// For request handlers: a failed recompute shouldn't undo the user's save.
async function recomputeQuietly(groupId) {
  try {
    const result = await recomputeGroup(groupId);
    // New options get a "why this fits" reason from Cortex, in the background.
    if (result && result.status === 'voting') {
      require('./explanations').explainInBackground(groupId);
      // Live prices for the shortlisted options only (cached; drops any that no longer fit).
      require('./flightQuotes').flightsInBackground(groupId);
    }
    return result;
  } catch (err) {
    console.error(`recompute failed for group ${groupId}:`, err.message);
    return null;
  }
}

module.exports = { recomputeGroup, recomputeQuietly, OPEN_STATUSES };
