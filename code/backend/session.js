const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { hashPassword, verifyPassword } = require('./passwords');
const router = express.Router();

const USERNAME = /^[a-z0-9_]{3,20}$/;
const MIN_PASSWORD = 8;
// Compared against when the username doesn't exist, so a wrong username takes
// as long as a wrong password and doesn't reveal which accounts exist.
const DUMMY_HASH = hashPassword('not-a-real-password');

const signToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

// Create an account and log straight in
router.post('/signup', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const { password = '', name = '', homeCurrency = '', departureAirport = '' } = req.body;

  if (!USERNAME.test(username)) {
    return res.status(400).json({ error: 'Usernames are 3–20 characters: letters, numbers and _ only.' });
  }
  if (String(password).length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Passwords need at least ${MIN_PASSWORD} characters.` });
  }
  if (!String(name).trim()) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[A-Za-z]{3}$/.test(homeCurrency)) {
    return res.status(400).json({ error: 'Home currency must be a 3-letter code, like GBP.' });
  }
  // Required: the shortlist prices each member's flight from here.
  if (!/^[A-Za-z]{3}$/.test(departureAirport)) {
    return res.status(400).json({ error: 'Home airport must be a 3-letter code, like LHR.' });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, name, home_currency, departure_airport)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, await hashPassword(String(password)), String(name).trim(),
        homeCurrency.toUpperCase(), departureAirport.toUpperCase()]);
    res.status(201).json({ token: signToken(rows[0].id) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is taken.' });
    throw err;
  }
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const { rows } = await db.query('SELECT id, password_hash FROM users WHERE username = $1', [username]);
  const ok = await verifyPassword(password, rows.length ? rows[0].password_hash : await DUMMY_HASH);
  if (!rows.length || !ok) return res.status(401).json({ error: 'Wrong username or password.' });
  res.json({ token: signToken(rows[0].id) });
});

module.exports = router;
