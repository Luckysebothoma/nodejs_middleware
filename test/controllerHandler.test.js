// Proves the data layer no longer sends Postgres-style SQL to the MySQL connection.
// Uses node:test module mocks (needs --experimental-test-module-mocks, set in `npm test`).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const executed = [];
const fakeConn = {
  query: async (text, values) => { executed.push({ text: String(text), values }); return [[{ productId: 1 }], []]; },
  beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
  release() {}
};
mock.module('../config/db.js', { namedExports: { getConnection: async () => fakeConn, mysqlPool: {} } });
mock.module('../config/redisClient.js', {
  defaultExport: {
    connectRedis: async () => {}, cacheSet: async () => {}, cacheGet: async () => ({ success: false }),
    cacheDelete: async () => {}, cacheExists: async () => false, refreshKey: async () => {},
    safeInvalidateKey: async () => {}, safeCacheSet: async () => {}, tryGetFromCache: async () => null
  }
});
mock.module('../utils/requestLogger.js', { namedExports: { logRequestDetails() {}, logResponseDetails() {} } });

const { default: CH } = await import('../utils/ControllerHandler.js');

test('SELECT: only the MySQL query runs (the Postgres-style one is not sent to MySQL)', async () => {
  executed.length = 0;
  const rows = await CH.getCachedOrQuery('k1', {
    pgQuery: { text: 'SELECT * FROM t WHERE "productId" = $1', values: [1] },
    mysqlQuery: { text: 'SELECT * FROM t WHERE productId = ?', values: [1] }
  });
  assert.deepEqual(rows, [{ productId: 1 }]);
  assert.equal(executed.length, 1);
  assert.match(executed[0].text, /productId = \?/);
  assert.ok(!executed.some(q => q.text.includes('$1')));
});

test('INSERT: runs once on MySQL, no failing Postgres attempt first', async () => {
  executed.length = 0;
  await CH.addCachedAndQuery('k2', {
    pgQuery: { text: 'INSERT INTO t ("a") VALUES ($1)', values: [1] },
    mysqlQuery: { text: 'INSERT INTO t (a) VALUES (?)', values: [1] }
  });
  assert.equal(executed.length, 1);
  assert.match(executed[0].text, /VALUES \(\?\)/);
});

test('UPDATE: runs once on MySQL only', async () => {
  executed.length = 0;
  await CH.updateCachedOrQuery('k3', {
    pgQuery: { text: 'UPDATE t SET "a" = $1', values: [1] },
    mysqlQuery: { text: 'UPDATE t SET a = ?', values: [1] }
  });
  assert.equal(executed.length, 1);
  assert.match(executed[0].text, /SET a = \?/);
});

test('MySQL-only callers (no pgQuery) behave exactly as before', async () => {
  executed.length = 0;
  const rows = await CH.getCachedOrQuery('k4', { mysqlQuery: { text: 'SELECT 1', values: [] } });
  assert.deepEqual(rows, [{ productId: 1 }]);
  assert.equal(executed.length, 1);
});
