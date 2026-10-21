#!/usr/bin/env node
// scripts/import_product_images.mjs
// Imports existing product image files (from the old image server's folder) into Postgres.
//
//   node scripts/import_product_images.mjs --dir /path/to/images            # dry run (default)
//   node scripts/import_product_images.mjs --dir /path/to/images --apply    # write
//   add --overwrite to replace images that already exist in the database
//
// Run it where the API's environment/keys are available (e.g. inside the sweety-api container
// with the folder mounted). Product list is read (read-only) from MySQL productList.
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

if (has('--help') || has('-h') || !val('--dir')) {
  console.log('Usage: node scripts/import_product_images.mjs --dir <folder> [--apply] [--overwrite]\nDry run unless --apply is given.');
  process.exit(has('--help') || has('-h') ? 0 : 1);
}

const { runImport } = await import('../utils/imageImport.js');
const { mysqlPool } = await import('../config/db.js');
const { pgClient } = await import('../config/postgres.js');

const apply = has('--apply');
try {
  const [products] = await mysqlPool.query('SELECT productId, productName, productFlavor FROM productList');
  console.log(`Loaded ${products.length} products from MySQL productList.`);
  if (apply) await pgClient.query(await readFile(new URL('../sql/001_product_images.sql', import.meta.url), 'utf8'));

  const r = await runImport({ dir: val('--dir'), products, pool: pgClient, apply, overwrite: has('--overwrite'), log: console.log });

  console.log(`\n${apply ? 'APPLIED' : 'DRY RUN (nothing written)'}  scanned=${r.scanned}`);
  console.log(`  ${apply ? 'imported' : 'would import'}: ${r.imported.length}`);
  if (r.skippedExisting.length) console.log(`  already in database: ${r.skippedExisting.length}`);
  console.log(`  unmatched files: ${r.unmatched.length}`);
  console.log(`  ambiguous: ${r.ambiguous.length}   superseded: ${r.superseded.length}   rejected: ${r.rejected.length}`);
  for (const [label, list] of [['UNMATCHED', r.unmatched.map(f => ({ file: f }))], ['AMBIGUOUS', r.ambiguous], ['REJECTED', r.rejected]]) {
    if (list.length) { console.log(`\n${label}:`); list.slice(0, 50).forEach(x => console.log('  -', x.file, x.reason ? `(${x.reason})` : '')); }
  }
  const covered = new Set(r.imported.map(m => String(m.productId)));
  const missing = products.filter(p => !covered.has(String(p.productId)));
  console.log(`\nProducts that still have no imported image: ${missing.length} of ${products.length}`);
  process.exitCode = r.rejected.length || r.ambiguous.length ? 3 : 0;
} catch (err) {
  console.error('Import failed:', err.message);
  process.exitCode = 2;
} finally {
  await Promise.allSettled([mysqlPool.end(), pgClient.end()]);
}
