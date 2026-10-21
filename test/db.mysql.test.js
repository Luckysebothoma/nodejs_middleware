// MySQL schema + migration tests against a REAL MySQL (scratch database, dropped afterwards).
// Run:  TEST_MYSQL_URL=mysql://user:pw@host:3306 npm test      (user needs CREATE/DROP DATABASE)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrateMysql, verifySchema } from '../db/migrate.js';
import { makeScratchMysql, TEST_MYSQL_URL } from './helpers/mysql.js';

const quiet = { log() {}, warn() {}, error() {} };
const skip = TEST_MYSQL_URL ? false : 'set TEST_MYSQL_URL (mysql://user:pw@host:port) to run the MySQL tests';

async function migrate(pool, opts = {}) {
  const conn = await pool.getConnection();
  try { return await migrateMysql(conn, { logger: quiet, ...opts }); } finally { conn.release(); }
}
const rows = async (pool, sql, params = []) => (await pool.query(sql, params))[0];
const one = async (pool, sql, params = []) => (await rows(pool, sql, params))[0];

describe('MySQL migrations', { skip }, () => {
  let s;
  before(async () => { s = await makeScratchMysql(); });
  after(async () => { await s.drop(); });

  test('fresh database: applies 001 + 002, verifies, and a second run changes nothing', async () => {
    const r1 = await migrate(s.pool);
    assert.equal(r1.failed, null);
    assert.deepEqual(r1.applied, ['001', '002']);
    const conn = await s.pool.getConnection();
    const v = await verifySchema('mysql', conn); conn.release();
    assert.deepEqual(v, { ok: true, missingTables: [], missingColumns: {} });
    const r2 = await migrate(s.pool);
    assert.deepEqual(r2.applied, []); assert.deepEqual(r2.skipped, ['001', '002']); assert.deepEqual(r2.drift, []);
    const lock = await one(s.pool, "SELECT IS_FREE_LOCK(CONCAT('sweety_schema_migrate:', DATABASE())) AS f");
    assert.equal(Number(lock.f), 1, 'the migration lock is released');
  });

  test("replays the API's own statements; values the API supplies are kept exactly", async () => {
    await s.pool.query(`INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE productName=VALUES(productName), productFlavor=VALUES(productFlavor), productPrice=VALUES(productPrice), image_url=VALUES(image_url)`,
      [1, 'Gum', 'Mint', 60, 'Gum Mint.webp']);
    // bulkTransactionController addYummyRecord (8 columns, explicit values)
    await s.pool.query(`INSERT INTO productPricing (productId, productSize, productQuantity, costPerItem, productProfit, sellingPrice, productCommission, itemGrouping)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [1, 10, 12, 5, 78, 6.5, 18, 1]);
    const p = await one(s.pool, 'SELECT * FROM productPricing WHERE productId = 1');
    assert.deepEqual([p.costPerItem, p.sellingPrice, p.productProfit, p.productCommission], [5, 6.5, 78, 18]);
    // pricingController add2Pricing (7 columns, no itemGrouping) via upsert
    await s.pool.query(`INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url) VALUES (2, 'Toffee', 'Plain', 24, 'Toffee Plain.webp')`);
    await s.pool.query(`INSERT INTO productPricing (productId, costPerItem, sellingPrice, productCommission, productProfit, productQuantity, productSize)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE costPerItem = VALUES(costPerItem), sellingPrice = VALUES(sellingPrice),
      productCommission = VALUES(productCommission), productProfit = VALUES(productProfit), productQuantity = VALUES(productQuantity), productSize = VALUES(productSize)`,
      [2, 6, 9, 7, 30, 4, 25]);
    const q = await one(s.pool, 'SELECT * FROM productPricing WHERE productId = 2');
    assert.equal(q.itemGrouping, 1, 'itemGrouping defaults to 1');
    assert.equal(q.sellingPrice, 9, 'a manual selling price is NOT overridden');
    // UPDATE with every value explicit keeps them
    await s.pool.query('UPDATE productPricing SET costPerItem = ?, sellingPrice = ?, productCommission = ?, productProfit = ? WHERE productId = ?', [6, 10, 8, 40, 2]);
    assert.equal((await one(s.pool, 'SELECT sellingPrice FROM productPricing WHERE productId = 2')).sellingPrice, 10);
  });

  test('auto-populates financial values with the app formulas when the API leaves them 0 / NULL / out', async () => {
    await s.pool.query(`INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url) VALUES (3, 'Lolly', 'Cherry', 60, '')`);
    assert.equal((await one(s.pool, 'SELECT image_url FROM productList WHERE productId = 3')).image_url, 'Lolly Cherry.webp');
    await s.pool.query('INSERT INTO productPricing (productId, productQuantity, productSize) VALUES (3, 12, 10)');
    let p = await one(s.pool, 'SELECT * FROM productPricing WHERE productId = 3');
    assert.deepEqual([p.costPerItem, p.sellingPrice, p.productProfit, p.productCommission], [5, 6.5, 78, 18]);
    assert.deepEqual([p.unitMargin, p.marginPct, p.packCost], [1.5, 30, 60]);

    await s.pool.query(`INSERT INTO productList (productId, productName, productFlavor, productPrice) VALUES (4, 'Nuts', 'Salted', 24)`);
    await s.pool.query('INSERT INTO productPricing (productId, productQuantity, costPerItem, sellingPrice, productProfit, productCommission) VALUES (4, 4, NULL, NULL, NULL, NULL)');
    p = await one(s.pool, 'SELECT * FROM productPricing WHERE productId = 4');
    assert.equal(p.costPerItem, 6); assert.equal(p.sellingPrice, 6 * 1.3);   // identical to the JavaScript result
    assert.equal(p.productProfit, 4 * (6 * 1.3));
  });

  test('the markup setting changes future auto-fill (nothing is hard-coded)', async () => {
    await s.pool.query("UPDATE app_settings SET settingValue = '0.50' WHERE settingKey = 'markup_rate'");
    await s.pool.query(`INSERT INTO productList (productId, productName, productFlavor, productPrice) VALUES (5, 'Choc', 'Dark', 20)`);
    await s.pool.query('INSERT INTO productPricing (productId, productQuantity) VALUES (5, 10)');
    assert.equal((await one(s.pool, 'SELECT sellingPrice FROM productPricing WHERE productId = 5')).sellingPrice, 3);
    await s.pool.query("UPDATE app_settings SET settingValue = '0.30' WHERE settingKey = 'markup_rate'");
  });

  test('generated columns are read-only', async () => {
    await assert.rejects(s.pool.query('UPDATE productPricing SET unitMargin = 99 WHERE productId = 1'));
    await assert.rejects(s.pool.query('INSERT INTO sodEodItems (productId, itemsSold) VALUES (1, 3)'));
  });

  test('remaining per-product tables accept the API statements and fill blank names', async () => {
    await s.pool.query(`INSERT INTO availableItems (productId, itemsRemaining, lastUpdated) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE itemsRemaining = VALUES(itemsRemaining), lastUpdated = VALUES(lastUpdated)`, [1, 20, '2026-10-19 08:00:00']);
    await s.pool.query(`INSERT INTO priceTracing (productId, accAmount, date) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE accAmount = VALUES(accAmount), date = VALUES(date)`, [1, 0, '2026-10-19 08:00:00']);
    await s.pool.query(`INSERT INTO estimates (productId, estimatedSelling, actualSelling, lastUpdated) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE estimatedSelling = VALUES(estimatedSelling), actualSelling = VALUES(actualSelling), lastUpdated = VALUES(lastUpdated)`, [1, 65, 39, '2026-10-19 18:00:00']);
    const e = await one(s.pool, 'SELECT variance, sellThroughPct FROM estimates WHERE productId = 1');
    assert.deepEqual([e.variance, e.sellThroughPct], [-26, 60]);
    await s.pool.query(`INSERT INTO productItemPricing (productId, productDescription, itemGroup, itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE productDescription = VALUES(productDescription), itemGroup = VALUES(itemGroup),
      itemsRemainder = VALUES(itemsRemainder), costOfRemainder = VALUES(costOfRemainder), groupedQuantity = VALUES(groupedQuantity),
      groupedProfit = VALUES(groupedProfit), groupedCommission = VALUES(groupedCommission)`, [1, '', 1, 14, 70, 0, 9, 6.3]);
    assert.equal((await one(s.pool, 'SELECT productDescription d FROM productItemPricing WHERE productId = 1')).d, 'Gum');
    await s.pool.query(`INSERT INTO stockItems (productId, productName, productFlavor, productPrice, lastUpdated, productQuantity) VALUES (1, '', '', 60, '2026-10-19 08:00:00', 24)
      ON DUPLICATE KEY UPDATE productName = VALUES(productName), productFlavor = VALUES(productFlavor), productPrice = VALUES(productPrice), lastUpdated = VALUES(lastUpdated), productQuantity = VALUES(productQuantity)`);
    const st = await one(s.pool, 'SELECT productName n, productFlavor f FROM stockItems WHERE productId = 1');
    assert.deepEqual([st.n, st.f], ['Gum', 'Mint']);
    await s.pool.query(`INSERT INTO stockedItems (productId, stockDate, stockId, stockPrice, stockQuantity) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE stockDate = VALUES(stockDate), stockPrice = VALUES(stockPrice), stockQuantity = VALUES(stockQuantity)`, [1, '2026-10-19 08:00:00', 100, 60, 12]);
    await s.pool.query('INSERT INTO stockedItems (productId, stockPrice, stockQuantity) VALUES (1, 60, 12)');   // stockId auto
    await s.pool.query('INSERT INTO cartList (productId, productName, productFlavor, productPrice) VALUES (1, ?, ?, ?)', ['', '', 60]);
    assert.equal((await one(s.pool, 'SELECT productName n FROM cartList WHERE productId = 1')).n, 'Gum');
  });

  test('a sodEodItems write fills the daily financial ledger automatically (insert, same-day update, next day)', async () => {
    const upsert = (taken, remaining, when) => s.pool.query(`INSERT INTO sodEodItems (productName, itemsTaken, itemsRemaining, lastUpdated, productId, availableItems, outOfStock)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE productName = VALUES(productName), itemsTaken = VALUES(itemsTaken),
      itemsRemaining = VALUES(itemsRemaining), lastUpdated = VALUES(lastUpdated), availableItems = VALUES(availableItems), outOfStock = VALUES(outOfStock)`,
      ['', taken, remaining, when, 1, 14, false]);
    await upsert(10, 4, '2026-10-19 18:00:00');
    assert.equal((await one(s.pool, 'SELECT productName n, itemsSold sold FROM sodEodItems WHERE productId = 1')).sold, 6);
    let d = await rows(s.pool, "SELECT * FROM daily_financials WHERE productId = 1");
    assert.equal(d.length, 1);
    assert.deepEqual([d[0].itemsSold, d[0].sellingPrice, d[0].costPerItem], [6, 6.5, 5]);
    assert.deepEqual([d[0].revenue, d[0].cost, d[0].profit, d[0].commissionAmount, d[0].shopShare], [39, 30, 9, 6.3, 2.7]);
    assert.equal(d[0].productName, 'Gum', 'the blank name was filled from productList, and the ledger records it');

    await upsert(10, 2, '2026-10-19 19:30:00');           // same day, corrected count -> updates, no duplicate
    d = await rows(s.pool, 'SELECT * FROM daily_financials WHERE productId = 1');
    assert.equal(d.length, 1); assert.equal(d[0].itemsSold, 8); assert.equal(d[0].revenue, 52);

    await upsert(12, 12, '2026-10-20 18:00:00');          // next day -> second ledger row, history kept
    d = await rows(s.pool, 'SELECT * FROM daily_financials WHERE productId = 1 ORDER BY businessDate');
    assert.equal(d.length, 2); assert.equal(d[1].itemsSold, 0); assert.equal(d[1].profit, 0);

    const sum = await rows(s.pool, 'SELECT * FROM v_daily_summary ORDER BY businessDate');
    assert.equal(sum.length, 2); assert.equal(sum[0].revenue, 52); assert.equal(sum[0].products, 1);
  });

  test('shop commission rate comes from app_settings', async () => {
    await s.pool.query("UPDATE app_settings SET settingValue = '0.10' WHERE settingKey = 'shop_commission_rate'");
    await s.pool.query(`INSERT INTO sodEodItems (productName, itemsTaken, itemsRemaining, lastUpdated, productId) VALUES ('Lolly', 10, 4, '2026-10-21 18:00:00', 3)`);
    const d = await one(s.pool, "SELECT profit, commissionAmount, shopShare FROM daily_financials WHERE productId = 3");
    assert.equal(d.profit, 9); assert.equal(d.commissionAmount, 8.1); assert.equal(d.shopShare, 0.9);
    await s.pool.query("UPDATE app_settings SET settingValue = '0.30' WHERE settingKey = 'shop_commission_rate'");
  });

  test('every numeric value reaches the API as a number (your pool uses bigNumberStrings)', async () => {
    const check = (row, label) => {
      for (const [k, v] of Object.entries(row)) {
        if (v === null || v instanceof Date || typeof v === 'boolean') continue;
        if (/name|flavor|image_url|description|businessDate|lastUpdated|date|Date/i.test(k)) continue;
        assert.equal(typeof v, 'number', `${label}.${k} is ${typeof v} (${v})`);
      }
    };
    check(await one(s.pool, 'SELECT * FROM productList WHERE productId = 3'), 'productList');
    check(await one(s.pool, 'SELECT * FROM productPricing WHERE productId = 3'), 'productPricing');
    check(await one(s.pool, 'SELECT * FROM availableItems LIMIT 1'), 'availableItems');
    check(await one(s.pool, 'SELECT * FROM estimates LIMIT 1'), 'estimates');
    check(await one(s.pool, 'SELECT * FROM sodEodItems LIMIT 1'), 'sodEodItems');
    check(await one(s.pool, 'SELECT * FROM daily_financials LIMIT 1'), 'daily_financials');
    check(await one(s.pool, 'SELECT * FROM v_product_financials LIMIT 1'), 'v_product_financials');
    check(await one(s.pool, 'SELECT * FROM v_stock_status LIMIT 1'), 'v_stock_status');
    check(await one(s.pool, 'SELECT * FROM v_daily_summary LIMIT 1'), 'v_daily_summary');
  });

  test('constraints protect the data', async () => {
    await assert.rejects(s.pool.query("INSERT INTO productList (productId, productName, productFlavor, productPrice) VALUES (90, 'gum', 'MINT', 1)"), /Duplicate/i, 'name+flavor unique, case-insensitive');
    await assert.rejects(s.pool.query("INSERT INTO productList (productId, productName, productFlavor, productPrice) VALUES (91, 'Neg', 'Price', -1)"));
    await assert.rejects(s.pool.query('UPDATE sodEodItems SET itemsRemaining = 99 WHERE productId = 1'), /check/i);
    await assert.rejects(s.pool.query('UPDATE availableItems SET itemsRemaining = -1 WHERE productId = 1'), /check/i);
    await assert.rejects(s.pool.query('INSERT INTO productPricing (productId) VALUES (424242)'), /foreign key/i);
  });

  test('views: flags manual price edits and low stock', async () => {
    const f = await rows(s.pool, 'SELECT productId, differsFromFormula d FROM v_product_financials ORDER BY productId');
    const byId = Object.fromEntries(f.map(r => [r.productId, Number(r.d)]));
    assert.equal(byId[3], 0, 'auto-filled product matches the formula');
    assert.equal(byId[2], 1, 'the manually priced product is flagged');
    await s.pool.query("UPDATE availableItems SET itemsRemaining = 3 WHERE productId = 1");
    const st = await one(s.pool, 'SELECT isLowStock, isOutOfStock, stockValueAtCost FROM v_stock_status WHERE productId = 1');
    assert.equal(Number(st.isLowStock), 1); assert.equal(Number(st.isOutOfStock), 0); assert.equal(st.stockValueAtCost, 15);
  });

  test("the API's delete order works, leaves no orphans, and the ledger survives", async () => {
    await s.pool.query('INSERT INTO priceTracing (productId, accAmount) VALUES (3, 5) ON DUPLICATE KEY UPDATE accAmount = 5');
    for (const t of ['productPricing', 'availableItems', 'cartList', 'estimates', 'productItemPricing', 'productList', 'sodEodItems', 'stockItems']) {
      await s.pool.query(`DELETE FROM \`${t}\` WHERE productId = ?`, [1]);
    }
    for (const t of ['priceTracing', 'stockedItems', 'productPricing', 'sodEodItems']) {
      assert.equal((await rows(s.pool, `SELECT 1 FROM \`${t}\` WHERE productId = 1`)).length, 0, `${t} has no orphan`);
    }
    assert.ok((await rows(s.pool, 'SELECT 1 FROM daily_financials WHERE productId = 1')).length >= 2, 'history kept');
  });
});

