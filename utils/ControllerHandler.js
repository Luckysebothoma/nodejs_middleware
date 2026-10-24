// ControllerHandler.js
//
// Tiered, SELF-HEALING data access:  Redis (cache)  <->  Postgres  <->  MySQL
//
// READS   Redis first. On a miss BOTH databases are queried in parallel and the fuller answer is
//         returned immediately. In the background, anything one tier has and another lacks is copied
//         across (Redis -> DBs, MySQL -> Postgres, Postgres -> MySQL) and Redis is refreshed.
//         A cache HIT is returned instantly too, and (throttled, in the background) the databases are
//         checked against it, so rows that only survive in Redis are restored into both databases.
// WRITES  Run on BOTH databases (MySQL result is returned to callers, as before). One DB failing does not
//         fail the request as long as the other succeeded. The cache key is invalidated before AND after.
// SYNC    Row identity = primary key (read from the live schema). Copies are idempotent
//         (Postgres ON CONFLICT DO NOTHING / MySQL INSERT IGNORE), skip generated columns, convert dates,
//         fix Postgres sequences afterwards, and always sync productList first (parent of the FKs).
//
// Tunables (env):  PG_TIER_ENABLED=false  -> MySQL only (old behaviour)
//                  DB_SYNC=off            -> no replication, only the tiered reads/writes
//                  DB_SYNC_ON_START=false -> skip the one-off reconcile of all tables ~10s after boot
//                  DB_SYNC_INTERVAL_MS    -> min gap between cache-hit reconciles per key (default 300000)
//                  SYNC_RESTORE_FROM_CACHE=false -> never copy rows that exist only in Redis
//
// Known limits (by design, insert-only replication): rows deleted/updated while ONE database was down are
// not re-applied to it. A divergence is logged as "DIVERGED". Tables with auto ids that are not supplied
// by the app (cartList, stockedItems) may get different ids in each database when written in dual mode.

import { getConnection as getMysqlConnection } from '../config/db.js';
import TimeUtils from './Time.js';
const { getLongTime } = TimeUtils;
import { logRequestDetails, logResponseDetails } from './requestLogger.js';
import redisClient from '../config/redisClient.js';

const { connectRedis, cacheSet, cacheGet, cacheDelete, cacheExists, refreshKey, safeInvalidateKey, safeCacheSet, tryGetFromCache } = redisClient;

const TTL_SECONDS = 30000 * 10; // ~83 hours (cache TTL is applied inside redisClient)

const PG_TIER_ENABLED = process.env.PG_TIER_ENABLED !== 'false';
const SYNC_ENABLED = process.env.DB_SYNC !== 'off';
const SYNC_ON_START = process.env.DB_SYNC_ON_START !== 'false';
const RESTORE_FROM_CACHE = process.env.SYNC_RESTORE_FROM_CACHE !== 'false';
const RECONCILE_INTERVAL_MS = Number(process.env.DB_SYNC_INTERVAL_MS) || 5 * 60 * 1000;

// Parent first. productList is the FK parent of every per-product table.
const SYNC_TABLES = ['productList', 'productPricing', 'availableItems', 'priceTracing', 'estimates', 'sodEodItems',
  'productItemPricing', 'cartList', 'stockItems', 'stockedItems', 'daily_financials'];
const NO_PARENT = new Set(['productList', 'app_settings', 'daily_financials']);

const isTableName = (k) => typeof k === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k);
const queryText = (q) => (typeof q === 'string' ? q : q?.text ?? '');
const isPlainSelect = (q, key) =>
  new RegExp(`^\\s*select\\s+\\*\\s+from\\s+["\`]?${key}["\`]?\\s*;?\\s*$`, 'i').test(queryText(q));

