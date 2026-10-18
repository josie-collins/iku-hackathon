require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '10mb' })); // receipt photos and voice notes are sent as base64

app.get('/', (req, res) => res.send('Hello from the backend'));
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', require('./session'));
app.use('/api/budgets', require('./budgets'));
app.use('/api/account', require('./account'));
app.use('/api/friends', require('./friends'));
app.use('/api/trips', require('./trips'));
app.use('/api/notifications', require('./notifications'));

// Malformed ids (e.g. not a UUID) are the caller's mistake, not a server error.
app.use((err, req, res, next) => {
  if (err.code === '22P02') return res.status(400).json({ error: 'invalid id' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

app.listen(PORT, () => console.log(`server listening on port ${PORT}`));