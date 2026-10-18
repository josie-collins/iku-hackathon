// Destination insights for the web app: the same numbers as the Snowflake
// dashboard (insights.js reads Snowflake, falling back to Postgres).
// Everything here is anonymised or sample data, so any logged-in user can see it.

const express = require('express');
const db = require('./db');
const auth = require('./auth');
const { destinationSpend } = require('./insights');
const { getRates } = require('./integrations/wise');
const { convertMinor } = require('./logic/fx');
const router = express.Router();

// GET /api/insights?currency=GBP  (defaults to the caller's home currency)
router.get('/', auth, async (req, res) => {
  let currency = String(req.query.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    const { rows: [user] } = await db.query('SELECT home_currency FROM users WHERE id = $1', [req.user.userId]);
    currency = user ? user.home_currency : 'EUR';
  }

  const [{ byCity, byCityMonth, byCitySplit = {}, source }, fx] = await Promise.all([
    destinationSpend(),
    getRates('EUR', [currency]).catch(() => null),
  ]);
  if (!fx || !fx.rates[currency]) return res.status(400).json({ error: `No exchange rate for ${currency}.` });
  const money = (eurMinor) => convertMinor(eurMinor, 'EUR', currency, fx.rates);

  const names = [...new Set([...Object.keys(byCity), ...Object.keys(byCitySplit)])].sort();
  const cities = names.map((city) => {
    const yearly = byCity[city];
    const split = byCitySplit[city];
    const months = byCityMonth[city] || {};
    return {
      city,
      country_code: split ? split.countryCode : null,
      yearly: yearly
        ? { per_person_day_minor: money(yearly.perPersonDayMinor), days: yearly.days, sample_only: yearly.sampleOnly }
        : null,
      // Index 0 = January. null where there's no data for that month.
      months: Array.from({ length: 12 }, (_, i) => {
        const m = months[i + 1];
        return m ? { per_person_day_minor: money(m.perPersonDayMinor), days: m.days, sample_only: m.sampleOnly } : null;
      }),
      split: split
        ? { stay_minor: money(split.stayMinor), food_minor: money(split.foodMinor), activities_minor: money(split.activitiesMinor) }
        : null,
    };
  });

  res.json({
    currency,
    source, // 'snowflake' or 'local'
    rates: { source: fx.source, fetched_at: fx.fetchedAt },
    cities,
  });
});

module.exports = router;
