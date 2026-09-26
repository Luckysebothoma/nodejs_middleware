// ControllerHandler.js
//
// Tiered data access: Redis (cache) -> Postgres (primary) -> MySQL (legacy fallback).
// Reads check Redis first, then Postgres, then MySQL, and backfill the cache
// with whichever tier answered. Writes go to Postgres first, fall back to
// MySQL on Postgres failure, and INVALIDATE the cache key afterward (rather
// than just refreshing its TTL) so the next read is forced to go back to the
// database and pick up the new value.
//
// -----------------------------------------------------------------------
// 🔧 CHANGES FROM PREVIOUS VERSION (data-sync fix)
// -----------------------------------------------------------------------
// 1. safeRefreshKey(key) after INSERT/UPDATE/DELETE has been replaced with
//    cacheDelete(key) ("invalidate-on-write"). `refreshKey` only extends the
//    TTL of whatever value is *already* sitting in Redis — it does not
//    overwrite it. If a prior read had cached an empty/stale result (e.g.
//    `[]` because the row didn't exist yet), refreshKey was just re-arming
//    that stale `[]` for another full TTL_SECONDS (~83 hours) every time a
//    write happened, so reads never saw the new data. Deleting the key
//    forces the next read to miss, hit Postgres/MySQL, and repopulate the
//    cache with the current value.
//
// 2. Writes now ALSO invalidate the key BEFORE attempting the write, not
//    just after. This shrinks (does not eliminate — see note below) the
//    classic cache-aside race: read A misses -> read A queries DB (old
//    value) -> write B commits + invalidates -> read A finishes and writes
//    the old value back into the cache -> cache is stale until the next
//    write. Invalidating both before and after a write ("double delete")
//    reduces the odds of that interleaving landing badly. It is not a full
//    guarantee — for strict correctness you'd want a per-key version stamp
//    or a short lock — but for this workload it's a large improvement over
//    a single post-write TTL refresh.
//
// 3. Negative/empty results (`[]`) are now cached with a much shorter TTL
//    (NEGATIVE_CACHE_TTL_SECONDS) than real rows. That way even if an
//    invalidation is ever missed for some reason, a false "not found" self
//    corrects quickly instead of sticking around for ~83 hours.
//
// 4. Removed `return res.status(500).json(...)` from catch blocks around
//    "get MySQL connection" failures. `res` was never passed into this
//    module (it's a data layer, not a request handler), so that line threw
//    `ReferenceError: res is not defined` and masked the real DB error.
//    These now just rethrow so the caller (the actual route handler, which
//    does have `res`) can decide how to respond.
//
// ASSUMPTION: when you add a Postgres client module at ../config/pgClient.js
// exporting `getConnection()`, it should return a pooled client shaped like
// the standard `pg` Pool client: { query(text, params) => Promise<{ rows, rowCount }>, release() }.
// If your actual module differs (different export name, different query
// signature, etc.), update the dynamic import below to match. Until that
// file exists, the Postgres tier is skipped automatically and every call
// falls through to MySQL — see getConnection() below.

import { getConnection } from '../config/db.js';
import TimeUtils from './Time.js';
const { getLongTime } = TimeUtils; 
import { logRequestDetails, logResponseDetails } from './requestLogger.js';
import redisClient from '../config/redisClient.js';

const { connectRedis, cacheSet, cacheGet, cacheDelete, cacheExists, refreshKey, safeInvalidateKey, safeCacheSet, tryGetFromCache } = redisClient;

// 📌 TTL for cache entries (seconds) — real, non-empty results
const TTL_SECONDS = 30000 * 10; // ~83 hours

// 📌 TTL for cached "not found" / empty results (seconds).
// Kept short on purpose: this is a safety net in case an invalidation is
// ever missed, NOT the primary sync mechanism (that's invalidate-on-write
// below). Tune to taste.
const NEGATIVE_CACHE_TTL_SECONDS = 30;



