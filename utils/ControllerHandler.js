// dbOperations.js
//
// Tiered data access: Redis (cache) -> Postgres (primary) -> MySQL (legacy fallback).
// Reads check Redis first, then Postgres, then MySQL, and backfill the cache
// with whichever tier answered. Writes go to Postgres first, fall back to
// MySQL on Postgres failure, and always refresh/invalidate the cache key
// afterward rather than blind-writing the raw driver result into it.
//
// ASSUMPTION: when you add a Postgres client module at ../config/pgClient.js
// exporting `getPgConnection()`, it should return a pooled client shaped like
// the standard `pg` Pool client: { query(text, params) => Promise<{ rows, rowCount }>, release() }.
// If your actual module differs (different export name, different query
// signature, etc.), update the dynamic import below to match. Until that
// file exists, the Postgres tier is skipped automatically and every call
// falls through to MySQL — see getPgConnection() below.

import { getConnection } from '../config/db.js';
import TimeUtils from './Time.js';
const { getLongTime } = TimeUtils;
import { logRequestDetails, logResponseDetails } from './requestLogger.js';
import redisClient from '../config/redisClient.js';

const { connectRedis, cacheSet, cacheGet, cacheDelete, cacheExists, refreshKey } = redisClient;

// 📌 TTL for cache entries (seconds)
const TTL_SECONDS = 30000 * 10;

// ---------------------------------------------------------------------------
// 🔧 Small helpers
// ---------------------------------------------------------------------------

// Lazily/optionally load the Postgres client. Postgres isn't wired up in
// every environment yet, and a static top-level import throws
// ERR_MODULE_NOT_FOUND at boot (crashing the whole process) if
// ../config/pgClient.js doesn't exist. Resolving it dynamically, on first
// use, means: no pgClient.js yet -> Postgres tier is just skipped and every
// call falls straight through to MySQL, instead of the app refusing to start.
let _pgModulePromise;
const getPgConnection = async () => {
  if (_pgModulePromise === undefined) {
    _pgModulePromise = import('../config/pgClient.js').catch((err) => {
      console.warn(`${getLongTime()}⚠️ Postgres client module not available, skipping Postgres tier:`, err.message);
      return null;
    });
  }

  const pgModule = await _pgModulePromise;
  if (!pgModule) return null;

  return pgModule.getPgConnection();
};

// Safely pull a usable value out of whatever cacheGet(key) returns.
// Treats "not found" / errors as a cache miss rather than throwing, so the
// read path can fall through to Postgres/MySQL uninterrupted.
const tryGetFromCache = async (key) => {
  try {
    const cached = await cacheGet(key);
    if (!cached) return null;

    // cacheGet may return { success, value } style, a raw value, or a JSON string
    const raw = cached.value !== undefined ? cached.value : cached;
    if (raw === undefined || raw === null) return null;

    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }

    return raw;
  } catch (err) {
    console.warn(`${getLongTime()}⚠️ Cache read failed for key [${key}]:`, err.message);
    return null;
  }
};

const safeCacheSet = async (key, value) => {
  try {
    await cacheSet(key, value, TTL_SECONDS);
  } catch (err) {
    console.warn(`${getLongTime()}⚠️ Cache write failed for key [${key}]:`, err.message);
  }
};

const safeRefreshKey = async (key) => {
  try {
    await refreshKey(key);
  } catch (err) {
    console.warn(`${getLongTime()}⚠️ Cache refresh failed for key [${key}]:`, err.message);
  }
};

