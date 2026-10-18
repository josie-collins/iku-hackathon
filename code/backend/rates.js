// Exchange rates for showing "≈ £325" next to amounts in another currency.
// Same Wise rates (and fallback) as the rest of the app, cached for an hour.

const express = require('express');
const auth = require('./auth');
const { getRates } = require('./integrations/wise');
const router = express.Router();

const MAX_CODES = 25;

// GET /api/rates?currencies=GBP,EUR,NGN  ->  { rates: { EUR: 1, GBP: 0.84, ... }, source, fetched_at }
// Rates are per 1 EUR, the shape logic/fx.js uses.
router.get('/', auth, async (req, res) => {
  const codes = [...new Set(String(req.query.currencies || '').toUpperCase().split(',').filter(Boolean))];
  if (!codes.length || codes.length > MAX_CODES || !codes.every((c) => /^[A-Z]{3}$/.test(c))) {
    return res.status(400).json({ error: `currencies must be 1-${MAX_CODES} three-letter codes, comma separated` });
  }
  try {
    const { rates, source, fetchedAt } = await getRates('EUR', codes);
    res.json({ rates, source, fetched_at: fetchedAt });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
