// Regression for the boot race seen in the API logs: several workers creating tables at the same time
// (duplicate key value violates unique constraint "pg_type_typname_nsp_index").
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeScratchPool, TEST_PG_URL } from './helpers/pg.js';
import { makeScratchMysql, TEST_MYSQL_URL } from './helpers/mysql.js';

const helper = (name) => fileURLToPath(new URL(`./helpers/${name}`, import.meta.url));
const WORKERS = 6;

function runWorkers(script, env, n = WORKERS) {
  return Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper(script)], { env: { ...process.env, ...env } });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      const line = out.trim().split('\n').pop();
      try { resolve({ code, ...JSON.parse(line) }); } catch { reject(new Error(`worker output not JSON (exit ${code}): ${out} ${err}`)); }
    });
  })));
}

describe('concurrent startup', { skip: TEST_PG_URL ? false : 'set TEST_PG_URL' }, () => {
  test(`${WORKERS} processes creating the product_images table at once: none fails`, async () => {
    for (let round = 0; round < 3; round++) {
      const s = await makeScratchPool();
      try {
        const results = await runWorkers('schemaWorker.mjs', { PG_SCHEMA: s.schema });
        const failures = results.filter(r => !r.ok);
        assert.deepEqual(failures, [], `round ${round}: ${JSON.stringify(failures)}`);
        assert.equal((await s.pool.query("SELECT to_regclass('product_images') AS t")).rows[0].t, 'product_images');
      } finally { await s.drop(); }
    }
  });

  test(`${WORKERS} processes running the full Postgres migration at once: exactly one applies each file`, async () => {
    for (let round = 0; round < 3; round++) {
      const s = await makeScratchPool();
      try {
        const results = await runWorkers('migrateWorker.mjs', { ENGINE: 'postgres', PG_SCHEMA: s.schema });
        assert.ok(results.every(r => r.failed === null && r.error === null && r.verifyOk === true), JSON.stringify(results));
        const applied = results.flatMap(r => r.applied).sort();
        assert.deepEqual(applied, ['001', '002', '003'], 'each version applied exactly once across all workers');
        assert.equal((await s.pool.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n, 3);
      } finally { await s.drop(); }
    }
  });
});

describe('concurrent startup (MySQL)', { skip: TEST_MYSQL_URL ? false : 'set TEST_MYSQL_URL' }, () => {
  test(`${WORKERS} processes running the full MySQL migration at once: exactly one applies each file`, async () => {
    for (let round = 0; round < 3; round++) {
      const s = await makeScratchMysql();
      try {
        const results = await runWorkers('migrateWorker.mjs', { ENGINE: 'mysql', MYSQL_DB: s.db });
        assert.ok(results.every(r => r.failed === null && r.error === null && r.verifyOk === true), JSON.stringify(results));
        assert.deepEqual(results.flatMap(r => r.applied).sort(), ['001', '002'], 'each version applied exactly once');
        assert.equal(Number((await s.pool.query('SELECT COUNT(*) n FROM schema_migrations'))[0][0].n), 2);
      } finally { await s.drop(); }
    }
  });
});
