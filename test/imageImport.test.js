import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planImport, runImport } from '../utils/imageImport.js';
import { makeScratchPool, TEST_PG_URL } from './helpers/pg.js';
import { PNG, JPEG, WEBP, GIF } from './helpers/fixtures.js';

const products = [
  { productId: 1, productName: 'Gum', productFlavor: 'Mint' },
  { productId: 2, productName: 'Lollipop', productFlavor: 'Cherry' },
  { productId: 3, productName: 'Toffee', productFlavor: 'Plain' },
  { productId: 4, productName: 'Twin', productFlavor: 'A' },
  { productId: 5, productName: 'Twin', productFlavor: 'A' },
  { productId: 6, productName: 'Solo', productFlavor: 'X' }
];

test('planImport matches by name+flavor (case/space/URL-encoding tolerant)', () => {
  const p = planImport(['Gum Mint.webp', 'lollipop  cherry.WEBP', 'Toffee%20Plain.webp', 'Gum Mint_WebP.webp'], products);
  const ids = Object.fromEntries(p.matched.map(m => [m.file, m.productId]));
  assert.equal(ids['Gum Mint.webp'], '1');
  assert.equal(ids['lollipop  cherry.WEBP'], '2');
  assert.equal(ids['Toffee%20Plain.webp'], '3');
  assert.ok(p.superseded.some(s => s.file === 'Gum Mint_WebP.webp') || ids['Gum Mint_WebP.webp'] === undefined);
});

test('planImport matches Product_<id> files and a unique name-only file', () => {
  const p = planImport(['Product_2.jpg', 'product-06.png', 'Solo.png', 'Gum.png'], products);
  const ids = Object.fromEntries(p.matched.map(m => [m.file, m.productId]));
  assert.equal(ids['Product_2.jpg'], '2');
  assert.equal(ids['product-06.png'], '6');
  assert.equal(ids['Solo.png'], undefined, 'name-only loses to the better id match for product 6');
  assert.equal(ids['Gum.png'], '1');
});

test('planImport never guesses: duplicates and unknowns are reported', () => {
  const p = planImport(['Twin A.webp', 'nothing-here.webp', 'Product_999.jpg'], products);
  assert.equal(p.matched.length, 0);
  assert.equal(p.ambiguous.length, 1);
  assert.deepEqual(p.unmatched.sort(), ['Product_999.jpg', 'nothing-here.webp']);
});

test('two files for one product: best rule wins, equal rules are ambiguous', () => {
  const best = planImport(['Gum Mint.webp', 'Product_1.jpg'], products);
  assert.equal(best.matched.length, 1); assert.equal(best.matched[0].file, 'Gum Mint.webp'); assert.equal(best.superseded.length, 1);
  const tie = planImport(['Product_1.jpg', 'product_1.png'], products);
  assert.equal(tie.matched.length, 0); assert.equal(tie.ambiguous.length, 2);
});

describe('runImport (real Postgres)', { skip: TEST_PG_URL ? false : 'set TEST_PG_URL' }, () => {
  test('dry run writes nothing; apply imports; re-run skips existing; overwrite replaces', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'imgimp-'));
    const s = await makeScratchPool({ createTable: true });
    try {
      await writeFile(join(dir, 'Gum Mint.webp'), WEBP);
      await writeFile(join(dir, 'Product_2.jpg'), JPEG);
      await writeFile(join(dir, 'Toffee Plain.webp'), GIF);          // wrong content -> rejected
      await writeFile(join(dir, 'random.txt'), 'x');                  // unmatched
      await writeFile(join(dir, '.hidden'), 'x');                     // ignored

      const dry = await runImport({ dir, products, pool: s.pool, apply: false });
      assert.equal(dry.imported.length, 2); assert.equal(dry.rejected.length, 1); assert.equal(dry.unmatched.length, 1);
      assert.equal((await s.pool.query('SELECT count(*)::int n FROM product_images')).rows[0].n, 0);

      const applied = await runImport({ dir, products, pool: s.pool, apply: true });
      assert.equal(applied.imported.length, 2);
      const rows = (await s.pool.query('SELECT product_id::text id, content_type FROM product_images ORDER BY product_id')).rows;
      assert.deepEqual(rows, [{ id: '1', content_type: 'image/webp' }, { id: '2', content_type: 'image/jpeg' }]);

      const again = await runImport({ dir, products, pool: s.pool, apply: true });
      assert.equal(again.imported.length, 0); assert.equal(again.skippedExisting.length, 2);

      await writeFile(join(dir, 'Gum Mint.webp'), Buffer.concat([WEBP, Buffer.from('more')]));
      const over = await runImport({ dir, products, pool: s.pool, apply: true, overwrite: true });
      assert.equal(over.imported.length, 2);
      const sz = (await s.pool.query('SELECT byte_size FROM product_images WHERE product_id = 1')).rows[0].byte_size;
      assert.equal(sz, WEBP.length + 4);
    } finally { await rm(dir, { recursive: true, force: true }); await s.drop(); }
  });
});
