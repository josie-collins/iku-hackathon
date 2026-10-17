require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get('/', (req, res) => res.send('Hello from the backend'));
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', require('./session'));
app.use('/api/budgets', require('./budgets'));
app.use('/api/account', require('./account'));

app.listen(PORT, () => console.log(`server listening on port ${PORT}`));