// ---------------------------------------------------------------------------
// 🔧 Reusable: SELECT — Redis -> Postgres -> MySQL
// ---------------------------------------------------------------------------
// pgQuery / mysqlQuery are { text, values } shaped query specs. Either can be
// omitted if that tier doesn't apply to a given call site (e.g. still MySQL-only).
const getCachedOrQuery = async (key, { pgQuery, mysqlQuery } = {}) => {
  // 1️⃣ Redis
  const cached = await tryGetFromCache(key);
  if (cached !== null) {
    console.log(`${getLongTime()}✅ Cache HIT for key [${key}]`);
    return cached;
  }
  console.log(`${getLongTime()}❌ Cache MISS for key [${key}]`);

  // 2️⃣ Postgres
  if (pgQuery) {
    let pgConn;
    try {
      pgConn = await getPgConnection();
      if (!pgConn) throw new Error('Postgres connection unavailable');

      console.log(`${getLongTime()}🔍 [Postgres] Executing SELECT for key [${key}]`);
      const { rows } = await pgConn.query(pgQuery.text, pgQuery.values ?? []);

      if (rows && rows.length > 0) {
        console.log(`${getLongTime()}✅ [Postgres] SELECT success: ${rows.length} rows on key ${key}`);
        await safeCacheSet(key, rows);
        return rows;
      }

      console.warn(`${getLongTime()}⚠️ [Postgres] Empty result for key: [${key}]`);
      await safeCacheSet(key, []);
      return [];
    } catch (err) {
      console.warn(`${getLongTime()}⚠️ [Postgres] SELECT failed for key [${key}], falling back to MySQL:`, err.message);
      // fall through to MySQL
    } finally {
      pgConn?.release?.();
    }
  }

  // 3️⃣ MySQL (legacy fallback)
  if (!mysqlQuery) {
    throw new Error(`❌ No MySQL fallback query provided for key [${key}] and Postgres unavailable/omitted`);
  }

  const connection = await getConnection();
  if (!connection) throw new Error('❌ MySQL connection failed');

  try {
    console.log(`${getLongTime()}🔍 [MySQL] Executing SELECT for key [${key}]`);
    const [rows] = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values);

    if (!rows || rows.length === 0) {
      console.warn(`${getLongTime()}⚠️ [MySQL] Empty result for key: [${key}]`);
      await safeCacheSet(key, []);
      return [];
    }

    console.log(`${getLongTime()}✅ [MySQL] SELECT success: ${rows.length} rows on key ${key}`);
    await safeCacheSet(key, rows);
    return rows;
  } catch (err) {
    console.error(`${getLongTime()}❌ [MySQL] SELECT failed on key ${key}:`, err.message);
    throw new Error(`${getLongTime()}❌ SELECT failed on key ${key}: ${err.message}`);
  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 [MySQL] Connection released for key: [${key}]`);
  }
};

// ---------------------------------------------------------------------------
// 🔧 Reusable: INSERT — Postgres first, MySQL fallback, then cache refresh
// ---------------------------------------------------------------------------
const addCachedAndQuery = async (key, { pgQuery, mysqlQuery } = {}) => {
  if (!key || (!pgQuery && !mysqlQuery)) {
    console.log(`Missing or invalid input(s):`, { key, pgQuery, mysqlQuery });
    throw new Error(`❌ Invalid input to addCachedAndQuery on key ${key}`);
  }

  // 1️⃣ Try Postgres
  if (pgQuery) {
    let pgConn;
    try {
      pgConn = await getPgConnection();
      if (!pgConn) throw new Error('Postgres connection unavailable');

      console.log(`${getLongTime()}📥 [Postgres] INSERTING key: [${key}]`, pgQuery);
      const result = await pgConn.query(pgQuery.text, pgQuery.values ?? []);

      console.log(`${getLongTime()}✅ [Postgres] INSERT successful on key ${key}`);
      await safeRefreshKey(key);
      return result;
    } catch (err) {
      console.warn(`${getLongTime()}⚠️ [Postgres] INSERT failed for key [${key}], falling back to MySQL:`, err.message);
      // fall through to MySQL
    } finally {
      pgConn?.release?.();
    }
  }

  // 2️⃣ MySQL fallback
  if (!mysqlQuery) {
    throw new Error(`❌ No MySQL fallback query provided for key [${key}] and Postgres unavailable/omitted`);
  }

  const connection = await getConnection();
  if (!connection) throw new Error('❌ MySQL connection failed');

  try {
    console.log(`${getLongTime()}📥 [MySQL] INSERTING key: [${key}]`, mysqlQuery);
    const result = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values ?? []);

    console.log(`${getLongTime()}✅ [MySQL] INSERT successful on key ${key}`);
    await safeRefreshKey(key);
    return result;
  } catch (err) {
    console.error(`${getLongTime()}❌ [MySQL] INSERT failed for key [${key}]:`, err.message);
    throw new Error(`${getLongTime()}❌ INSERT failed for key [${key}]: ${err.message}`);
  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 [MySQL] Connection released after insert: [${key}]`);
  }
};

