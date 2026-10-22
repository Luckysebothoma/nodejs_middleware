import { myHost, myUser, myPassword, myDatabase, myPort } from '../keys.js';
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
import mysql from 'mysql2/promise';



// These should be defined in your environment or securely passed
//const myHost = process.env.MYSQL_HOST || 'localhost';/
//const myUser = process.env.MYSQL_USER || 'root';
//const myPassword = process.env.MYSQL_PASSWORD || '';
//const myDatabase = process.env.MYSQL_DATABASE || 'myapp';

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
  // Stale-connection protection. Idle pooled connections get silently dropped by MySQL
  // (wait_timeout) or by the network between containers/hosts; the next query on such a
  // connection then fails instantly with "read ECONNRESET". Keep sockets alive and retire
  // idle ones client-side before that can happen.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 10,          // idle connections kept in the pool (<= connectionLimit)
  idleTimeout: 60000,   // close connections idle for 60s (ms)
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

// Centralized getConnection for logging/debugging.
// Every connection is health-checked (ping) before it is handed out. A pooled connection that
// the server/network already closed is destroyed (so the pool drops it) and another one is
// tried, instead of letting the caller's first real query die with ECONNRESET.
// Only the ping is retried, never a caller's query, so no write is ever executed twice.
const MAX_ACQUIRE_ATTEMPTS = 5;

const getConnection = async () => {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS; attempt++) {
    const connection = await mysqlPool.getConnection(); // connect errors propagate to the caller
    try {
      await connection.ping();
      console.log(`[${getShortTime()}] 🔌 MySQL connection acquired from pool`);
      return connection;
    } catch (err) {
      lastErr = err;
      console.warn(`[${getShortTime()}] ♻️ Discarding stale MySQL connection (attempt ${attempt}/${MAX_ACQUIRE_ATTEMPTS}): ${err.code || err.message}`);
      try { connection.destroy(); } catch (_) { /* already closed */ }
    }
  }
  throw lastErr;
};

export { mysqlPool, getConnection };