describe('MySQL migration runner: failure handling', { skip }, () => {
  test('a broken migration is reported (not thrown), later files are skipped, and the lock is released', async () => {
    const s = await makeScratchMysql();
    const tmp = await mkdtemp(join(tmpdir(), 'mig-'));
    try {
      await mkdir(join(tmp, 'mysql'));
      await writeFile(join(tmp, 'mysql', '001_ok.sql'), 'CREATE TABLE IF NOT EXISTS t1 (id INT);\n');
      await writeFile(join(tmp, 'mysql', '002_bad.sql'), 'CREATE TABLE IF NOT EXISTS t2 (id INT);\nTHIS IS NOT SQL;\n');
      await writeFile(join(tmp, 'mysql', '003_never.sql'), 'CREATE TABLE IF NOT EXISTS t3 (id INT);\n');
      const dir = pathToFileURL(tmp + '/');
      const r = await migrate(s.pool, { dir });
      assert.deepEqual(r.applied, ['001']);
      assert.equal(r.failed.version, '002'); assert.equal(r.failed.statement, 2); assert.equal(r.failed.of, 2);
      assert.equal((await rows(s.pool, "SHOW TABLES LIKE 't3'")).length, 0, 'later files not applied');
      await writeFile(join(tmp, 'mysql', '002_bad.sql'), 'CREATE TABLE IF NOT EXISTS t2 (id INT);\n');   // fixed: retry works
      const r2 = await migrate(s.pool, { dir });
      assert.equal(r2.failed, null); assert.deepEqual(r2.applied, ['002', '003']);
    } finally { await rm(tmp, { recursive: true, force: true }); await s.drop(); }
  });

  test('an applied file that was edited later is reported as checksum drift and never re-run', async () => {
    const s = await makeScratchMysql();
    const tmp = await mkdtemp(join(tmpdir(), 'mig-'));
    try {
      await mkdir(join(tmp, 'mysql'));
      await writeFile(join(tmp, 'mysql', '001_a.sql'), 'CREATE TABLE IF NOT EXISTS t1 (id INT);\n');
      const dir = pathToFileURL(tmp + '/');
      await migrate(s.pool, { dir });
      await writeFile(join(tmp, 'mysql', '001_a.sql'), 'CREATE TABLE IF NOT EXISTS t1 (id INT);\nCREATE TABLE IF NOT EXISTS sneaky (id INT);\n');
      const r = await migrate(s.pool, { dir });
      assert.deepEqual(r.drift, ['001']); assert.deepEqual(r.applied, []);
      assert.equal((await rows(s.pool, "SHOW TABLES LIKE 'sneaky'")).length, 0);
    } finally { await rm(tmp, { recursive: true, force: true }); await s.drop(); }
  });

  test('an OLD database with legacy tables is reported clearly, not silently accepted', async () => {
    const s = await makeScratchMysql();
    try {
      await s.pool.query(`CREATE TABLE productList (productId INT PRIMARY KEY, productName VARCHAR(50), productFlavor VARCHAR(50), productPrice DOUBLE, image_url VARCHAR(100))`);
      await s.pool.query(`CREATE TABLE productPricing (productId INT PRIMARY KEY, costPerItem DOUBLE, sellingPrice DOUBLE)`);
      const r = await migrate(s.pool);
      assert.ok(r.failed, 'migration reports the mismatch instead of pretending to succeed');
      const conn = await s.pool.getConnection();
      const v = await verifySchema('mysql', conn); conn.release();
      assert.equal(v.ok, false);
      assert.ok(v.missingColumns.productPricing.includes('productQuantity'));
    } finally { await s.drop(); }
  });
});
