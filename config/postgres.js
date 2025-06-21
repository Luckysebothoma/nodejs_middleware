import pg from 'pg';
const { Pool } = pg;

import {
  pgUser,
  pgHost,
  pgDatabase,
  pgPassword,
  pgPort
} from '../keys.js';

// Create the PostgreSQL client pool
export const pgClient = new Pool({
  user: pgUser,
  host: pgHost,
  database: pgDatabase,
  password: pgPassword,
  port: pgPort,
  idleTimeoutMillis: 30000,  // Optional: close idle clients after 30 seconds
  connectionTimeoutMillis: 10000 // Optional: return an error after 10 seconds if connection could not be established
});

// Attempt to connect
pgClient.connect()
  .then(() => {
    console.log(`[Postgres] Connected to database: ${pgDatabase} @ ${pgHost}:${pgPort}`);
  })
  .catch(err => {
    console.error('[Postgres] Connection error:', err);
  });

// Reusable query function
export const pgQuery = async (text, params) => {
  try {
    const res = await pgClient.query(text, params);
    return res;
  } catch (err) {
    console.error('[Postgres] Query error:', err.message, text);
    throw err;
  }
};

// Close connection gracefully (optional for shutdown scripts)
export const pgDisconnect = async () => {
  await pgClient.end();
  console.log('[Postgres] Disconnected.');
};