const warn = (...a) => console.warn(...a);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const pad = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------
// The Postgres module is loaded lazily so a missing/renamed export can never crash this file.
let pgConnector = null;
let pgLoadFailedAt = 0;
const loadPgConnector = async () => {
  if (pgConnector) return pgConnector;
  if (Date.now() - pgLoadFailedAt < 30000) return null;
  try {
    const mod = await import('../config/postgres.js');
    const d = mod.default;
    const pool = d?.pgClient ?? d?.pool ?? mod.pgClient ?? mod.pool ?? d ?? mod;
    if (typeof mod.getConnection === 'function') pgConnector = () => mod.getConnection();
    else if (typeof d?.getConnection === 'function') pgConnector = () => d.getConnection();
    else if (typeof pool?.connect === 'function') pgConnector = () => pool.connect();
    else if (typeof pool?.query === 'function') pgConnector = async () => ({ query: (...a) => pool.query(...a), release() {} });
    else throw new Error('../config/postgres.js exports no connect()/getConnection()/query()');
    return pgConnector;
  } catch (err) {
    pgLoadFailedAt = Date.now();
    warn(`${getLongTime()}⚠️ [Postgres] client unavailable (${err.message}); running MySQL-only until it loads`);
    return null;
  }
};

const withMysql = async (fn) => {
  const conn = await getMysqlConnection();
  if (!conn) throw new Error('MySQL connection failed');
  try { return await fn(conn); } finally { conn.release?.(); }
};

const withPg = async (fn) => {
  if (!PG_TIER_ENABLED) throw new Error('Postgres tier disabled');
  const connect = await loadPgConnector();
  if (!connect) throw new Error('Postgres client unavailable');
  const conn = await connect();
  if (!conn) throw new Error('Postgres connection unavailable');
  try { return await fn(conn); } finally { conn.release?.(); }
};

// ---------------------------------------------------------------------------
// Schema introspection (columns, generated columns, primary key) - cached per engine+table
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Schema introspection (columns, generated columns, primary key) - cached per engine+table
// ---------------------------------------------------------------------------
const metaCache = new Map();

const getMeta = async (engine, table) => {
  const ck = `${engine}:${table}`;
  if (metaCache.has(ck)) return metaCache.get(ck);
  let meta;

  if (engine === 'postgres') {
    meta = await withPg(async (c) => {
      const cols = await c.query(
        `SELECT column_name AS name,
                (is_generated = 'ALWAYS' OR identity_generation = 'ALWAYS') AS is_gen
           FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1
          ORDER BY ordinal_position`, [table.toLowerCase()]);
      const pk = await c.query(
        `SELECT a.attname AS name FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = to_regclass($1) AND i.indisprimary`, [table.toLowerCase()]);
      return {
        tableName: table,
        columns: cols.rows.map(r => ({ name: r.name, generated: !!r.is_gen })),
        pk: pk.rows.map(r => r.name),
      };
    });
  } else {
    meta = await withMysql(async (c) => {
      try {
        const [tableCheck] = await c.query(
          `SELECT TABLE_NAME AS tname FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?)`, [table]);
        const actualTableName = tableCheck[0]?.tname ?? tableCheck[0]?.TABLE_NAME ?? table;

        const [cols] = await c.query(
          `SELECT COLUMN_NAME AS name, EXTRA AS extra, GENERATION_EXPRESSION AS genexpr
             FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION`, [actualTableName]);

        const [pk] = await c.query(
          `SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'
            ORDER BY SEQ_IN_INDEX`, [actualTableName]);

        return {
          tableName: actualTableName,
          columns: cols.map(r => {
            const extra = String(r.extra ?? r.EXTRA ?? '');
            const expr = String(r.genexpr ?? r.GENERATION_EXPRESSION ?? '').trim();
            return {
              name: r.name ?? r.COLUMN_NAME,
              // VIRTUAL/STORED GENERATED only; DEFAULT_GENERATED is a normal writable column
              generated: /(VIRTUAL|STORED) GENERATED/i.test(extra) || !!expr,
            };
          }),
          pk: pk.map(r => r.name ?? r.COLUMN_NAME),
        };
      } catch (err) {
        warn(`${getLongTime()}⚠️ [MySQL] Failed to get meta for table [${table}]: ${err.message}`);
        return { tableName: table, columns: [], pk: [] };
      }
    });
  }

  if (meta.columns.length) metaCache.set(ck, meta);
  return meta;
};

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------
const pick = (row, name) => {
  if (name in row) return row[name];
  const k = Object.keys(row).find(x => x.toLowerCase() === name.toLowerCase());
  return k === undefined ? undefined : row[k];
};

