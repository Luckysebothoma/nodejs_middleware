// PostgreSQL schema + migration tests against a REAL Postgres (scratch schema, dropped afterwards).
// Run:  TEST_PG_URL=postgres://user:pw@host:5432/scratchdb npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { migratePostgres, verifySchema } from '../db/migrate.js';
import { pruneTokenLogs } from '../db/startupMigrations.js';
import { createProductImageRouter } from '../controller/productImageController.js';
import { makeScratchPool, TEST_PG_URL } from './helpers/pg.js';
import { PNG } from './helpers/fixtures.js';

const quiet = { log() {}, warn() {}, error() {} };
const skip = TEST_PG_URL ? false : 'set TEST_PG_URL to a scratch database to run the Postgres tests';

async function migrate(pool, opts = {}) {
  const client = await pool.connect();
  try { return await migratePostgres(client, { logger: quiet, ...opts }); } finally { client.release(); }
}
const rows = async (pool, sql, params = []) => (await pool.query(sql, params)).rows;
const one = async (pool, sql, params = []) => (await rows(pool, sql, params))[0];

describe('PostgreSQL migrations', { skip }, () => {
  let s;
  before(async () => { s = await makeScratchPool(); });
  after(async () => { await s.drop(); });

  test('fresh schema: applies 001-003, verifies, and a second run changes nothing', async () => {
    const r1 = await migrate(s.pool);
    assert.equal(r1.failed, null);
    assert.deepEqual(r1.applied, ['001', '002', '003']);
    const c = await s.pool.connect();
    const v = await verifySchema('postgres', c); c.release();
    assert.deepEqual(v, { ok: true, missingTables: [], missingColumns: {} });
    const r2 = await migrate(s.pool);
    assert.deepEqual(r2.applied, []); assert.deepEqual(r2.skipped, ['001', '002', '003']); assert.deepEqual(r2.drift, []);
  });

  test("replays the API's Postgres statements (never run before: the Postgres tier was off) and keeps supplied values", async () => {
    await s.pool.query(`INSERT INTO productList ("productId", "productName", "productFlavor", "productPrice", image_url) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT ("productId") DO UPDATE SET "productName" = EXCLUDED."productName", "productFlavor" = EXCLUDED."productFlavor",
      "productPrice" = EXCLUDED."productPrice", image_url = EXCLUDED.image_url`, [1, 'Gum', 'Mint', 60, 'Gum Mint.webp']);
    await s.pool.query(`INSERT INTO productPricing ("productId", "productSize", "productQuantity", "costPerItem", "productProfit", "sellingPrice", "productCommission", "itemGrouping")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [1, 10, 12, 5, 78, 6.5, 18, 1]);
    const p = await one(s.pool, 'SELECT * FROM productPricing WHERE "productId" = 1');
    assert.deepEqual([p.costPerItem, p.sellingPrice, p.productProfit, p.productCommission], [5, 6.5, 78, 18]);
    await s.pool.query(`INSERT INTO productList ("productId", "productName", "productFlavor", "productPrice", image_url) VALUES (2, 'Toffee', 'Plain', 24, 'Toffee Plain.webp')`);
    await s.pool.query(`INSERT INTO productPricing ("productId", "costPerItem", "sellingPrice", "productCommission", "productProfit", "productQuantity", "productSize")
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT ("productId") DO UPDATE SET "costPerItem" = EXCLUDED."costPerItem", "sellingPrice" = EXCLUDED."sellingPrice",
      "productCommission" = EXCLUDED."productCommission", "productProfit" = EXCLUDED."productProfit", "productQuantity" = EXCLUDED."productQuantity", "productSize" = EXCLUDED."productSize"`,
      [2, 6, 9, 7, 30, 4, 25]);
    const q = await one(s.pool, 'SELECT * FROM productPricing WHERE "productId" = 2');
    assert.equal(q.itemGrouping, 1); assert.equal(q.sellingPrice, 9, 'a manual selling price is NOT overridden');
    await s.pool.query('UPDATE productPricing SET "costPerItem" = $1, "sellingPrice" = $2, "productCommission" = $3, "productProfit" = $4 WHERE "productId" = $5', [6, 10, 8, 40, 2]);
    assert.equal((await one(s.pool, 'SELECT "sellingPrice" FROM productPricing WHERE "productId" = 2')).sellingPrice, 10);
  });

  test('auto-populates financial values with the app formulas when the API leaves them 0 / NULL / out', async () => {
    await s.pool.query(`INSERT INTO productList ("productId", "productName", "productFlavor", "productPrice", image_url) VALUES (3, 'Lolly', 'Cherry', 60, '')`);
    assert.equal((await one(s.pool, 'SELECT image_url FROM productList WHERE "productId" = 3')).image_url, 'Lolly Cherry.webp');
    await s.pool.query('INSERT INTO productPricing ("productId", "productQuantity", "productSize") VALUES (3, 12, 10)');
    let p = await one(s.pool, 'SELECT * FROM productPricing WHERE "productId" = 3');
    assert.deepEqual([p.costPerItem, p.sellingPrice, p.productProfit, p.productCommission], [5, 6.5, 78, 18]);
    assert.deepEqual([p.unitMargin, p.marginPct, p.packCost], [1.5, 30, 60]);
    await s.pool.query(`INSERT INTO productList ("productId", "productName", "productFlavor", "productPrice") VALUES (4, 'Nuts', 'Salted', 24)`);
    await s.pool.query('INSERT INTO productPricing ("productId", "productQuantity", "costPerItem", "sellingPrice", "productProfit", "productCommission") VALUES (4, 4, NULL, NULL, NULL, NULL)');
    p = await one(s.pool, 'SELECT * FROM productPricing WHERE "productId" = 4');
    assert.equal(p.costPerItem, 6); assert.equal(p.sellingPrice, 6 * 1.3); assert.equal(p.productProfit, 4 * (6 * 1.3));
  });

  test('the markup setting changes future auto-fill', async () => {
    await s.pool.query(`UPDATE app_settings SET "settingValue" = '0.50' WHERE "settingKey" = 'markup_rate'`);
    await s.pool.query(`INSERT INTO productList ("productId", "productName", "productFlavor", "productPrice") VALUES (5, 'Choc', 'Dark', 20)`);
    await s.pool.query('INSERT INTO productPricing ("productId", "productQuantity") VALUES (5, 10)');
    assert.equal((await one(s.pool, 'SELECT "sellingPrice" FROM productPricing WHERE "productId" = 5')).sellingPrice, 3);
    await s.pool.query(`UPDATE app_settings SET "settingValue" = '0.30' WHERE "settingKey" = 'markup_rate'`);
  });

  test('generated columns are read-only; sequences stay ahead of explicitly supplied ids', async () => {
    await assert.rejects(s.pool.query('UPDATE productPricing SET "unitMargin" = 99 WHERE "productId" = 1'));
    await assert.rejects(s.pool.query('INSERT INTO sodEodItems ("productId", "itemsSold") VALUES (1, 3)'));
    const r = await one(s.pool, `INSERT INTO productList ("productName", "productFlavor", "productPrice") VALUES ('Auto', 'Id', 1) RETURNING "productId"`);
    assert.ok(r.productId > 5, `auto id ${r.productId} must not collide with explicit ids 1..5`);
    await s.pool.query('INSERT INTO stockedItems ("productId", "stockId", "stockPrice", "stockQuantity") VALUES (1, 100, 60, 12)');
    const st = await one(s.pool, 'INSERT INTO stockedItems ("productId", "stockPrice", "stockQuantity") VALUES (1, 60, 12) RETURNING "stockId"');
    assert.ok(st.stockId > 100);
    await s.pool.query('DELETE FROM productList WHERE "productId" = $1', [r.productId]);
  });

  test('remaining per-product tables accept the API statements and fill blank names', async () => {
    await s.pool.query(`INSERT INTO availableItems ("productId", "itemsRemaining", "lastUpdated") VALUES ($1, $2, $3)
      ON CONFLICT ("productId") DO UPDATE SET "itemsRemaining" = EXCLUDED."itemsRemaining", "lastUpdated" = EXCLUDED."lastUpdated"`, [1, 20, '2026-10-19 08:00:00']);
    await s.pool.query(`INSERT INTO priceTracing ("productId", "date", "accAmount") VALUES ($1, $2, $3) ON CONFLICT ("productId") DO UPDATE SET "accAmount" = EXCLUDED."accAmount", "date" = EXCLUDED."date"`, [1, '2026-10-19 08:00:00', 0]);
    await s.pool.query(`INSERT INTO estimates ("productId", "estimatedSelling", "actualSelling", "lastUpdated") VALUES ($1, $2, $3, $4)
      ON CONFLICT ("productId") DO UPDATE SET "estimatedSelling" = EXCLUDED."estimatedSelling", "actualSelling" = EXCLUDED."actualSelling", "lastUpdated" = EXCLUDED."lastUpdated"`, [1, 65, 39, '2026-10-19 18:00:00']);
    const e = await one(s.pool, 'SELECT variance, "sellThroughPct" FROM estimates WHERE "productId" = 1');
    assert.deepEqual([e.variance, e.sellThroughPct], [-26, 60]);
    await s.pool.query(`INSERT INTO productItemPricing ("productId", "productDescription", "itemGroup", "itemsRemainder", "costOfRemainder", "groupedQuantity", "groupedProfit", "groupedCommission")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT ("productId") DO UPDATE SET "productDescription" = EXCLUDED."productDescription", "itemGroup" = EXCLUDED."itemGroup"`, [1, '', 1, 14, 70, 0, 9, 6.3]);
    assert.equal((await one(s.pool, 'SELECT "productDescription" d FROM productItemPricing WHERE "productId" = 1')).d, 'Gum');
    await s.pool.query(`INSERT INTO stockItems ("productId", "productName", "productFlavor", "productPrice", "lastUpdated", "productQuantity") VALUES (1, '', '', 60, '2026-10-19 08:00:00', 24)
      ON CONFLICT ("productId") DO UPDATE SET "productName" = EXCLUDED."productName", "productQuantity" = EXCLUDED."productQuantity"`);
    const st = await one(s.pool, 'SELECT "productName" n, "productFlavor" f FROM stockItems WHERE "productId" = 1');
    assert.deepEqual([st.n, st.f], ['Gum', 'Mint']);
    await s.pool.query(`INSERT INTO cartList ("productId", "productName", "productFlavor", "productPrice") VALUES (1, '', '', 60)`);
    assert.equal((await one(s.pool, 'SELECT "productName" n FROM cartList WHERE "productId" = 1')).n, 'Gum');
  });

  test('a sodEodItems write fills the daily financial ledger automatically (insert, same-day update, next day)', async () => {
    const upsert = (taken, remaining, when) => s.pool.query(`INSERT INTO sodEodItems ("productName", "itemsTaken", "itemsRemaining", "lastUpdated", "productId", "availableItems", "outOfStock")
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT ("productId") DO UPDATE SET "productName" = EXCLUDED."productName", "itemsTaken" = EXCLUDED."itemsTaken",
      "itemsRemaining" = EXCLUDED."itemsRemaining", "lastUpdated" = EXCLUDED."lastUpdated", "availableItems" = EXCLUDED."availableItems", "outOfStock" = EXCLUDED."outOfStock"`,
      ['', taken, remaining, when, 1, 14, false]);
    await upsert(10, 4, '2026-10-19 18:00:00');
    assert.equal((await one(s.pool, 'SELECT "itemsSold" sold FROM sodEodItems WHERE "productId" = 1')).sold, 6);
    let d = await rows(s.pool, 'SELECT * FROM daily_financials WHERE "productId" = 1');
    assert.equal(d.length, 1);
    assert.deepEqual([d[0].itemsSold, d[0].sellingPrice, d[0].costPerItem], [6, 6.5, 5]);
    assert.deepEqual([d[0].revenue, d[0].cost, d[0].profit, d[0].commissionAmount, d[0].shopShare], [39, 30, 9, 6.3, 2.7]);
    assert.equal(d[0].productName, 'Gum');
    await upsert(10, 2, '2026-10-19 19:30:00');
    d = await rows(s.pool, 'SELECT * FROM daily_financials WHERE "productId" = 1');
    assert.equal(d.length, 1); assert.equal(d[0].itemsSold, 8); assert.equal(d[0].revenue, 52);
    await upsert(12, 12, '2026-10-20 18:00:00');
    d = await rows(s.pool, 'SELECT * FROM daily_financials WHERE "productId" = 1 ORDER BY "businessDate"');
    assert.equal(d.length, 2); assert.equal(d[1].itemsSold, 0);
    const sum = await rows(s.pool, 'SELECT * FROM v_daily_summary ORDER BY "businessDate"');
    assert.equal(sum.length, 2); assert.equal(sum[0].revenue, 52); assert.equal(sum[0].products, 1);
  });

  test('shop commission rate comes from app_settings', async () => {
    await s.pool.query(`UPDATE app_settings SET "settingValue" = '0.10' WHERE "settingKey" = 'shop_commission_rate'`);
    await s.pool.query(`INSERT INTO sodEodItems ("productName", "itemsTaken", "itemsRemaining", "lastUpdated", "productId") VALUES ('Lolly', 10, 4, '2026-10-21 18:00:00', 3)`);
    const d = await one(s.pool, 'SELECT profit, "commissionAmount", "shopShare" FROM daily_financials WHERE "productId" = 3');
    assert.equal(d.profit, 9); assert.equal(d.commissionAmount, 8.1); assert.equal(d.shopShare, 0.9);
    await s.pool.query(`UPDATE app_settings SET "settingValue" = '0.30' WHERE "settingKey" = 'shop_commission_rate'`);
  });

  test('every numeric value reaches the API as a number (node-postgres turns int8/numeric into strings)', async () => {
    const check = (row, label) => {
      for (const [k, v] of Object.entries(row)) {
        if (v === null || v instanceof Date || typeof v === 'boolean') continue;
        if (/name|flavor|image_url|description|businessDate|lastUpdated|date|Date|At$/i.test(k)) continue;
        assert.equal(typeof v, 'number', `${label}.${k} is ${typeof v} (${v})`);
      }
    };
    for (const [sql, label] of [
      ['SELECT * FROM productList WHERE "productId" = 3', 'productList'], ['SELECT * FROM productPricing WHERE "productId" = 3', 'productPricing'],
      ['SELECT * FROM availableItems LIMIT 1', 'availableItems'], ['SELECT * FROM estimates LIMIT 1', 'estimates'],
      ['SELECT * FROM sodEodItems LIMIT 1', 'sodEodItems'], ['SELECT * FROM daily_financials LIMIT 1', 'daily_financials'],
      ['SELECT * FROM v_product_financials LIMIT 1', 'v_product_financials'], ['SELECT * FROM v_stock_status LIMIT 1', 'v_stock_status'],
      ['SELECT * FROM v_daily_summary LIMIT 1', 'v_daily_summary']]) check(await one(s.pool, sql), label);
  });

  test('constraints protect the data', async () => {
    await assert.rejects(s.pool.query(`INSERT INTO productList ("productId", "productName", "productFlavor", "productPrice") VALUES (90, 'gum', 'MINT', 1)`), /unique|duplicate/i, 'name+flavor unique, case-insensitive');
    await assert.rejects(s.pool.query(`INSERT INTO productList ("productId", "productName", "productFlavor", "productPrice") VALUES (91, 'Neg', 'Price', -1)`));
    await assert.rejects(s.pool.query('UPDATE sodEodItems SET "itemsRemaining" = 99 WHERE "productId" = 1'), /check/i);
    await assert.rejects(s.pool.query('UPDATE availableItems SET "itemsRemaining" = -1 WHERE "productId" = 1'), /check/i);
    await assert.rejects(s.pool.query('INSERT INTO productPricing ("productId") VALUES (424242)'), /foreign key/i);
  });

  test('views: flags manual price edits and low stock', async () => {
    const f = await rows(s.pool, 'SELECT "productId", "differsFromFormula" d FROM v_product_financials');
    const byId = Object.fromEntries(f.map(r => [r.productId, r.d]));
    assert.equal(byId[3], false); assert.equal(byId[2], true);
    await s.pool.query('UPDATE availableItems SET "itemsRemaining" = 3 WHERE "productId" = 1');
    const st = await one(s.pool, 'SELECT "isLowStock", "isOutOfStock", "stockValueAtCost" FROM v_stock_status WHERE "productId" = 1');
    assert.equal(st.isLowStock, true); assert.equal(st.isOutOfStock, false); assert.equal(st.stockValueAtCost, 15);
  });

  test("the API's delete order works, leaves no orphans, and the ledger survives", async () => {
    await s.pool.query(`INSERT INTO priceTracing ("productId", "accAmount") VALUES (3, 5) ON CONFLICT ("productId") DO UPDATE SET "accAmount" = 5`);
    for (const t of ['productPricing', 'availableItems', 'cartList', 'estimates', 'productItemPricing', 'productList', 'sodEodItems', 'stockItems']) {
      await s.pool.query(`DELETE FROM ${t} WHERE "productId" = $1`, [1]);
    }
    for (const t of ['priceTracing', 'stockedItems', 'productPricing', 'sodEodItems']) {
      assert.equal((await rows(s.pool, `SELECT 1 FROM ${t} WHERE "productId" = 1`)).length, 0, `${t} has no orphan`);
    }
    assert.ok((await rows(s.pool, 'SELECT 1 FROM daily_financials WHERE "productId" = 1')).length >= 2, 'history kept');
  });

  test("config/trackToken.js SQL now works (those tables did not exist before) and old log rows are pruned", async () => {
    const hash = 'abc123';
    for (let i = 0; i < 2; i++) {
      await s.pool.query(`INSERT INTO auth_tokens (token_hash, user_id, issuer, audience, issued_at, expires_at, ttl_seconds, source, permissions)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) ON CONFLICT (token_hash) DO UPDATE SET last_seen = NOW(), ttl_seconds = EXCLUDED.ttl_seconds,
        permissions = EXCLUDED.permissions, source = EXCLUDED.source, updated_at = NOW()`,
        [hash, 'auth0|u1', 'https://x/', 'api', new Date(), new Date(Date.now() + 3600e3), 3600, 'test', JSON.stringify(['read:all'])]);
    }
    assert.equal((await rows(s.pool, 'SELECT 1 FROM auth_tokens')).length, 1);
    await s.pool.query('INSERT INTO token_access_logs (token_hash, user_id, request_path, ip_address) VALUES ($1, $2, $3, $4)', [hash, 'auth0|u1', '/api/x', '::ffff:10.0.0.1']);
    await s.pool.query(`INSERT INTO token_access_logs (token_hash, accessed_at) VALUES ($1, now() - interval '200 days')`, [hash]);
    assert.equal(await pruneTokenLogs(s.pool, 90, quiet), 1);
    assert.equal((await rows(s.pool, 'SELECT 1 FROM token_access_logs')).length, 1);
    assert.equal(await pruneTokenLogs(s.pool, 0, quiet), 0, '0 = keep forever');
  });

  test('the image router from the previous upgrade works on the migrated schema', async () => {
    const app = express();
    app.use('/api/v1/student', createProductImageRouter({ pool: s.pool, logger: quiet, autoMigrate: false }));
    const server = await new Promise(r => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
    const base = `http://127.0.0.1:${server.address().port}/api/v1/student`;
    const f = new FormData(); f.append('image', new Blob([PNG]), 'a.png');
    assert.equal((await fetch(`${base}/productImage/3`, { method: 'POST', body: f })).status, 201);
    const g = await fetch(`${base}/productImage/3`);
    assert.equal(g.status, 200); assert.deepEqual(Buffer.from(await g.arrayBuffer()), PNG);
    server.close();
  });
});

