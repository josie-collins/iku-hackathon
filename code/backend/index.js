require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080;
// The built React app (npm run build in code/frontend). In development it doesn't
// exist and the React dev server serves the frontend instead.
const FRONTEND_BUILD = path.join(__dirname, '..', 'frontend', 'build');
const serveFrontend = fs.existsSync(path.join(FRONTEND_BUILD, 'index.html'));

app.use(express.json({ limit: '10mb' })); // receipt photos and voice notes are sent as base64

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', require('./session'));
app.use('/api/budgets', require('./budgets'));
app.use('/api/account', require('./account'));
app.use('/api/friends', require('./friends'));
app.use('/api/trips', require('./trips'));
app.use('/api/notifications', require('./notifications'));
app.use('/api/insights', require('./explore'));
app.use('/api/rates', require('./rates'));

// Unknown API routes get JSON, never the web page.
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

if (serveFrontend) {
  // Production: one server for the app and the API, so no CORS.
  app.use(express.static(FRONTEND_BUILD, { index: false, maxAge: '1h' }));
  // Any other page is the single-page app; React decides what to show.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.set('Cache-Control', 'no-cache'); // so a new deploy is picked up straight away
    res.sendFile(path.join(FRONTEND_BUILD, 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.send('Hello from the backend'));
}

// Malformed ids (e.g. not a UUID) are the caller's mistake, not a server error.
app.use((err, req, res, next) => {
  if (err.code === '22P02') return res.status(400).json({ error: 'invalid id' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`server listening on port ${PORT}${serveFrontend ? ' (serving the built frontend)' : ''}`);
});
