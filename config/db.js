import { myHost, myUser, myPassword, myDatabase, myPort } from '../keys.js';
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
import mysql from 'mysql2/promise';

const poolConfig = {
  host: myHost.trim(),
  port: parseInt(myPort.trim(), 10),
  user: myUser.trim(),
  password: myPassword.trim(),
  database: myDatabase.trim(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
  timezone: '+02:00', // SAST — South Africa Standard Time
  supportBigNumbers: true,
  bigNumberStrings: true
};

const mysqlPool = mysql.createPool(poolConfig);

// Without this listener, a connection-level error (e.g. a timeout) is an
// unhandled 'error' event and crashes the whole Node process. Logging it
// here lets the pool recover and keeps serving other requests instead.
mysqlPool.on('error', (err) => {
  console.error(`❌ MySQL pool error: ${err.code || err.message}`);
});

// --- Retry configuration -----------------------------------------------

// Errors that are typically transient — a dropped TCP connection, a
// momentary network blip, or the pool handing back a stale connection —
// and are safe to retry. Anything else (bad SQL, auth failure, constraint
// violation) should fail immediately instead of being retried.
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EPIPE',
  'ER_CON_COUNT_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'
]);

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 200; // doubles each attempt: 200, 400, 800...

const isRetryableError = (err) =>
  RETRYABLE_ERROR_CODES.has(err?.code) || /ECONNRESET|ETIMEDOUT/i.test(err?.message || '');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wraps any async function that touches the pool (getConnection, query,
// execute...) with retry + exponential backoff for transient errors.
const withRetry = async (fn, { label = 'operation', maxRetries = DEFAULT_MAX_RETRIES, baseDelayMs = DEFAULT_BASE_DELAY_MS } = {}) => {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const retryable = isRetryableError(err);

      if (!retryable || attempt > maxRetries) {
        console.error(`🔥 [MySQL] ${label} failed permanently after ${attempt - 1} retr${attempt - 1 === 1 ? 'y' : 'ies'}: ${err.code || err.message}`);
        throw err;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`⚠️ [MySQL] ${label} hit ${err.code || err.message}, retrying (${attempt}/${maxRetries}) in ${delay}ms...`);
      await sleep(delay);
    }
  }
};

// --- Connection helpers --------------------------------------------------

// Centralized getConnection with retry + logging.
const getConnection = async () => withRetry(
  async () => {
    const connection = await mysqlPool.getConnection();
    console.log(`[${getShortTime()}] 🔌 MySQL connection acquired from pool`);
    return connection;
  },
  { label: 'getConnection' }
);

// Convenience wrapper for one-off queries that don't need manual
// connection management — acquires a connection, runs the query,
// retries the whole thing on transient failure, and always releases.
const query = async (sql, params = [], { label } = {}) => withRetry(
  async () => {
    const connection = await mysqlPool.getConnection();
    try {
      const [rows] = await connection.query(sql, params);
      return rows;
    } finally {
      connection.release();
    }
  },
  { label: label || `query [${typeof sql === 'string' ? sql.slice(0, 40) : 'query'}]` }
);

export { mysqlPool, getConnection, query, withRetry, isRetryableError };