// ---------------------------------------------------------------------------
// 🔧 Reusable: UPDATE — Postgres first, MySQL fallback, then cache refresh
// ---------------------------------------------------------------------------
const updateCachedOrQuery = async (key, { pgQuery, mysqlQuery } = {}) => {
  // 1️⃣ Try Postgres (transactional)
  if (pgQuery) {
    let pgConn;
    try {
      pgConn = await getPgConnection();
      if (!pgConn) throw new Error('Postgres connection unavailable');

      console.log(`${getLongTime()}📥 [Postgres] Updating key: [${key}]`, pgQuery);

      await pgConn.query('BEGIN');
      const result = await pgConn.query(pgQuery.text, pgQuery.values ?? []);

      if (!result.rowCount) {
        console.warn(`${getLongTime()}⚠️ [Postgres] No rows updated for key: [${key}]`);
      } else {
        console.log(`${getLongTime()}✅ [Postgres] Updated ${result.rowCount} rows on key ${key}`);
      }

      await pgConn.query('COMMIT');
      await safeRefreshKey(key);
      return result;
    } catch (err) {
      try { await pgConn?.query('ROLLBACK'); } catch {}
      console.warn(`${getLongTime()}⚠️ [Postgres] Update failed for key [${key}], falling back to MySQL:`, err.message);
      // fall through to MySQL
    } finally {
      pgConn?.release?.();
    }
  }

  // 2️⃣ MySQL fallback (transactional)
  if (!mysqlQuery) {
    throw new Error(`❌ No MySQL fallback query provided for key [${key}] and Postgres unavailable/omitted`);
  }

  const connection = await getConnection();
  if (!connection) throw new Error('❌ MySQL connection failed');

  try {
    console.log(`${getLongTime()}📥 [MySQL] Updating key: [${key}]`, mysqlQuery);

    await connection.beginTransaction();
    const result = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values ?? []);

    if (result.affectedRows === 0) {
      console.warn(`${getLongTime()}⚠️ [MySQL] No rows updated for key: [${key}]`);
    } else {
      console.log(`${getLongTime()}✅ [MySQL] Updated ${result.affectedRows} rows on key ${key}`);
    }

    await connection.commit();
    await safeRefreshKey(key);
    return result;
  } catch (err) {
    await connection.rollback();
    console.error(`${getLongTime()}❌ [MySQL] Update failed for key [${key}]:`, err.message);
    throw new Error(`${getLongTime()}❌ Update failed for [${key}]: ${err.message}`);
  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 [MySQL] Connection released after update: [${key}]`);
  }
};

// ---------------------------------------------------------------------------
// 🔧 Reusable: DELETE — Postgres first, MySQL fallback, then cache invalidate
// ---------------------------------------------------------------------------
const removeCachedAndQuery = async (key, { pgQuery, mysqlQuery } = {}) => {
  // 1️⃣ Try Postgres
  if (pgQuery) {
    let pgConn;
    try {
      pgConn = await getPgConnection();
      if (!pgConn) throw new Error('Postgres connection unavailable');

      console.log(`${getLongTime()}🗑️ [Postgres] Deleting for key [${key}]`);
      const result = await pgConn.query(pgQuery.text, pgQuery.values ?? []);

      console.log(`${getLongTime()}✅ [Postgres] Delete result on key ${key}:`, result.rowCount);
      await cacheDelete(key);
      await safeRefreshKey(key);
      return result;
    } catch (err) {
      console.warn(`${getLongTime()}⚠️ [Postgres] Delete failed for key [${key}], falling back to MySQL:`, err.message);
      // fall through to MySQL
    } finally {
      pgConn?.release?.();
    }
  }

  // 2️⃣ MySQL fallback
  if (!mysqlQuery) {
    throw new Error(`❌ No MySQL fallback query provided for key [${key}] and Postgres unavailable/omitted`);
  }

  const connection = await getConnection();
  if (!connection) throw new Error('❌ MySQL connection failed');

  try {
    console.log(`${getLongTime()}🗑️ [MySQL] Deleting for key [${key}]`);
    const result = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values ?? []);

    await connection.commit();
    console.log(`${getLongTime()}✅ [MySQL] Delete result on key ${key}:`, result);
    await cacheDelete(key);
    await safeRefreshKey(key);
    return result;
  } catch (err) {
    await connection.rollback();
    console.error(`${getLongTime()}❌ [MySQL] Delete failed for [${key}]:`, err.message);
    throw new Error(`${getLongTime()}❌ Delete failed for [${key}]: ${err.message}`);
  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 [MySQL] Connection released after delete: [${key}]`);
  }
};

const removeCachedAndQueryById = async (key, productId) => {
  const mysqlDeleteQuery = `DELETE FROM ${key} WHERE productId = ?`;
  const pgDeleteQuery = `DELETE FROM ${key} WHERE "productId" = $1`;

  return removeCachedAndQuery(key, {
    pgQuery: { text: pgDeleteQuery, values: [productId] },
    mysqlQuery: { text: mysqlDeleteQuery, values: [productId] },
  });
};

// ---------------------------------------------------------------------------
// 🔁 Retry logic for primary key collision (MySQL-specific, unchanged)
// ---------------------------------------------------------------------------
const insertWithIncrementRetry = async (
  mysqlInsertQuery,
  values = [],
  connection,
  conflictIndex = 0,
  imageUrlIndex = null,
  maxRetries = 5
) => {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const result = await connection.query(mysqlInsertQuery, values);
      console.log(`${getLongTime()}✅ Insert successful after ${retries} retries`);
      return result;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        const currentId = parseInt(values[conflictIndex], 10);
        values[conflictIndex] = currentId + 1;
        if (imageUrlIndex !== null) {
          values[imageUrlIndex] = incrementImageUrl(values[imageUrlIndex]);
        }
        console.warn(`⚠️ Duplicate key. Retrying with new ID: ${values[conflictIndex]}`);
        retries++;
      } else {
        throw err;
      }
    }
  }

  throw new Error(`${getLongTime()} ❌ Max retries (${maxRetries}) reached. Insert failed.`);
};

// 🧠 Helper
function incrementImageUrl(url) {
  const match = url.match(/(\D*)(\d+)(\.\w+)$/);
  if (!match) return url;
  const base = match[1], number = parseInt(match[2]), ext = match[3];
  return `${base}${number + 1}${ext}`;
}

// 🧱 Export the module
export default {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery,
  insertWithIncrementRetry,
  removeCachedAndQueryById,
};