// Identity part: dates/ISO strings -> local YYYY-MM-DD so a DATE read from a DB and the same value
// that went through Redis (JSON) compare equal.
const normId = (v) => {
  if (v === null || v === undefined) return '';
  let d = null;
  if (v instanceof Date) d = v;
  else if (typeof v === 'string' && ISO_RE.test(v)) d = new Date(v);
  if (d && !Number.isNaN(d.getTime())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return String(v);
};
const rowId = (row, pk) => pk.length
  ? pk.map(c => normId(pick(row, c))).join('|')
  : JSON.stringify(Object.keys(row).sort().map(k => [k, normId(row[k])]));

const prep = (v) => {
  if (v === undefined) return null;
  if (typeof v === 'string' && ISO_RE.test(v)) return new Date(v); // came back from Redis as JSON
  if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) return JSON.stringify(v);
  return v;
};

const mapRow = (row, meta) => {
  const byLower = new Map(meta.columns.filter(c => !c.generated).map(c => [c.name.toLowerCase(), c.name]));
  const cols = [], vals = [];
  for (const [k, v] of Object.entries(row)) {
    const target = byLower.get(k.toLowerCase());
    if (!target) continue; // unknown or generated column
    cols.push(target); vals.push(prep(v));
  }
  return { cols, vals };
};

