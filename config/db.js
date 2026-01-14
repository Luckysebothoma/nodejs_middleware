import mysql from 'mysql2/promise';
import { myHost, myUser, myPassword, myDatabase } from '../keys.js';
import TimeUtils from '../utils/Time.js';

const { getShortTime, getMidTime } = TimeUtils;

const normalizeHost = (host) => {
  if (!host) return host;

  return host
    .toString()
    .trim()
    .replace(/^"+|"+$/g, '')   // remove surrounding quotes
    .replace(/^'+|'+$/g, '');  // remove single quotes
};


/* ---------------------------------------------------
   Pool Configuration
--------------------------------------------------- */
const poolConfig = {
  host: normalizeHost(myHost),
  user: myUser.trim(),
  password: myPassword.trim(),
  database: myDatabase.trim(),

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  timezone: '+02:00', // SAST
  supportBigNumbers: true,
  bigNumberStrings: true,

  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
};


const mysqlPool = mysql.createPool(poolConfig);

/* ---------------------------------------------------
   Connection Helpers
--------------------------------------------------- */
const getConnection = async () => {
  try {
    const conn = await mysqlPool.getConnection();
    console.log(`[${getShortTime()}] 🔌 MySQL connection acquired`);
    return conn;
  } catch (err) {
    console.error(`[${getShortTime()}] ❌ MySQL getConnection failed`, err);
    throw err;
  }
};

/* ---------------------------------------------------
   Startup Connection Test (call on app init)
--------------------------------------------------- */
const testConnection = async () => {
  try {
    const conn = await mysqlPool.getConnection();
    await conn.ping();
    conn.release();

    console.log(
      `[${getMidTime()}] ✅ MySQL connection test successful → ${poolConfig.host}`
    );
    return true;
  } catch (err) {
    console.error(
      `[${getMidTime()}] ❌ MySQL connection test FAILED`,
      err.message
    );
    return false;
  }
};

/* ---------------------------------------------------
   Health Check (for /health endpoints)
--------------------------------------------------- */
const healthCheck = async () => {
  try {
    await mysqlPool.query('SELECT 1');
    return {
      status: 'UP',
      db: myDatabase,
      time: getShortTime()
    };
  } catch (err) {
    return {
      status: 'DOWN',
      error: err.code || err.message,
      time: getShortTime()
    };
  }
};

/* ---------------------------------------------------
   Safe Query Wrapper
--------------------------------------------------- */
const query = async (sql, params = []) => {
  const start = Date.now();
  try {
    const [rows] = await mysqlPool.execute(sql, params);
    return rows;
  } catch (err) {
    console.error(
      `[${getShortTime()}] ❌ MySQL query error`,
      { sql, params, error: err.message }
    );
    throw err;
  } finally {
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn(
        `[${getShortTime()}] ⚠️ Slow query (${duration}ms):`,
        sql
      );
    }
  }
};

/* ---------------------------------------------------
   Transaction Helper
--------------------------------------------------- */
const withTransaction = async (callback) => {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    console.error(
      `[${getShortTime()}] ❌ Transaction rolled back`,
      err.message
    );
    throw err;
  } finally {
    conn.release();
  }
};

/* ---------------------------------------------------
   Pool Stats (Debug / Observability)
--------------------------------------------------- */
const poolStats = () => ({
  all: mysqlPool.pool._allConnections.length,
  free: mysqlPool.pool._freeConnections.length,
  queue: mysqlPool.pool._connectionQueue.length
});

/* ---------------------------------------------------
   Graceful Shutdown
--------------------------------------------------- */
const closePool = async () => {
  try {
    await mysqlPool.end();
    console.log(`[${getShortTime()}] 🛑 MySQL pool closed`);
  } catch (err) {
    console.error(`[${getShortTime()}] ❌ Error closing MySQL pool`, err);
  }
};

process.on('SIGTERM', closePool);
process.on('SIGINT', closePool);


await testConnection();
/* ---------------------------------------------------
   Exports
--------------------------------------------------- */
export {
  mysqlPool,
  getConnection,
  testConnection,
  healthCheck,
  query,
  withTransaction,
  poolStats,
  closePool
};
