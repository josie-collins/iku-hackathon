// Rebuild the database from scratch:  npm run db:reset
// Runs schema.sql -> seed.sql, then timescale.sql if the database supports it.
// Drops every table first. DO NOT run on a database with real data.

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is empty in code/backend/.env');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const file of ['schema.sql', 'seed.sql']) {
      console.log(`▸ running ${file}`);
      await client.query(read(file));
    }

    // Continuous aggregates can't be created inside a transaction block, and a
    // multi-statement query counts as one, so send each statement on its own.
    console.log('▸ running timescale.sql (optional)');
    const statements = read('timescale.sql')
      .replace(/--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      for (const sql of statements) await client.query(sql);
    } catch (err) {
      console.log(`! timescale.sql skipped (${err.message}). Fine on plain Postgres.`);
    }
    // Work out the shortlist for trips still being planned, as a budget save would.
    const { recomputeGroup, OPEN_STATUSES } = require('../shortlist');
    const { rows: open } = await client.query('SELECT id, name FROM groups WHERE status = ANY($1)', [OPEN_STATUSES]);
    for (const g of open) {
      const result = await recomputeGroup(g.id);
      console.log(`▸ ${g.name}: ${result.status}, ${result.optionCount} option(s)`);
    }
    // A few sample votes, now that the shortlists exist. Summer Trip (the demo) stays unvoted.
    const { rowCount: votes } = await client.query(
      `INSERT INTO votes (option_id, user_id, approve)
       SELECT o.id, u.id, v.approve
       FROM (VALUES
         ('February Weekend Away', 'Valencia', 'mateo', true),
         ('February Weekend Away', 'Valencia', 'lucia', true),
         ('February Weekend Away', 'Porto',    'priya', true),
         ('February Weekend Away', 'Prague',   'lucia', false),
         ('Spring Holiday 2027',   'Budapest', 'priya', true),
         ('Spring Holiday 2027',   'Budapest', 'jonas', true),
         ('Spring Holiday 2027',   'Prague',   'priya', true),
         ('Spring Holiday 2027',   'Prague',   'aisha', false)
       ) AS v(trip, city, username, approve)
       JOIN groups g ON g.name = v.trip
       JOIN destinations d ON d.city = v.city
       JOIN destination_options o ON o.group_id = g.id AND o.destination_id = d.id
       JOIN users u ON u.username = v.username`);
    console.log(`▸ ${votes} sample vote(s)`);
    // Settled trips get their settle-up payments, already marked as paid.
    const { createSettlements } = require('../expenses');
    const { rows: settled } = await client.query(`SELECT id, name FROM groups WHERE status = 'settled'`);
    for (const g of settled) {
      const count = await createSettlements(client, g.id);
      await client.query('UPDATE settlements SET settled_at = now() WHERE group_id = $1', [g.id]);
      console.log(`▸ ${g.name}: ${count} settle-up payment(s)`);
    }
    console.log('▸ database reset. Demo logins: tom, amara, lucia, priya, mateo, kemi, jonas, aisha (password demo1234)');
  } finally {
    await client.end();
    await require('../db').pool.end();
  }
}

main().catch((err) => {
  console.error('✖', err.message);
  process.exit(1);
});
