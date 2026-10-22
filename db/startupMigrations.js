// db/startupMigrations.js
// Runs once, in the cluster PRIMARY process, before any worker is forked.
//   DB_AUTO_MIGRATE=0        skip everything
//   DB_SCHEMA_STRICT=1       exit(1) if a migration fails or the schema does not match
//   DB_MIGRATE_TIMEOUT_MS    give up waiting (default 60000); the API then starts anyway (unless strict)
//   TOKEN_LOG_RETENTION_DAYS delete token_access_logs older than this (default 90; 0 = keep forever)
import { migrateMysql, migratePostgres, verifySchema } from './migrate.js';

const withTimeout = (promise, ms, label) => {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export async function pruneTokenLogs(pgPool, days, logger = console) {
  if (!days || days <= 0) return 0;
  try {
    const r = await pgPool.query(`DELETE FROM token_access_logs WHERE accessed_at < now() - ($1 || ' days')::interval`, [String(days)]);
    if (r.rowCount) logger.log(`[db-migrate] pruned ${r.rowCount} token_access_logs rows older than ${days} days`);
    return r.rowCount;
  } catch (err) {
    logger.warn(`[db-migrate] token log prune skipped: ${err.message}`);
    return 0;
  }
}

export async function probeConnection(engine, conn) {
  if (engine === 'mysql') {
    const [[row]] = await conn.query('SELECT 1 AS connected, DATABASE() AS `database`');
    return row.database;
  }
  const { rows } = await conn.query('SELECT 1 AS connected, current_database() AS database');
  return rows[0].database;
}

// Best-effort identity of the server this connection actually landed on. Two database containers
// answering to the same network alias (e.g. "mysql-db") can make the API reach the wrong one, which
// then fails with "Access denied ... to database" although the intended server is healthy. Logging
// who answered makes that visible at startup. Never throws.
export async function describeServer(engine, conn) {
  try {
    if (engine === 'mysql') {
      const [[row]] = await conn.query('SELECT @@hostname AS host, @@port AS port, @@version AS version, @@server_uuid AS uuid');
      return `hostname=${row.host} port=${row.port} version=${row.version} uuid=${row.uuid}`;
    }
    const { rows } = await conn.query("SELECT inet_server_addr()::text AS addr, inet_server_port() AS port, current_setting('server_version') AS version");
    return `addr=${rows[0].addr} port=${rows[0].port} version=${rows[0].version}`;
  } catch {
    return null;
  }
}

const isAccessDenied = (err) => ['ER_DBACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_ERROR', '28P01', '42501'].includes(err?.code);

export async function runEngine(engine, pool, logger, { target = '', expectedDatabase = '' } = {}) {
  let conn;
  let connected = false;
  try {
    conn = engine === 'mysql' ? await pool.getConnection() : await pool.connect();
    const database = await probeConnection(engine, conn);
    connected = true;
    logger.log(`[db-health] ${engine} connection OK: database=${database}`);
    const server = await describeServer(engine, conn);
    if (server) logger.log(`[db-health] ${engine} server: ${server}${target ? ` (configured target ${target})` : ''}`);
    if (expectedDatabase && database !== expectedDatabase) {
      throw new Error(`connected to database "${database}" but the configured database is "${expectedDatabase}" - is the host/port pointing at the right server?`);
    }
    const migration = engine === 'mysql' ? await migrateMysql(conn, { logger }) : await migratePostgres(conn, { logger });
    const verify = migration.failed ? null : await verifySchema(engine, conn);
    if (verify && !verify.ok) {
      logger.error(`[db-migrate] ${engine} schema does not match what the API expects. Missing tables: ${verify.missingTables.join(', ') || 'none'}. ` +
        `Missing columns: ${JSON.stringify(verify.missingColumns)}. (A database that already had old tables needs them migrated or a clean database.)`);
    }
    return { engine, migration, verify, error: null };
  } catch (err) {
    if (connected) logger.error(`[db-migrate] ${engine} migration could not run: ${err.message}`);
    else {
      logger.error(`[db-health] ${engine} connection failed${target ? ` (configured target ${target})` : ''}: ${err.message}`);
      if (isAccessDenied(err)) {
        logger.error(`[db-health] ${engine} rejected the credentials/database. If the same user works against the intended server, ` +
          'the configured host may be resolving to a DIFFERENT server (duplicate network alias?) - use the full service name or IP as the host.');
      }
    }
    return { engine, migration: null, verify: null, error: err.message };
  } finally {
    try { conn?.release(); } catch { /* ignore */ }
  }
}

export default async function startupMigrations({ logger = console, env = process.env, mysqlPool, pgPool } = {}) {
  if (env.DB_AUTO_MIGRATE === '0') { logger.log('[db-migrate] DB_AUTO_MIGRATE=0, skipping'); return { skipped: true }; }
  const timeoutMs = Number(env.DB_MIGRATE_TIMEOUT_MS || 60000);
  const strict = env.DB_SCHEMA_STRICT === '1';

  const work = (async () => {
    if (!mysqlPool) mysqlPool = (await import('../config/db.js')).mysqlPool;
    if (!pgPool) pgPool = (await import('../config/postgres.js')).pgClient;
    const target = (h, p) => (h && String(h).trim() ? `${String(h).trim()}:${String(p ?? '').trim()}` : '');
    const expected = (v) => String(v ?? '').trim();
    const results = await Promise.all([
      runEngine('mysql', mysqlPool, logger, { target: target(env.MYSQL_HOST, env.MYSQL_PORT), expectedDatabase: expected(env.MYSQL_DATABASE) }),
      runEngine('postgres', pgPool, logger, { target: target(env.PGHOST, env.PGPORT), expectedDatabase: expected(env.PGDATABASE) })
    ]);
    const days = env.TOKEN_LOG_RETENTION_DAYS === undefined ? 90 : Number(env.TOKEN_LOG_RETENTION_DAYS);
    await pruneTokenLogs(pgPool, days, logger);
    if (days > 0) setInterval(() => pruneTokenLogs(pgPool, days, logger), 24 * 3600 * 1000).unref();
    return results;
  })();

  let results = [];
  try {
    results = await withTimeout(work, timeoutMs, 'database migration');
  } catch (err) {
    logger.error(`[db-migrate] ${err.message}`);
    results = [{ error: err.message }];
  }

  const problems = results.filter(r => r.error || r.migration?.failed || (r.verify && !r.verify.ok));
  for (const r of results) {
    if (r.migration && !r.migration.failed) {
      const drift = r.migration.drift.length ? ` (checksum drift in ${r.migration.drift.join(', ')} - an applied file was edited)` : '';
      logger.log(`[db-migrate] ${r.engine}: applied [${r.migration.applied.join(', ') || 'none'}] up-to-date [${r.migration.skipped.join(', ') || 'none'}]${drift}`);
    }
  }
  if (problems.length && strict) {
    logger.error('[db-migrate] DB_SCHEMA_STRICT=1 and the schema is not healthy: exiting.');
    process.exit(1);
  }
  return { results, healthy: problems.length === 0 };
}