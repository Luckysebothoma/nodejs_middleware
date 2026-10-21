// HTTP-level integration tests against REAL PostgreSQL (scratch schema).
// Run with:  TEST_PG_URL=postgres://user:pw@host:5432/scratchdb npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { createProductImageRouter } from '../controller/productImageController.js';
import { makeScratchPool, TEST_PG_URL } from './helpers/pg.js';
import { PNG, PNG2, JPEG, WEBP, GIF, SVG, TEXT_AS_PNG } from './helpers/fixtures.js';

const quiet = { log() {}, warn() {}, error() {} };
const skip = TEST_PG_URL ? false : 'set TEST_PG_URL to a scratch database to run the integration tests';

function serve(router) {
  const app = express();
  // mimic index.js: a res.send wrapper that must NOT be needed by the image routes
  app.use((req, res, next) => { const s = res.send; res.send = function (b) { res.locals.sendUsed = true; return s.call(this, b); }; next(); });
  app.use('/api/v1/student', router);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/api/v1/student` }));
  });
}
const form = (buf, name = 'p.png', field = 'image', type = 'image/png') => {
  const f = new FormData(); f.append(field, new Blob([buf], { type }), name); return f;
};

describe('product image API (real Postgres)', { skip }, () => {
  let scratch, srv, existing = new Set(['1', '2', '3', '10']);
  before(async () => {
    scratch = await makeScratchPool();
    const router = createProductImageRouter({ pool: scratch.pool, logger: quiet, productExists: async (id) => existing.has(id) });
    srv = await serve(router);
  });
  after(async () => { srv.server.close(); await scratch.drop(); });

  test('uploads, then serves identical bytes with safe headers', async () => {
    const up = await fetch(`${srv.base}/productImage/1`, { method: 'POST', body: form(PNG) });
    assert.equal(up.status, 201);
    const meta = await up.json();
    assert.equal(meta.productId, 1); assert.equal(meta.contentType, 'image/png'); assert.equal(meta.byteSize, PNG.length);
    assert.equal(meta.replaced, false);

    const res = await fetch(`${srv.base}/productImage/1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(res.headers.get('etag'), `"${meta.sha256}"`);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  });

  test('accepts JPEG and WebP; type comes from the bytes, not the claimed content-type', async () => {
    const j = await fetch(`${srv.base}/productImage/2`, { method: 'POST', body: form(JPEG, 'a.jpg', 'images', 'text/html') });
    assert.equal(j.status, 201); assert.equal((await j.json()).contentType, 'image/jpeg');
    const w = await fetch(`${srv.base}/productImage/3`, { method: 'PUT', body: form(WEBP, 'a.webp', 'file', 'application/octet-stream') });
    assert.equal(w.status, 201); assert.equal((await w.json()).contentType, 'image/webp');
  });

  test('rejects GIF, SVG and text disguised as PNG with 415', async () => {
    for (const [buf, name] of [[GIF, 'a.gif'], [SVG, 'a.svg'], [TEXT_AS_PNG, 'fake.png']]) {
      const r = await fetch(`${srv.base}/productImage/10`, { method: 'POST', body: form(buf, name) });
      assert.equal(r.status, 415, name);
    }
    const none = await fetch(`${srv.base}/productImage/10`);
    assert.equal(none.status, 404, 'nothing may have been stored');
  });

  test('rejects missing file (400), two files (400), oversize (413)', async () => {
    const empty = await fetch(`${srv.base}/productImage/10`, { method: 'POST', body: new FormData() });
    assert.equal(empty.status, 400);

    const two = new FormData();
    two.append('a', new Blob([PNG]), 'a.png'); two.append('b', new Blob([PNG2]), 'b.png');
    assert.equal((await fetch(`${srv.base}/productImage/10`, { method: 'POST', body: two })).status, 400);

    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    assert.equal((await fetch(`${srv.base}/productImage/10`, { method: 'POST', body: form(big) })).status, 413);
  });

  test('rejects invalid product ids with 400', async () => {
    for (const id of ['0', 'abc', '-5', '1.5', '1e3']) {
      assert.equal((await fetch(`${srv.base}/productImage/${id}`, { method: 'POST', body: form(PNG) })).status, 400, id);
      assert.equal((await fetch(`${srv.base}/productImage/${id}`)).status, 400, id);
    }
  });

  test('SQL-injection style ids never reach the database', async () => {
    const r = await fetch(`${srv.base}/productImage/${encodeURIComponent("1; DROP TABLE product_images;--")}`);
    assert.equal(r.status, 400);
    assert.equal((await fetch(`${srv.base}/productImage/1`)).status, 200, 'table still intact');
  });

  test('replacing an image returns 200 + replaced=true and changes the ETag and bytes', async () => {
    const before = await fetch(`${srv.base}/productImage/1`);
    const etag1 = before.headers.get('etag'); await before.arrayBuffer();
    const rep = await fetch(`${srv.base}/productImage/1`, { method: 'POST', body: form(PNG2) });
    assert.equal(rep.status, 200); assert.equal((await rep.json()).replaced, true);
    const after = await fetch(`${srv.base}/productImage/1`);
    assert.notEqual(after.headers.get('etag'), etag1);
    assert.deepEqual(Buffer.from(await after.arrayBuffer()), PNG2);
  });

  test('conditional GET returns 304 without a body; stale ETag returns 200', async () => {
    const r = await fetch(`${srv.base}/productImage/1`);
    const etag = r.headers.get('etag'); await r.arrayBuffer();
    const c = await fetch(`${srv.base}/productImage/1`, { headers: { 'If-None-Match': etag } });
    assert.equal(c.status, 304); assert.equal((await c.arrayBuffer()).byteLength, 0);
    const stale = await fetch(`${srv.base}/productImage/1`, { headers: { 'If-None-Match': '"deadbeef"' } });
    assert.equal(stale.status, 200); await stale.arrayBuffer();
  });

  test('HEAD works, meta and list expose metadata but never bytes', async () => {
    const h = await fetch(`${srv.base}/productImage/1`, { method: 'HEAD' });
    assert.equal(h.status, 200); assert.equal(h.headers.get('content-type'), 'image/png');
    const m = await (await fetch(`${srv.base}/productImage/1/meta`)).json();
    assert.equal(m.productId, 1); assert.equal(m.data, undefined);
    const l = await (await fetch(`${srv.base}/productImages`)).json();
    assert.ok(l.count >= 3); assert.ok(l.images.every(i => i.data === undefined && i.sha256));
  });

  test('delete removes the image (204) then 404s', async () => {
    assert.equal((await fetch(`${srv.base}/productImage/3`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${srv.base}/productImage/3`)).status, 404);
    assert.equal((await fetch(`${srv.base}/productImage/3`, { method: 'DELETE' })).status, 404);
  });

  test('unknown product -> 404 and nothing stored; failing lookup does not block upload', async () => {
    const nope = await fetch(`${srv.base}/productImage/999`, { method: 'POST', body: form(PNG) });
    assert.equal(nope.status, 404);
    assert.equal((await fetch(`${srv.base}/productImage/999`)).status, 404);

    const router = createProductImageRouter({ pool: scratch.pool, logger: quiet, productExists: async () => { throw new Error('mysql down'); } });
    const s2 = await serve(router);
    const r = await fetch(`${s2.base}/productImage/77`, { method: 'POST', body: form(PNG) });
    assert.equal(r.status, 201);
    s2.server.close();
  });

  test('concurrent uploads for the same product leave exactly one consistent row', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      fetch(`${srv.base}/productImage/10`, { method: 'POST', body: form(i % 2 ? PNG : PNG2) }).then(r => r.status)));
    assert.ok(results.every(s => s === 200 || s === 201), results.join(','));
    const { rows } = await scratch.pool.query('SELECT count(*)::int AS n FROM product_images WHERE product_id = 10');
    assert.equal(rows[0].n, 1);
  });

  test('image routes never use res.send (they bypass the slow global send wrapper)', async () => {
    const app = express();
    let sendCalls = 0;
    app.use((req, res, next) => { const s = res.send; res.send = function (b) { sendCalls++; return s.call(this, b); }; next(); });
    app.use('/x', createProductImageRouter({ pool: scratch.pool, logger: quiet }));
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}/x`;
    await (await fetch(`${base}/productImage/1`)).arrayBuffer();
    await (await fetch(`${base}/productImage/424242`)).arrayBuffer();
    await (await fetch(`${base}/productImage/abc`)).arrayBuffer();
    await (await fetch(`${base}/productImages`)).arrayBuffer();
    server.close();
    assert.equal(sendCalls, 0);
  });
});

describe('product image API failure modes', { skip }, () => {
  test('database unreachable -> 503 (not a crash, not a 500)', async () => {
    const dead = new pg.Pool({ host: '127.0.0.1', port: 1, user: 'x', password: 'x', database: 'x', connectionTimeoutMillis: 800 });
    const { server, base } = await serve(createProductImageRouter({ pool: dead, logger: quiet }));
    assert.equal((await fetch(`${base}/productImage/1`)).status, 503);
    assert.equal((await fetch(`${base}/productImage/1`, { method: 'POST', body: form(PNG) })).status, 503);
    assert.equal((await fetch(`${base}/productImages`)).status, 503);
    server.close(); await dead.end().catch(() => {});
  });

  test('auto-migrate disabled and table missing -> 503; with auto-migrate the table is created', async () => {
    const s = await makeScratchPool();
    const off = await serve(createProductImageRouter({ pool: s.pool, logger: quiet, autoMigrate: false }));
    assert.equal((await fetch(`${off.base}/productImage/1`)).status, 503);
    off.server.close();

    const on = await serve(createProductImageRouter({ pool: s.pool, logger: quiet, autoMigrate: true }));
    assert.equal((await fetch(`${on.base}/productImage/1`)).status, 404, 'table now exists, just no image');
    on.server.close(); await s.drop();
  });

  test('the schema migration is idempotent', async () => {
    const s = await makeScratchPool({ createTable: true });
    const { readFile } = await import('node:fs/promises');
    const sql = await readFile(new URL('../sql/001_product_images.sql', import.meta.url), 'utf8');
    await s.pool.query(sql); await s.pool.query(sql);
    await s.drop();
  });

  test('DB-level constraints refuse bad rows even if the API were bypassed', async () => {
    const s = await makeScratchPool({ createTable: true });
    await assert.rejects(s.pool.query(`INSERT INTO product_images VALUES (1,'image/gif',3,repeat('a',64),NULL,'\\x010203',now(),now())`));
    await assert.rejects(s.pool.query(`INSERT INTO product_images VALUES (1,'image/png',99,repeat('a',64),NULL,'\\x010203',now(),now())`));
    await s.drop();
  });
});