// ---------------------------------------------------------------------------
// Copy missing rows into one engine (idempotent, never throws for a single bad row)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Copy missing rows into one engine (idempotent, never throws for a single bad row)
// ---------------------------------------------------------------------------
const insertMissingRows = async (engine, table, rows) => {
  if (!rows.length) return { written: 0, failed: 0 };
  const meta = await getMeta(engine, table);
  if (!meta.columns.length) throw new Error(`table ${table} not found in ${engine}`);
  let written = 0, failed = 0, lastError = null;

  const run = async (conn) => {
    for (const row of rows) {
      const { cols, vals } = mapRow(row, meta);
      if (!cols.length) continue;
      try {
        if (engine === 'postgres') {
          const r = await conn.query(
            `INSERT INTO ${meta.tableName} (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT DO NOTHING`, vals);
          written += r.rowCount ?? 0;
        } else {
          // MySQL branch inside run()
          const [r] = await conn.query(
          `INSERT IGNORE INTO \`${meta.tableName ?? table}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
          written += r.affectedRows ?? 0;
        }
      } catch (err) { failed++; lastError = err.message; }
    }
  };

  if (engine === 'postgres') {
    await withPg(async (conn) => {
      await run(conn);
      // explicit ids bypass the sequence: move it past the highest id so later inserts do not collide
      for (const col of meta.pk) {
        try {
          const { rows: s } = await conn.query('SELECT pg_get_serial_sequence($1, $2) AS seq', [table.toLowerCase(), col]);
          if (s[0]?.seq) await conn.query(`SELECT setval('${s[0].seq}', (SELECT COALESCE(MAX("${col}"), 1) FROM ${meta.tableName}))`);
        } catch { /* not a serial/identity column */ }
      }
    });
  } else {
    await withMysql(run);
  }
  return { written, failed, lastError };
};

// ---------------------------------------------------------------------------
// Reconcile one table across Redis / Postgres / MySQL
// ---------------------------------------------------------------------------
const inFlight = new Map();
const lastRun = new Map();

const doReconcile = async (key, { preloaded = {} } = {}) => {
  if (!NO_PARENT.has(key)) await reconcileTable('productList'); // FK parent first (shared promise if already running)

  const load = async (engine) => {
    try {
      if (engine === 'postgres') return (await withPg(c => c.query(`SELECT * FROM ${key}`))).rows;
      return (await withMysql(c => c.query(`SELECT * FROM ${key}`)))[0];
    } catch (err) {
      warn(`${getLongTime()}⚠️ [Sync] cannot read ${engine}.${key}: ${err.message}`);
      return null; // null = unavailable (never treated as "empty")
    }
  };

  const pgRows = preloaded.postgres !== undefined ? preloaded.postgres : (PG_TIER_ENABLED ? await load('postgres') : null);
  const myRows = preloaded.mysql !== undefined ? preloaded.mysql : await load('mysql');
  let cacheRows = preloaded.redis !== undefined ? preloaded.redis : await tryGetFromCache(key);
  if (!Array.isArray(cacheRows)) cacheRows = null;

  if (pgRows === null && myRows === null) return { skipped: 'no database reachable' };

  let pk = [];
  try { pk = (await getMeta(pgRows !== null ? 'postgres' : 'mysql', key)).pk; } catch { /* fall back to full-row identity */ }

  const sets = {
    postgres: pgRows && new Set(pgRows.map(r => rowId(r, pk))),
    mysql: myRows && new Set(myRows.map(r => rowId(r, pk)))
  };

  // union, first source wins: postgres > mysql > redis
  const union = new Map();
  const add = (rows, from) => { for (const r of rows ?? []) { const id = rowId(r, pk); if (!union.has(id)) union.set(id, { row: r, from }); } };
  add(pgRows, 'postgres');
  add(myRows, 'mysql');
  if (RESTORE_FROM_CACHE) add(cacheRows, 'redis');

  const summary = { key, rows: union.size };
  for (const engine of ['postgres', 'mysql']) {
    const have = sets[engine];
    if (!have) continue;
    const missing = [...union.entries()].filter(([id]) => !have.has(id));
    if (!missing.length) continue;
    const fromList = [...new Set(missing.map(([, v]) => v.from))].join('+');
    try {
      const r = await insertMissingRows(engine, key, missing.map(([, v]) => v.row));
      summary[engine] = { missing: missing.length, written: r.written, failed: r.failed };
      console.log(`${getLongTime()}🔄 [Sync] ${key}: ${missing.length} row(s) missing in ${engine} (from ${fromList}) -> wrote ${r.written}${r.failed ? `, ${r.failed} failed (${r.lastError})` : ''}`);
    } catch (err) {
      summary[engine] = { error: err.message };
      warn(`${getLongTime()}⚠️ [Sync] ${key}: copy into ${engine} failed: ${err.message}`);
    }
  }

  // Redis: refresh when it is missing rows, or drop it if it holds rows no database has (restore disabled)
  const unionRows = [...union.values()].map(v => v.row);
  const cacheIds = new Set((cacheRows ?? []).map(r => rowId(r, pk)));
  if (unionRows.length && (cacheRows === null || [...union.keys()].some(id => !cacheIds.has(id)))) {
    await safeCacheSet(key, unionRows);
    summary.redis = 'refreshed';
  } else if (cacheRows && !RESTORE_FROM_CACHE && cacheRows.some(r => !union.has(rowId(r, pk)))) {
    await safeInvalidateKey(key);
    summary.redis = 'invalidated (stale rows)';
  }
  return summary;
};

const reconcileTable = (key, opts = {}) => {
  if (!SYNC_ENABLED || !isTableName(key)) return Promise.resolve({ skipped: 'disabled' });
  if (inFlight.has(key)) return inFlight.get(key);
  if (!opts.force && Date.now() - (lastRun.get(key) ?? 0) < RECONCILE_INTERVAL_MS) return Promise.resolve({ skipped: 'throttled' });
  lastRun.set(key, Date.now());
  const p = doReconcile(key, opts)
    .catch((err) => { warn(`${getLongTime()}⚠️ [Sync] reconcile failed for [${key}]: ${err.message}`); return { error: err.message }; })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
};

/** Reconcile many tables in FK order (parent first). Safe to call at startup or from an admin route. */
const reconcileAll = async (keys = SYNC_TABLES) => {
  const out = {};
  for (const k of keys) out[k] = await reconcileTable(k, { force: true });
  return out;
};

const reconcileSoon = (key, opts) => { reconcileTable(key, opts).catch(() => {}); };

if (SYNC_ENABLED && SYNC_ON_START) {
  const t = setTimeout(() => {
    reconcileAll().then(r => console.log(`${getLongTime()}✅ [Sync] startup reconcile finished`, JSON.stringify(r)))
      .catch(err => warn(`${getLongTime()}⚠️ [Sync] startup reconcile failed: ${err.message}`));
  }, 10000);
  t.unref?.();
}

// Legacy per-call backfill hook (for non-"SELECT *" queries): pgBackfillQuery(row) => { text, values }
const backfillInFlight = new Set();
const backfillPostgres = async (key, rows, pgBackfillQuery) => {
  if (typeof pgBackfillQuery !== 'function' || !Array.isArray(rows) || !rows.length) return { skipped: true };
  if (backfillInFlight.has(key)) return { skipped: true };
  backfillInFlight.add(key);
  try {
    return await withPg(async (pgConn) => {
      let written = 0;
      for (const row of rows) {
        const spec = pgBackfillQuery(row);
        if (!spec?.text) continue;
        try { written += (await pgConn.query(spec.text, spec.values ?? [])).rowCount ?? 0; }
        catch (err) { warn(`${getLongTime()}⚠️ [Postgres] backfill row failed for [${key}]: ${err.message}`); }
      }
      return { written };
    });
  } catch (err) {
    warn(`${getLongTime()}⚠️ [Postgres] Backfill failed for key [${key}]: ${err.message}`);
    return { error: err.message };
  } finally { backfillInFlight.delete(key); }
};

// ---------------------------------------------------------------------------
// READ: Redis -> (Postgres || MySQL in parallel) -> sync everything
// ---------------------------------------------------------------------------
const getCachedOrQuery = async (key, { pgQuery, mysqlQuery, pgBackfillQuery } = {}) => {
  const syncable = SYNC_ENABLED && isTableName(key) &&
    [pgQuery, mysqlQuery].filter(Boolean).every(q => isPlainSelect(q, key));

  // 1️⃣ Redis. A cached [] is a stale "not found" and is treated as a miss.
  const cached = await tryGetFromCache(key);
  if (cached !== null && !(Array.isArray(cached) && cached.length === 0)) {
    console.log(`${getLongTime()}✅ Cache HIT for key [${key}]`);
    if (syncable) reconcileSoon(key, { preloaded: { redis: cached } }); // throttled, background
    return cached;
  }
  console.log(`${getLongTime()}❌ Cache MISS for key [${key}]${cached !== null ? ' (stale empty entry ignored)' : ''}`);

  if (!pgQuery && !mysqlQuery) throw new Error(`❌ No query provided for key [${key}]`);

  // 2️⃣ Ask both databases at once
  const usePg = !!pgQuery && PG_TIER_ENABLED;
  const [pgRes, myRes] = await Promise.allSettled([
    usePg ? withPg(async (c) => (await c.query(pgQuery.text ?? pgQuery, pgQuery.values ?? [])).rows ?? []) : Promise.resolve(null),
    mysqlQuery ? withMysql(async (c) => (await c.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values))[0] ?? []) : Promise.resolve(null)
  ]);

  const pgRows = pgRes.status === 'fulfilled' ? pgRes.value : null;
  const myRows = myRes.status === 'fulfilled' ? myRes.value : null;
  if (pgRes.status === 'rejected') warn(`${getLongTime()}⚠️ [Postgres] SELECT failed for key [${key}]:`, pgRes.reason?.message);
  if (myRes.status === 'rejected') warn(`${getLongTime()}⚠️ [MySQL] SELECT failed for key [${key}]:`, myRes.reason?.message);

  if (pgRows === null && myRows === null) {
    const reason = myRes.reason ?? pgRes.reason;
    if (reason) throw new Error(`❌ SELECT failed on key ${key}: ${reason.message}`);
    return [];
  }

  const best = (pgRows?.length ?? -1) >= (myRows?.length ?? -1) ? { from: 'Postgres', rows: pgRows ?? [] } : { from: 'MySQL', rows: myRows };
  console.log(`${getLongTime()}✅ [${best.from}] SELECT success: ${best.rows.length} rows on key ${key} (pg=${pgRows?.length ?? 'n/a'}, mysql=${myRows?.length ?? 'n/a'})`);

  // Nothing in either database. Do not cache "empty": a missing row must be found as soon as it appears.
  if (best.rows.length === 0) return [];

  // Respond now; sync Redis + the lagging database(s) in the background.
  (async () => {
    await safeCacheSet(key, best.rows);
    if (syncable) {
      await reconcileTable(key, { force: true, preloaded: { postgres: pgRows, mysql: myRows, redis: best.rows } });
    } else if (best.from === 'MySQL' && usePg && pgRows?.length === 0) {
      await backfillPostgres(key, best.rows, pgBackfillQuery);
    }
  })().catch((err) => warn(`${getLongTime()}⚠️ Background sync failed for key [${key}]:`, err.message));

  return best.rows;
};

// ---------------------------------------------------------------------------
// WRITES: run on both databases, invalidate cache before and after
// ---------------------------------------------------------------------------
const runPgWrite = (q, tx) => withPg(async (c) => {
  if (tx) await c.query('BEGIN');
  try {
    const r = await c.query(q.text, q.values ?? []);
    if (tx) await c.query('COMMIT');
    return r;
  } catch (err) {
    if (tx) { try { await c.query('ROLLBACK'); } catch { /* ignore */ } }
    throw err;
  }
});

const runMysqlWrite = (q, tx) => withMysql(async (c) => {
  if (tx) await c.beginTransaction();
  try {
    const [r] = await c.query(q.text ?? q, q.values ?? []);
    if (tx) await c.commit();
    return r;
  } catch (err) {
    if (tx) { try { await c.rollback(); } catch { /* ignore */ } }
    throw err;
  }
});

const affected = (r) => r?.affectedRows ?? r?.rowCount ?? 0;

const writeBoth = async (key, kind, { pgQuery, mysqlQuery } = {}, { tx = false } = {}) => {
  const usePg = !!pgQuery && PG_TIER_ENABLED;
  if (!mysqlQuery && !usePg) throw new Error(`❌ No query to run for ${kind} on key [${key}]`);

  await safeInvalidateKey(key); // "double delete": before the write...

  console.log(`${getLongTime()}📥 ${kind} on key [${key}]`);
  const [pgRes, myRes] = await Promise.allSettled([
    usePg ? runPgWrite(pgQuery, tx) : Promise.resolve(undefined),
    mysqlQuery ? runMysqlWrite(mysqlQuery, tx) : Promise.resolve(undefined)
  ]);

  const tried = { postgres: usePg, mysql: !!mysqlQuery };
  const ok = { postgres: pgRes.status === 'fulfilled', mysql: myRes.status === 'fulfilled' };
  if (pgRes.status === 'rejected') warn(`${getLongTime()}⚠️ [Postgres] ${kind} failed for key [${key}]:`, pgRes.reason?.message);
  if (myRes.status === 'rejected') console.error(`${getLongTime()}❌ [MySQL] ${kind} failed for key [${key}]:`, myRes.reason?.message);

  const anyOk = (tried.postgres && ok.postgres) || (tried.mysql && ok.mysql);
  if (!anyOk) {
    await safeInvalidateKey(key);
    throw new Error(`${getLongTime()}❌ ${kind} failed for key [${key}]: ${(myRes.reason ?? pgRes.reason)?.message}`);
  }

  await safeInvalidateKey(key); // ...and after

  const failedOne = (tried.postgres && !ok.postgres) || (tried.mysql && !ok.mysql);
  const countMismatch = tried.postgres && tried.mysql && ok.postgres && ok.mysql && affected(pgRes.value) !== affected(myRes.value);
  if (failedOne || countMismatch) {
    warn(`${getLongTime()}⚠️ DIVERGED on key [${key}] after ${kind}: ${failedOne ? 'one database failed' : `rows affected pg=${affected(pgRes.value)} mysql=${affected(myRes.value)}`}`);
    // copy-based repair is only safe when a row may be MISSING on one side (insert / update that matched 0 rows)
    if (kind !== 'DELETE' && isTableName(key)) reconcileSoon(key, { force: true });
  } else {
    console.log(`${getLongTime()}✅ ${kind} successful on key ${key} (${affected(myRes.value) || affected(pgRes.value)} rows)`);
  }

  // callers were written against the MySQL result shape: prefer it
  return ok.mysql && tried.mysql ? myRes.value : pgRes.value;
};

const addCachedAndQuery = async (key, { pgQuery, mysqlQuery } = {}) => {
  if (!key || (!pgQuery && !mysqlQuery)) {
    console.log(`Missing or invalid input(s):`, { key, pgQuery, mysqlQuery });
    throw new Error(`❌ Invalid input to addCachedAndQuery on key ${key}`);
  }
  return writeBoth(key, 'INSERT', { pgQuery, mysqlQuery });
};

const updateCachedOrQuery = async (key, { pgQuery, mysqlQuery } = {}) =>
  writeBoth(key, 'UPDATE', { pgQuery, mysqlQuery }, { tx: true });

const removeCachedAndQuery = async (key, { pgQuery, mysqlQuery } = {}) =>
  writeBoth(key, 'DELETE', { pgQuery, mysqlQuery });

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
  reconcileKey: reconcileTable,
  reconcileAll,
};