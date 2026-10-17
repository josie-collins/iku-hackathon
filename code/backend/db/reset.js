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
    console.log('▸ database reset. Demo invite code: DEMO42');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('✖', err.message);
  process.exit(1);
});
