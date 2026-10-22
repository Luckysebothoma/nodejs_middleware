import { test } from 'node:test';
import assert from 'node:assert/strict';
import observability from '../observability/sweety_observability.js';

test('observability refreshes product stock and exposes database schema status', async () => {
  const handlers = {};
  const app = {
    use() {},
    get(path, handler) { handlers[path] = handler; }
  };
  const obs = observability.install(app, {
    query: async sql => {
      assert.match(sql, /FROM productList p\s+LEFT JOIN availableItems/);
      return [[{ product_id: 17, category: 'mint', stock: 12 }], []];
    },
    databaseStatus: async () => [
      { engine: 'mysql', connected: true, schemaOk: true, migrationVersion: 2, migrationCurrent: true },
      { engine: 'postgres', connected: true, schemaOk: false, migrationVersion: 0, migrationCurrent: false }
    ]
  });

  await obs.syncAll();
  const metrics = await obs.registry.metrics();
  assert.match(metrics, /sweety_product_stock_units\{product_id="17",category="mint"\} 12/);
  assert.match(metrics, /sweety_database_up\{engine="mysql"\} 1/);
  assert.match(metrics, /sweety_database_schema_ok\{engine="postgres"\} 0/);
  assert.match(metrics, /sweety_database_migration_version\{engine="postgres"\} 0/);
  assert.match(metrics, /sweety_database_migrations_current\{engine="postgres"\} 0/);

  let responseStatus = 200;
  let responseBody;
  const response = {
    status(code) { responseStatus = code; return this; },
    json(body) { responseBody = body; return this; }
  };
  await handlers['/readyz']({}, response);
  assert.equal(responseStatus, 503);
  assert.equal(responseBody.status, 'not_ready');
  assert.deepEqual(responseBody.databases.map(({ engine, schemaHealthy, migrationVersion, migrationsCurrent }) => ({
    engine, schemaHealthy, migrationVersion, migrationsCurrent
  })), [
    { engine: 'mysql', schemaHealthy: true, migrationVersion: 2, migrationsCurrent: true },
    { engine: 'postgres', schemaHealthy: false, migrationVersion: 0, migrationsCurrent: false }
  ]);
});