describe('PostgreSQL migration runner: failure handling', { skip }, () => {
  test('a broken migration is rolled back whole, reported (not thrown), later files skipped, retry works', async () => {
    const s = await makeScratchPool();
    const tmp = await mkdtemp(join(tmpdir(), 'mig-'));
    try {
      await mkdir(join(tmp, 'postgres'));
      await writeFile(join(tmp, 'postgres', '001_ok.sql'), 'CREATE TABLE IF NOT EXISTS t1 (id INT);\n');
      await writeFile(join(tmp, 'postgres', '002_bad.sql'), 'CREATE TABLE IF NOT EXISTS t2 (id INT);\nTHIS IS NOT SQL;\n');
      await writeFile(join(tmp, 'postgres', '003_never.sql'), 'CREATE TABLE IF NOT EXISTS t3 (id INT);\n');
      const dir = pathToFileURL(tmp + '/');
      const r = await migrate(s.pool, { dir });
      assert.deepEqual(r.applied, ['001']); assert.equal(r.failed.version, '002');
      assert.equal((await rows(s.pool, "SELECT to_regclass('t2') AS t")) [0].t, null, 'the failed file was rolled back atomically (no half-created t2)');
      assert.equal((await rows(s.pool, "SELECT to_regclass('t3') AS t"))[0].t, null);
      await writeFile(join(tmp, 'postgres', '002_bad.sql'), 'CREATE TABLE IF NOT EXISTS t2 (id INT);\n');
      const r2 = await migrate(s.pool, { dir });
      assert.equal(r2.failed, null); assert.deepEqual(r2.applied, ['002', '003']);
    } finally { await rm(tmp, { recursive: true, force: true }); await s.drop(); }
  });

  test('an applied file that was edited later is reported as drift and never re-run', async () => {
    const s = await makeScratchPool();
    const tmp = await mkdtemp(join(tmpdir(), 'mig-'));
    try {
      await mkdir(join(tmp, 'postgres'));
      await writeFile(join(tmp, 'postgres', '001_a.sql'), 'CREATE TABLE IF NOT EXISTS t1 (id INT);\n');
      const dir = pathToFileURL(tmp + '/');
      await migrate(s.pool, { dir });
      await writeFile(join(tmp, 'postgres', '001_a.sql'), 'CREATE TABLE IF NOT EXISTS t1 (id INT);\nCREATE TABLE IF NOT EXISTS sneaky (id INT);\n');
      const r = await migrate(s.pool, { dir });
      assert.deepEqual(r.drift, ['001']); assert.deepEqual(r.applied, []);
      assert.equal((await rows(s.pool, "SELECT to_regclass('sneaky') AS t"))[0].t, null);
    } finally { await rm(tmp, { recursive: true, force: true }); await s.drop(); }
  });

  test('an OLD database with legacy tables is reported clearly', async () => {
    const s = await makeScratchPool();
    try {
      await s.pool.query(`CREATE TABLE productList ("productId" INT PRIMARY KEY, "productName" TEXT, "productFlavor" TEXT, "productPrice" DOUBLE PRECISION, image_url TEXT)`);
      await s.pool.query(`CREATE TABLE productPricing ("productId" INT PRIMARY KEY, "costPerItem" DOUBLE PRECISION, "sellingPrice" DOUBLE PRECISION)`);
      const r = await migrate(s.pool);
      assert.ok(r.failed, 'migration reports the mismatch instead of pretending to succeed');
      const c = await s.pool.connect();
      const v = await verifySchema('postgres', c); c.release();
      assert.equal(v.ok, false); assert.ok(v.missingColumns.productPricing.includes('productQuantity'));
    } finally { await s.drop(); }
  });
});
