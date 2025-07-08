import pg from 'pg';
const { Pool } = pg;

import {
  pgUser,
  pgHost,
  pgDatabase,
  pgPassword,
  pgPort
} from '../keys.js';

const poolConfig = {
  user: pgUser.trim(),
  host: pgHost.trim(),
  database: pgDatabase.trim(),
  password: pgPassword.trim(),
  port: pgPort.trim(),
  max: 10, // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

export const pgClient = new Pool(poolConfig);

// Initial connection test
const initPgConnection = async () => {
  try {
    const client = await pgClient.connect();
    console.log(`[Postgres] ✅ Connected to DataBase: ${pgDatabase} @ ${pgHost}:${pgPort}`);
    client.release();
  } catch (err) {
    console.error(`[Postgres] ❌ Initial connection failed:
      username: ${pgUser}, password: ${pgPassword} dn name: ${pgDatabase}
      Host ${pgHost} posrt ${pgPort}
      \n`, err);
    process.exit(1);
  }
};

// Generic query executor with logging
export const pgQuery = async (text, params = [], tag = '') => {
  const label = tag ? `[${tag}]` : '';
  try {
    const res = await pgClient.query(text, params);
    console.log(`[Postgres] ✅ Query Success ${label}: ${text}`);
    return res;
  } catch (err) {
    console.error(`[Postgres] ❌ Query Error ${label}:`, err.message);
    console.error(`SQL: ${text}`);
    throw err;
  }
};

// Check connection health (e.g. for monitoring or liveness probes)
export const pgPing = async () => {
  try {
    await pgClient.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

// Graceful disconnection (e.g. in SIGINT/SIGTERM handlers)
export const pgDisconnect = async () => {
  try {
    await pgClient.end();
    console.log('[Postgres] 🔌 Disconnected gracefully.');
  } catch (err) {
    console.error('[Postgres] ❌ Disconnect error:', err.message);
  }
};

// Immediately test the connection
await initPgConnection();
