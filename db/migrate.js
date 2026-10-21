// db/migrate.js
// Versioned, lock-protected schema migrations for MySQL and PostgreSQL.
//
//  * Files:  db/migrations/<mysql|postgres>/NNN_name.sql, applied in order, each recorded once in
//            schema_migrations (version, name, checksum). Applied files are never re-run.
//  * Never destructive: no DROP of tables, no data deletes. Files are idempotent so a run that was
//            interrupted half-way can simply be retried.
//  * Concurrency: a database-level lock (MySQL GET_LOCK / PostgreSQL pg_advisory_lock) serialises
//            runners, so several API replicas/workers starting together cannot race (the
//            "pg_type_typname_nsp_index" duplicate-key error).
//  * Failures are returned, not thrown, so the caller decides whether they are fatal.
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { splitSqlStatements } from './splitSql.js';
import { expectedFor } from './expectedSchema.js';

export const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
const FILE_RE = /^(\d{3,})_([a-z0-9_]+)\.sql$/;
const PG_LOCK_KEY = 727401;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export async function listMigrations(engine, dir = MIGRATIONS_DIR) {
  const base = new URL(`${engine}/`, dir);
  let names;
  try { names = await readdir(base); } catch { return []; }
  const files = [];
  for (const name of names.sort()) {
    const m = name.match(FILE_RE);
    if (!m) continue;
    const sql = await readFile(new URL(name, base), 'utf8');
    files.push({ version: m[1], name: m[2], file: name, sql, checksum: sha256(sql) });
  }
  return files;
}

const summarize = (err) => ({
  code: err?.code || err?.errno || '',
  message: String(err?.sqlMessage || err?.message || err).split('\n')[0].slice(0, 300)
});

const privilegeHint = (engine, e) => {
  if (engine === 'mysql' && [1419, 1227, 1044, 1142, 'ER_BINLOG_CREATE_ROUTINE_NEED_SUPER'].includes(e.code))
    return ' Hint: the MySQL user lacks a privilege needed for triggers/procedures. An admin can grant TRIGGER and CREATE ROUTINE, and if binary logging is on run: SET GLOBAL log_bin_trust_function_creators = 1;';
  if (engine === 'postgres' && ['42501'].includes(e.code))
    return ' Hint: the Postgres user lacks CREATE privilege on the schema.';
  return '';
};

/** MySQL: `conn` is a dedicated mysql2/promise connection (e.g. pool.getConnection()). */
export async function migrateMysql(conn, { dir = MIGRATIONS_DIR, logger = console } = {}) {
  const result = { engine: 'mysql', applied: [], skipped: [], drift: [], failed: null };
  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
  const lockName = `sweety_schema_migrate:${db}`;
  const [[lock]] = await conn.query('SELECT GET_LOCK(?, 120) AS got', [lockName]);
  if (Number(lock.got) !== 1) { result.failed = { version: '-', code: 'LOCK', message: 'could not obtain the migration lock within 120s' }; return result; }
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(16) NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL, checksum CHAR(64) NOT NULL,
      appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, executionMs INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [rows] = await conn.query('SELECT version, checksum FROM schema_migrations');
    const done = new Map(rows.map(r => [r.version, r.checksum]));

    for (const f of await listMigrations('mysql', dir)) {
      if (done.has(f.version)) {
        result.skipped.push(f.version);
        if (done.get(f.version) !== f.checksum) result.drift.push(f.version);
        continue;
      }
      const t0 = Date.now();
      const statements = splitSqlStatements(f.sql);
      let i = 0;
      try {
        for (; i < statements.length; i++) await conn.query(statements[i]);
      } catch (err) {
        const e = summarize(err);
        result.failed = { version: f.version, name: f.name, ...e, statement: i + 1, of: statements.length,
          message: `${e.message}${privilegeHint('mysql', e)}` };
        logger.error(`[db-migrate] mysql ${f.file} failed at statement ${i + 1}/${statements.length}: ${result.failed.message}`);
        return result;
      }
      await conn.query('INSERT INTO schema_migrations (version, name, checksum, executionMs) VALUES (?, ?, ?, ?)',
        [f.version, f.name, f.checksum, Date.now() - t0]);
      result.applied.push(f.version);
      logger.log(`[db-migrate] mysql applied ${f.file} (${statements.length} statements, ${Date.now() - t0} ms)`);
    }
    return result;
  } finally {
    try { await conn.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch { /* connection may be gone */ }
  }
}

/** PostgreSQL: `client` is a dedicated pg client (pool.connect()). Each file runs in one transaction. */
export async function migratePostgres(client, { dir = MIGRATIONS_DIR, logger = console } = {}) {
  const result = { engine: 'postgres', applied: [], skipped: [], drift: [], failed: null };
  await client.query('SELECT pg_advisory_lock($1)', [PG_LOCK_KEY]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
      "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "executionMs" INTEGER NOT NULL DEFAULT 0)`);
    const { rows } = await client.query('SELECT version, checksum FROM schema_migrations');
    const done = new Map(rows.map(r => [r.version, r.checksum]));

    for (const f of await listMigrations('postgres', dir)) {
      if (done.has(f.version)) {
        result.skipped.push(f.version);
        if (done.get(f.version) !== f.checksum) result.drift.push(f.version);
        continue;
      }
      const t0 = Date.now();
      try {
        await client.query('BEGIN');
        await client.query(f.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum, "executionMs") VALUES ($1, $2, $3, $4)',
          [f.version, f.name, f.checksum, Date.now() - t0]);
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
        const e = summarize(err);
        result.failed = { version: f.version, name: f.name, ...e, message: `${e.message}${privilegeHint('postgres', e)}` };
        logger.error(`[db-migrate] postgres ${f.file} failed: ${result.failed.message}`);
        return result;
      }
      result.applied.push(f.version);
      logger.log(`[db-migrate] postgres applied ${f.file} (${Date.now() - t0} ms)`);
    }
    return result;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [PG_LOCK_KEY]); } catch { /* connection may be gone */ }
  }
}

/** Compares the live database with db/expectedSchema.js. */
export async function verifySchema(engine, conn) {
  let rows;
  if (engine === 'mysql') {
    [rows] = await conn.query(
      'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()');
  } else {
    ({ rows } = await conn.query(
      'SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = current_schema()'));
  }
  // MySQL folds table-name case per OS; PG folds unquoted names to lower case: compare case-insensitively on tables.
  const live = new Map();
  for (const { t, c } of rows) {
    const k = String(t).toLowerCase();
    if (!live.has(k)) live.set(k, new Set());
    live.get(k).add(c);
  }
  const missingTables = [];
  const missingColumns = {};
  for (const [table, columns] of Object.entries(expectedFor(engine))) {
    const have = live.get(table.toLowerCase());
    if (!have) { missingTables.push(table); continue; }
    const miss = columns.filter(c => !have.has(c));
    if (miss.length) missingColumns[table] = miss;
  }
  return { ok: missingTables.length === 0 && Object.keys(missingColumns).length === 0, missingTables, missingColumns };
}

export default { migrateMysql, migratePostgres, verifySchema, listMigrations, MIGRATIONS_DIR };