// ---------------------------------------------------------------------------
// 🔧 Reusable: SELECT — Redis -> Postgres -> MySQL
// ---------------------------------------------------------------------------
// pgQuery / mysqlQuery are { text, values } shaped query specs. Either can be
// omitted if that tier doesn't apply to a given call site (e.g. still MySQL-only).
//
// IMPORTANT (sync fix): an empty result from Postgres is NOT treated as a
// final answer when a mysqlQuery was provided — it falls through to MySQL,
// since Postgres may simply not have that row yet (not-yet-migrated legacy
// data). Only when no mysqlQuery is given, or MySQL is also empty, do we
// cache/return an empty result.
//
// When MySQL ends up answering, we respond to the caller immediately with
// its rows and only AFTER that update Redis and (optionally) backfill
// Postgres in the background, via `pgBackfillQuery` — see backfillPostgres().




// Keys currently being backfilled. Stops a burst of concurrent cache misses
// on the same key from launching duplicate backfills.
const backfillInFlight = new Set();

// ---------------------------------------------------------------------------
// 🔧 Background: copy MySQL rows into Postgres (best-effort, never throws)
// ---------------------------------------------------------------------------
// pgBackfillQuery is a function: (row) => ({ text, values }). It builds one
// idempotent upsert per row, e.g. INSERT ... ON CONFLICT (...) DO NOTHING.
// All rows go in one transaction, so a key is backfilled fully or not at all.
const backfillPostgres = async (key, rows, pgBackfillQuery) => {
  if (typeof pgBackfillQuery !== 'function') {
    console.log(`${getLongTime()}⏭️ [Postgres] No backfill query for key [${key}], skipping`);
    return { skipped: true };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { written: 0 };

  if (backfillInFlight.has(key)) {
    console.log(`${getLongTime()}⏭️ [Postgres] Backfill already running for key [${key}], skipping`);
    return { skipped: true };
  }
  backfillInFlight.add(key);

  let pgConn;
  try {
    pgConn = await getConnection();
    if (!pgConn) throw new Error('Postgres connection unavailable');

    console.log(`${getLongTime()}🔄 [Postgres] Backfilling ${rows.length} rows for key [${key}]`);

    await pgConn.query('BEGIN');
    let written = 0;
    for (const row of rows) {
      const spec = pgBackfillQuery(row);
      if (!spec?.text) continue;
      const result = await pgConn.query(spec.text, spec.values ?? []);
      written += result.rowCount ?? 0; // 0 when ON CONFLICT DO NOTHING skipped it
    }
    await pgConn.query('COMMIT');

    console.log(`${getLongTime()}✅ [Postgres] Backfill done for key [${key}]: ${written}/${rows.length} rows written`);
    return { written };
  } catch (err) {
    try { await pgConn?.query('ROLLBACK'); } catch {}
    console.warn(`${getLongTime()}⚠️ [Postgres] Backfill failed for key [${key}]:`, err.message);
    return { error: err.message };
  } finally {
    pgConn?.release?.();
    backfillInFlight.delete(key);
  }
};


const getCachedOrQuery = async (key, { pgQuery, mysqlQuery, pgBackfillQuery } = {}) => {
  // 1️⃣ Redis
  const cached = await tryGetFromCache(key);
  if (cached !== null) {
    console.log(`${getLongTime()}✅ Cache HIT for key [${key}]`);
    return cached;
  }
  console.log(`${getLongTime()}❌ Cache MISS for key [${key}]`);

  // 2️⃣ Postgres
  let pgRows = null; // null = not consulted / errored, [] = consulted and empty
  if (pgQuery) {
    let pgConn;
    try {
      pgConn = await getConnection();
      if (!pgConn) throw new Error('Postgres connection unavailable');

      console.log(`${getLongTime()}🔍 [Postgres] Executing SELECT for key [${key}]`);
      const { rows } = await pgConn.query(pgQuery.text, pgQuery.values ?? []);
      pgRows = rows ?? [];

      if (pgRows.length > 0) {
        console.log(`${getLongTime()}✅ [Postgres] SELECT success: ${pgRows.length} rows on key ${key}`);
        await safeCacheSet(key, pgRows);
        return pgRows;
      }

      console.warn(`${getLongTime()}⚠️ [Postgres] Empty result for key: [${key}]${mysqlQuery ? ', checking MySQL before giving up' : ''}`);
      // don't cache/return yet — fall through to MySQL below when available
    } catch (err) {
      pgRows = null; // treat as "not consulted" so the no-mysqlQuery branch below rethrows correctly
      console.warn(`${getLongTime()}⚠️ [Postgres] SELECT failed for key [${key}], falling back to MySQL:`, err.message);
      // fall through to MySQL
    } finally {
      pgConn?.release?.();
    }
  }

  // 3️⃣ MySQL (legacy fallback / still-authoritative source for unmigrated rows)
  if (!mysqlQuery) {
    if (pgQuery && pgRows !== null) {
      // Postgres was consulted, came back empty, and there's nowhere else to check.
      await safeCacheSet(key, pgRows);
      return pgRows;
    }
    throw new Error(`❌ No MySQL fallback query provided for key [${key}] and Postgres unavailable/omitted`);
  }

  let connection;
  try {
    connection = await getConnection();
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

      // Respond immediately — do NOT make the caller wait on Redis/Postgres sync.
      // Background: update Redis first, then backfill Postgres, in that order.
      (async () => {
        await safeCacheSet(key, rows);
        await backfillPostgres(key, rows, pgBackfillQuery);
      })().catch((err) => {
        console.warn(`${getLongTime()}⚠️ Background Redis/Postgres sync failed for key [${key}]:`, err.message);
      });

      return rows;
    } catch (err) {
      console.error(`${getLongTime()}❌ [MySQL] SELECT failed on key ${key}:`, err.message);
      throw new Error(`❌ SELECT failed on key ${key}: ${err.message}`);

    } finally {
      connection.release();
      console.log(`${getLongTime()}🔚 [MySQL] Connection released for key: [${key}]`);
    }
  } catch (err) {
    console.error('🔥 Error getting MySQL connection:', err);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// 🔧 Reusable: INSERT — Postgres first, MySQL fallback, then cache invalidate
// ---------------------------------------------------------------------------
const addCachedAndQuery = async (key, { pgQuery, mysqlQuery } = {}) => {
  if (!key || (!pgQuery && !mysqlQuery)) {
    console.log(`Missing or invalid input(s):`, { key, pgQuery, mysqlQuery });
    throw new Error(`❌ Invalid input to addCachedAndQuery on key ${key}`);
  }

  // Invalidate up front too ("double delete"): shrinks the window in which a
  // concurrent in-flight read could re-populate the cache with pre-write data
  // between this write committing and its post-write invalidation below.
  await safeInvalidateKey(key);

  // 1️⃣ Try Postgres
  if (pgQuery) {
    let pgConn;
    try {
      pgConn = await getConnection();
      if (!pgConn) throw new Error('Postgres connection unavailable');

      console.log(`${getLongTime()}📥 [Postgres] INSERTING key: [${key}]`, pgQuery);
      const result = await pgConn.query(pgQuery.text, pgQuery.values ?? []);

      console.log(`${getLongTime()}✅ [Postgres] INSERT successful on key ${key}`);
      await safeInvalidateKey(key);
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

  let connection;
  try {
    connection = await getConnection();
    if (!connection) throw new Error('❌ MySQL connection failed');

    try {
      console.log(`${getLongTime()}📥 [MySQL] INSERTING key: [${key}]`, mysqlQuery);
      const [result] = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values ?? []);

      console.log(`${getLongTime()}✅ [MySQL] INSERT successful on key ${key}`);
      await safeInvalidateKey(key);
      return result;
    } catch (err) {
      console.error(`${getLongTime()}❌ [MySQL] INSERT failed for key [${key}]:`, err.message);
      throw new Error(`${getLongTime()}❌ INSERT failed for key [${key}]: ${err.message}`);
    } finally {
      connection.release();
      console.log(`${getLongTime()}🔚 [MySQL] Connection released after insert: [${key}]`);
    }
  } catch (err) {
    console.error('🔥 Error getting MySQL connection:', err);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// 🔧 Reusable: UPDATE — Postgres first, MySQL fallback, then cache invalidate
// ---------------------------------------------------------------------------
const updateCachedOrQuery = async (key, { pgQuery, mysqlQuery } = {}) => {
  await safeInvalidateKey(key); // pre-write invalidate, see addCachedAndQuery note

  // 1️⃣ Try Postgres (transactional)
  if (pgQuery) {
    let pgConn;
    try {
      pgConn = await getConnection();
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
      await safeInvalidateKey(key);
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

  let connection;
  try {
    connection = await getConnection();
    if (!connection) throw new Error('❌ MySQL connection failed');

    try {
      console.log(`${getLongTime()}📥 [MySQL] Updating key: [${key}]`, mysqlQuery);

      await connection.beginTransaction();
      const [result] = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values ?? []);

      if (result.affectedRows === 0) {
        console.warn(`${getLongTime()}⚠️ [MySQL] No rows updated for key: [${key}]`);
      } else {
        console.log(`${getLongTime()}✅ [MySQL] Updated ${result.affectedRows} rows on key ${key}`);
      }

      await connection.commit();
      await safeInvalidateKey(key);
      return result;
    } catch (err) {
      await connection.rollback();
      console.error(`${getLongTime()}❌ [MySQL] Update failed for key [${key}]:`, err.message);
      throw new Error(`${getLongTime()}❌ Update failed for [${key}]: ${err.message}`);
    } finally {
      connection.release();
      console.log(`${getLongTime()}🔚 [MySQL] Connection released after update: [${key}]`);
    }
  } catch (err) {
    console.error('🔥 Error getting MySQL connection:', err);
    throw err;
  }
};

// ---------------------------------------------------------------------------
// 🔧 Reusable: DELETE — Postgres first, MySQL fallback, then cache invalidate
// ---------------------------------------------------------------------------
const removeCachedAndQuery = async (
  key,
  { pgQuery, mysqlQuery } = {}
) => {
  await safeInvalidateKey(key);

  // 1️⃣ Try Postgres
  if (pgQuery) {
    let pgConn;

    try {
      pgConn = await getConnection();

      if (!pgConn) {
        throw new Error('Postgres connection unavailable');
      }

      console.log(
        `${getLongTime()}🗑️ [Postgres] Deleting for key [${key}]`
      );

      const result = await pgConn.query(
        pgQuery.text,
        pgQuery.values ?? []
      );

      console.log(
        `${getLongTime()}✅ [Postgres] Delete result on key ${key}:`,
        result.rowCount
      );

      await safeInvalidateKey(key);

      return result;

    } catch (err) {
      console.warn(
        `${getLongTime()}⚠️ [Postgres] Delete failed for key [${key}], falling back to MySQL:`,
        err.message
      );

    } finally {
      pgConn?.release?.();
    }
  }

  // 2️⃣ MySQL fallback
  if (!mysqlQuery) {
    throw new Error(
      `❌ No MySQL fallback query provided for key [${key}]`
    );
  }

  let connection;

  try {
    connection = await getConnection();

    if (!connection) {
      throw new Error('MySQL connection unavailable');
    }

    console.log(
      `${getLongTime()}🗑️ [MySQL] Deleting for key [${key}]`
    );

    const [result] = await connection.query(
      mysqlQuery.text ?? mysqlQuery,
      mysqlQuery.values ?? []
    );

    console.log(
      `${getLongTime()}✅ [MySQL] Delete result on key ${key}:`,
      result
    );

    await safeInvalidateKey(key);

    return result;

  } catch (err) {

    console.error(
      `${getLongTime()}❌ [MySQL] Delete failed for [${key}]:`,
      err.message
    );

    throw err;

  } finally {

    if (connection) {
      connection.release();

      console.log(
        `${getLongTime()}🔚 [MySQL] Connection released after delete: [${key}]`
      );
    }
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