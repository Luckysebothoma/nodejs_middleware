// utils/imageImport.js
// One-off migration helper: turns a folder of existing product images (the old image server's
// files) into rows in product_images. Pure planning + injected I/O so it is fully testable.
// It never guesses: ambiguous / unmatched files are reported and skipped.
import { readdir as fsReaddir, readFile as fsReadFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { MAX_IMAGE_BYTES, detectImageType, sha256Hex, sanitizeOriginalName } from './imageValidation.js';

export const norm = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const RULE_RANK = { 'name-flavor': 4, 'name-flavor-legacy': 3, 'product-id': 2, 'name-only-unique': 1 };

/**
 * @param {string[]} fileNames   file names (no directories)
 * @param {{productId:number|string, productName:string, productFlavor:string}[]} products
 */
export function planImport(fileNames, products) {
  const byId = new Map(products.map(p => [String(p.productId), p]));
  const byNameFlavor = new Map();
  const byName = new Map();
  for (const p of products) {
    const k = norm(`${p.productName} ${p.productFlavor}`);
    byNameFlavor.set(k, [...(byNameFlavor.get(k) ?? []), p]);
    const n = norm(p.productName);
    byName.set(n, [...(byName.get(n) ?? []), p]);
  }

  const candidates = []; // {file, productId, rule}
  const unmatched = [];
  const ambiguous = [];

  for (const file of fileNames) {
    const stem = norm(safeDecode(parse(file).name));
    // exact "<name> <flavor>" first; the old inline edit also produced "<name> <flavor>_WebP.webp"
    const stems = [...new Set([stem, stem.replace(/_webp$/, '').trim()])].map(s => ({ s, rule: s === stem ? 'name-flavor' : 'name-flavor-legacy' }));
    let hit = null;

    for (const { s, rule } of stems) {
      const list = byNameFlavor.get(s);
      if (list) {
        if (list.length === 1) { hit = { productId: String(list[0].productId), rule }; break; }
        ambiguous.push({ file, reason: 'several products share this name and flavor', productIds: list.map(p => String(p.productId)) });
        hit = 'ambiguous';
        break;
      }
    }
    if (hit === 'ambiguous') continue;

    if (!hit) {
      const m = stem.match(/^product[_-]?0*(\d+)$/);
      if (m && byId.has(m[1])) hit = { productId: m[1], rule: 'product-id' };
    }
    if (!hit) {
      const list = byName.get(stem);
      if (list && list.length === 1) hit = { productId: String(list[0].productId), rule: 'name-only-unique' };
    }
    if (hit) candidates.push({ file, ...hit }); else unmatched.push(file);
  }

  // One image per product: keep the single best-ranked file, report the rest.
  const byProduct = new Map();
  for (const c of candidates) byProduct.set(c.productId, [...(byProduct.get(c.productId) ?? []), c]);
  const matched = [];
  const superseded = [];
  for (const [productId, list] of byProduct) {
    const best = Math.max(...list.map(c => RULE_RANK[c.rule]));
    const top = list.filter(c => RULE_RANK[c.rule] === best);
    if (top.length === 1) {
      matched.push(top[0]);
      for (const c of list) if (c !== top[0]) superseded.push({ file: c.file, productId, reason: 'a better-matching file exists' });
    } else {
      for (const c of list) ambiguous.push({ file: c.file, reason: 'several files match the same product', productIds: [productId] });
    }
  }
  return { matched, unmatched, ambiguous, superseded };
}

/**
 * @param {object} o
 * @param {string} o.dir
 * @param {Array}  o.products
 * @param {{query:Function}} o.pool   pg pool (only used when apply is true)
 * @param {boolean} [o.apply=false]
 * @param {boolean} [o.overwrite=false]  replace images that already exist in the database
 */
export async function runImport({ dir, products, pool, apply = false, overwrite = false, readdir = fsReaddir, readFile = fsReadFile, log = () => {} }) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name);
  const plan = planImport(files, products);

  const report = { dir, apply, overwrite, scanned: files.length, imported: [], skippedExisting: [], rejected: [], ...plan };

  for (const m of plan.matched) {
    let buf;
    try { buf = await readFile(join(dir, m.file)); }
    catch (err) { report.rejected.push({ file: m.file, reason: `unreadable: ${err.message}` }); continue; }
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) { report.rejected.push({ file: m.file, reason: `size ${buf.length} bytes is outside 1..${MAX_IMAGE_BYTES}` }); continue; }
    const type = detectImageType(buf);
    if (!type) { report.rejected.push({ file: m.file, reason: 'not a JPEG/PNG/WebP image (checked by content)' }); continue; }

    if (!apply) { report.imported.push({ ...m, contentType: type, byteSize: buf.length, wouldWrite: true }); continue; }

    const conflict = overwrite
      ? `ON CONFLICT (product_id) DO UPDATE SET content_type = EXCLUDED.content_type, byte_size = EXCLUDED.byte_size,
           sha256 = EXCLUDED.sha256, original_name = EXCLUDED.original_name, data = EXCLUDED.data, updated_at = now()`
      : 'ON CONFLICT (product_id) DO NOTHING';
    const res = await pool.query(
      `INSERT INTO product_images (product_id, content_type, byte_size, sha256, original_name, data)
       VALUES ($1, $2, $3, $4, $5, $6) ${conflict}`,
      [m.productId, type, buf.length, sha256Hex(buf), sanitizeOriginalName(m.file), buf]
    );
    if (res.rowCount === 0) report.skippedExisting.push({ ...m, reason: 'image already in database (use --overwrite to replace)' });
    else report.imported.push({ ...m, contentType: type, byteSize: buf.length });
    log(`imported ${m.file} -> product ${m.productId}`);
  }
  return report;
}
