// Snowflake: used as an analytics warehouse. Holds ANONYMISED trip and spending data
// only (see logic/analytics.js): never budgets, names or user ids.
//
// If any required value is missing, isConfigured() is false and callers fall back
// to our own database, so the app works the same without Snowflake.

const path = require('node:path');
const snowflake = require('snowflake-sdk');

snowflake.configure({ logLevel: 'ERROR' });

const REQUIRED = ['SNOWFLAKE_ACCOUNT', 'SNOWFLAKE_USER', 'SNOWFLAKE_WAREHOUSE', 'SNOWFLAKE_DATABASE', 'SNOWFLAKE_SCHEMA'];

function isConfigured() {
  const env = process.env;
  return REQUIRED.every((k) => env[k]) && Boolean(env.SNOWFLAKE_PRIVATE_KEY_PATH || env.SNOWFLAKE_PRIVATE_KEY);
}

function connectionOptions() {
  const env = process.env;
  const options = {
    account: env.SNOWFLAKE_ACCOUNT,
    username: env.SNOWFLAKE_USER,
    authenticator: 'SNOWFLAKE_JWT',
    warehouse: env.SNOWFLAKE_WAREHOUSE,
    database: env.SNOWFLAKE_DATABASE,
    schema: env.SNOWFLAKE_SCHEMA,
    application: 'iku-hackathon',
  };
  if (env.SNOWFLAKE_ROLE) options.role = env.SNOWFLAKE_ROLE;
  if (env.SNOWFLAKE_PRIVATE_KEY) {
    // .env files often store the PEM on one line with literal \n
    options.privateKey = env.SNOWFLAKE_PRIVATE_KEY.replace(/\\n/g, '\n');
  } else {
    options.privateKeyPath = path.resolve(__dirname, '..', env.SNOWFLAKE_PRIVATE_KEY_PATH);
  }
  if (env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE) options.privateKeyPass = env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE;
  return options;
}

let connecting = null; // one shared connection, opened on first use

function getConnection() {
  if (!isConfigured()) return Promise.reject(new Error('Snowflake is not configured'));
  if (!connecting) {
    connecting = snowflake.createConnection(connectionOptions()).connectAsync()
      .catch((err) => {
        connecting = null; // try again next time
        throw err;
      });
  }
  return connecting;
}

/**
 * Run one statement. `binds` is an array of values for ? placeholders, or an
 * array of arrays to insert many rows at once.
 * @returns {Promise<object[]>} rows, with column names as Snowflake returns them (upper case)
 */
async function query(sqlText, binds) {
  const connection = await getConnection();
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete: (err, statement, rows) => (err ? reject(err) : resolve(rows || [])),
    });
  });
}

async function close() {
  if (!connecting) return;
  const connection = await connecting.catch(() => null);
  connecting = null;
  if (connection) await new Promise((resolve) => connection.destroy(() => resolve()));
}

module.exports = { isConfigured, query, close };
