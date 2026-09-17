import pg from 'pg';
import crypto from 'crypto';
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
  port: parseInt(pgPort.trim(), 10),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

export const pgClient = new Pool(poolConfig);

// --- Internal helpers ---
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getTTL(exp) {
  return Math.floor((exp * 1000 - Date.now()) / 1000);
}

// --- Init Connection ---
const initPgConnection = async () => {
  try {
    const client = await pgClient.connect();
    console.log(`[Postgres] ✅ Connected to Database: ${pgDatabase} @ ${pgHost}:${pgPort}`);
    client.release();
  } catch (err) {
    console.error(`[Postgres] ❌ Initial connection failed:
      username: ${pgUser}, password: ${pgPassword}, db name: ${pgDatabase}
      Host: ${pgHost}, port: ${pgPort}
      \n`, err);
    process.exit(1);
  }
};

// --- Generic Query ---
export const pgQuery = async (text, params = [], tag = '') => {
  const label = tag ? `[${tag}]` : '';
  const start = Date.now();
  try {
    const res = await pgClient.query(text, params);
    console.log(`[Postgres] ✅ Query Success ${label} (${Date.now() - start}ms): ${text}`);
    return res;
  } catch (err) {
    console.error(`[Postgres] ❌ Query Error ${label}:`, err.message);
    console.error(`SQL: ${text}`);
    throw err;
  }
};

// --- Health Check ---
export const pgPing = async () => {
  try {
    await pgClient.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

// --- Graceful Disconnect ---
export const pgDisconnect = async () => {
  try {
    await pgClient.end();
    console.log('[Postgres] 🔌 Disconnected gracefully.');
  } catch (err) {
    console.error('[Postgres] ❌ Disconnect error:', err.message);
  }
};

// --- Track Token Reusable Function ---
export const trackToken = async ({ token, decoded, source = 'redis' }) => {
  if (!token || !decoded) {
    console.error('[Postgres] ❌ trackToken called without token or decoded payload');
    return;
  }

  const tokenHash = hashToken(token);
  const issuedAt = new Date(decoded.iat * 1000);
  const expiresAt = new Date(decoded.exp * 1000);
  const ttl = getTTL(decoded.exp);
  const permissions = Array.isArray(decoded.permissions) ? decoded.permissions : [];

  const sql = `
    INSERT INTO auth_tokens 
      (token_hash, user_id, issuer, audience, issued_at, expires_at, ttl_seconds, source, permissions)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (token_hash)
    DO UPDATE SET
      last_seen = NOW(),
      ttl_seconds = EXCLUDED.ttl_seconds,
      permissions = EXCLUDED.permissions,
      source = EXCLUDED.source,
      updated_at = NOW();
  `;

  try {
    await pgQuery(sql, [
      tokenHash,
      decoded.sub,
      decoded.iss,
      Array.isArray(decoded.aud) ? decoded.aud.join(",") : decoded.aud,
      issuedAt,
      expiresAt,
      ttl,
      source,
      permissions
    ], 'trackToken');

    // Observability log for scraping
    console.log(`[OBSERVE] token_tracked{user="${decoded.sub}", source="${source}", ttl=${ttl}} 1`);
  } catch (err) {
    console.error('[Postgres] ❌ trackToken error:', err.message);
  }
};

// Init connection immediately
await initPgConnection();
