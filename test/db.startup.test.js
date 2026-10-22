import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import startupMigrations, { probeConnection, runEngine } from '../db/startupMigrations.js';
import { makeScratchPool, TEST_PG_URL } from './helpers/pg.js';
import { makeScratchMysql, TEST_MYSQL_URL } from './helpers/mysql.js';

const quiet = () => { const lines = []; return { lines, log: m => lines.push(m), warn: m => lines.push(m), error: m => lines.push(m) }; };
const both = (TEST_PG_URL && TEST_MYSQL_URL) ? false : 'set TEST_PG_URL and TEST_MYSQL_URL';

test('connection probe reports the selected database for each engine', async () => {
  const mysqlConn = { query: async (sql) => {
    assert.match(sql, /^SELECT 1 AS connected, DATABASE\(\) AS `?database`?$/);
    return [[{ connected: 1, database: 'yummies' }]];
  } };
  const pgConn = { query: async (sql) => {
    assert.equal(sql, 'SELECT 1 AS connected, current_database() AS database');
    return { rows: [{ connected: 1, database: 'yummies' }] };
  } };

  assert.equal(await probeConnection('mysql', mysqlConn), 'yummies');
  assert.equal(await probeConnection('postgres', pgConn), 'yummies');
});

test('connection failure is logged as a health failure before migrations run', async () => {
  const log = quiet();
  const r = await runEngine('mysql', {
    getConnection: async () => { throw new Error("Access denied for user 'mini' to database 'yummies'"); }
  }, log);

  assert.match(log.lines[0], /^\[db-health\] mysql connection failed:/);
  assert.match(log.lines[0], /Access denied/);
  assert.equal(r.migration, null);
});

test('DB_AUTO_MIGRATE=0 skips everything and touches nothing', async () => {
  const r = await startupMigrations({ env: { DB_AUTO_MIGRATE: '0' }, logger: quiet(), mysqlPool: null, pgPool: null });
  assert.deepEqual(r, { skipped: true });
});

describe('startupMigrations against real databases', { skip: both }, () => {
  test('migrates both engines on first boot, is a no-op on the second, and reports healthy', async () => {
    const pgS = await makeScratchPool(); const myS = await makeScratchMysql(); const log = quiet();
    try {
      const r1 = await startupMigrations({ env: { TOKEN_LOG_RETENTION_DAYS: '0' }, logger: log, mysqlPool: myS.pool, pgPool: pgS.pool });
      assert.equal(r1.healthy, true);
      const my = r1.results.find(r => r.engine === 'mysql'), pgr = r1.results.find(r => r.engine === 'postgres');
      assert.deepEqual(my.migration.applied, ['001', '002']); assert.deepEqual(pgr.migration.applied, ['001', '002', '003']);
      const r2 = await startupMigrations({ env: { TOKEN_LOG_RETENTION_DAYS: '0' }, logger: log, mysqlPool: myS.pool, pgPool: pgS.pool });
      assert.equal(r2.healthy, true);
      assert.deepEqual(r2.results.find(r => r.engine === 'mysql').migration.applied, []);
      assert.ok(log.lines.some(l => /mysql: applied \[001, 002\]/.test(l)));
    } finally { await pgS.drop(); await myS.drop(); }
  });

  test('Postgres unreachable: MySQL is still migrated, the API is told it is unhealthy, and it does not crash', async () => {
    const myS = await makeScratchMysql(); const log = quiet();
    const dead = new pg.Pool({ host: '127.0.0.1', port: 1, user: 'x', password: 'x', database: 'x', connectionTimeoutMillis: 700 });
    try {
      const exit = mock.method(process, 'exit', () => { throw new Error('exit must not be called when not strict'); });
      const r = await startupMigrations({ env: { TOKEN_LOG_RETENTION_DAYS: '0' }, logger: log, mysqlPool: myS.pool, pgPool: dead });
      exit.mock.restore();
      assert.equal(r.healthy, false);
      assert.deepEqual(r.results.find(r => r.engine === 'mysql').migration.applied, ['001', '002']);
      assert.ok(r.results.find(r => r.engine === 'postgres').error);
    } finally { mock.restoreAll(); await myS.drop(); await dead.end().catch(() => {}); }
  });

  test('DB_SCHEMA_STRICT=1 exits with code 1 when something is wrong, and not when all is well', async () => {
    const myS = await makeScratchMysql(); const pgS = await makeScratchPool();
    const dead = new pg.Pool({ host: '127.0.0.1', port: 1, user: 'x', password: 'x', database: 'x', connectionTimeoutMillis: 700 });
    try {
      const exit = mock.method(process, 'exit', () => {});
      await startupMigrations({ env: { DB_SCHEMA_STRICT: '1', TOKEN_LOG_RETENTION_DAYS: '0' }, logger: quiet(), mysqlPool: myS.pool, pgPool: pgS.pool });
      assert.equal(exit.mock.callCount(), 0, 'healthy -> no exit');
      await startupMigrations({ env: { DB_SCHEMA_STRICT: '1', TOKEN_LOG_RETENTION_DAYS: '0' }, logger: quiet(), mysqlPool: myS.pool, pgPool: dead });
      assert.equal(exit.mock.callCount(), 1); assert.deepEqual(exit.mock.calls[0].arguments, [1]);
    } finally { mock.restoreAll(); await myS.drop(); await pgS.drop(); await dead.end().catch(() => {}); }
  });

  test('a database that never answers cannot block the API from starting (timeout)', async () => {
    const myS = await makeScratchMysql(); const pgS = await makeScratchPool();
    const hang = { connect: () => new Promise(() => {}) };
    try {
      const t0 = Date.now();
      const r = await startupMigrations({ env: { DB_MIGRATE_TIMEOUT_MS: '600', TOKEN_LOG_RETENTION_DAYS: '0' }, logger: quiet(), mysqlPool: myS.pool, pgPool: hang });
      assert.ok(Date.now() - t0 < 3000, 'returned promptly');
      assert.equal(r.healthy, false);
    } finally { await myS.drop(); await pgS.drop(); }
  });
});
