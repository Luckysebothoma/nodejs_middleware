// controller/productImageController.js
//
// Product images stored in PostgreSQL (table product_images, see sql/001_product_images.sql).
//
// Design notes
//  - Dependency-injected: createProductImageRouter({ pool, productExists }) so the whole thing is
//    testable against a real Postgres without booting index.js (which exits when Postgres is down).
//  - Responses are written with res.end(), NOT res.send()/res.json(): index.js wraps res.send in a
//    logger that awaits a Postgres insert (trackToken) on every call, which would slow every <img>.
//  - The image type is detected from the bytes (magic numbers); client Content-Type is ignored.
//  - Reads are cacheable: strong ETag = sha256, Cache-Control: no-cache (always revalidate, cheap 304).
import { Router } from 'express';
import multer, { memoryStorage } from 'multer';
import { readFile } from 'node:fs/promises';
import {
  MAX_IMAGE_BYTES, detectImageType, parseProductId, sha256Hex, sanitizeOriginalName, etagMatches
} from '../utils/imageValidation.js';

const SCHEMA_FILE = new URL('../sql/001_product_images.sql', import.meta.url);

// Several cluster workers (or replicas) may create the table at the same moment; unserialised
// CREATE TABLE IF NOT EXISTS races on the Postgres catalog ("pg_type_typname_nsp_index" duplicate key).
// A transaction-scoped advisory lock makes them take turns.
const SCHEMA_LOCK_KEY = 727402;
async function applySchema(pool, sql) {
  if (typeof pool.connect !== 'function') return pool.query(sql);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_KEY]);
    await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

export function createProductImageRouter({
  pool,
  productExists = null,
  autoMigrate = process.env.IMAGE_AUTO_MIGRATE !== '0',
  logger = console
} = {}) {
  if (!pool || typeof pool.query !== 'function') throw new Error('createProductImageRouter: a pg Pool is required');

  // ---------- helpers ----------
  const sendJson = (res, status, body) => {
    res.status(status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };

  let schemaPromise = null;
  const ensureSchema = () => {
    if (!autoMigrate) return Promise.resolve();
    if (!schemaPromise) {
      schemaPromise = readFile(SCHEMA_FILE, 'utf8')
        .then(sql => applySchema(pool, sql))
        .then(() => { logger.log('[product-images] schema ready'); })
        .catch(err => {
          schemaPromise = null; // retry on the next request
          const e = new Error(`schema unavailable: ${err.message}`);
          e.code = 'SCHEMA_UNAVAILABLE';
          e.cause = err;
          throw e;
        });
    }
    return schemaPromise;
  };

  const isStorageDown = (err) =>
    err?.code === 'SCHEMA_UNAVAILABLE' ||
    err?.code === '42P01' || // undefined_table (auto-migrate off and migration not run)
    /^08/.test(err?.code || '') || // connection exceptions
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', '57P01'].includes(err?.code) ||
    /timeout|connect/i.test(err?.message || '');

  const fail = (res, err, what) => {
    logger.error(`[product-images] ${what} failed:`, err?.code || '', err?.message || err);
    if (isStorageDown(err)) return sendJson(res, 503, { error: 'Image storage is temporarily unavailable' });
    return sendJson(res, 500, { error: 'Internal error while handling the image' });
  };

  const urlFor = (id) => `/api/v1/student/productImage/${id}`;
  const metaOf = (r) => ({
    productId: Number(r.product_id),
    contentType: r.content_type,
    byteSize: r.byte_size,
    sha256: r.sha256,
    originalName: r.original_name ?? null,
    updatedAt: r.updated_at,
    url: urlFor(r.product_id)
  });

  // ---------- upload ----------
  const uploader = multer({
    storage: memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, parts: 12 }
  }).any(); // any field name: current and old front-ends use image / images / file

  const parseUpload = (req, res, next) => {
    uploader(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return sendJson(res, 413, { error: 'Image is too large (maximum 5 MB)' });
      if (err instanceof multer.MulterError) return sendJson(res, 400, { error: 'Send exactly one image file' });
      logger.error('[product-images] upload parse error:', err.message);
      return sendJson(res, 400, { error: 'Malformed upload' });
    });
  };

  const upload = async (req, res) => {
    const id = parseProductId(req.params.productId);
    if (!id) return sendJson(res, 400, { error: 'Invalid product id' });

    const file = Array.isArray(req.files) ? req.files[0] : null;
    if (!file || !file.buffer || file.buffer.length === 0) return sendJson(res, 400, { error: 'No image file was uploaded' });

    const type = detectImageType(file.buffer);
    if (!type) return sendJson(res, 415, { error: 'Unsupported image. Use a JPEG, PNG or WebP file' });

    if (productExists) {
      try {
        if (!(await productExists(id))) return sendJson(res, 404, { error: `Product ${id} does not exist` });
      } catch (err) {
        // A failing secondary lookup must not block the upload; log and continue.
        logger.warn(`[product-images] product existence check failed for ${id}: ${err.message}`);
      }
    }

    try {
      await ensureSchema();
      const hash = sha256Hex(file.buffer);
      const { rows } = await pool.query(
        `INSERT INTO product_images (product_id, content_type, byte_size, sha256, original_name, data)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (product_id) DO UPDATE SET
           content_type = EXCLUDED.content_type, byte_size = EXCLUDED.byte_size, sha256 = EXCLUDED.sha256,
           original_name = EXCLUDED.original_name, data = EXCLUDED.data, updated_at = now()
         RETURNING (xmax = 0) AS inserted, product_id, content_type, byte_size, sha256, original_name, updated_at`,
        [id, type, file.buffer.length, hash, sanitizeOriginalName(file.originalname), file.buffer]
      );
      const row = rows[0];
      return sendJson(res, row.inserted ? 201 : 200, { ...metaOf(row), replaced: !row.inserted });
    } catch (err) {
      return fail(res, err, `upload for product ${id}`);
    }
  };

  // ---------- read ----------
  const getImage = async (req, res) => {
    const id = parseProductId(req.params.productId);
    if (!id) return sendJson(res, 400, { error: 'Invalid product id' });
    try {
      await ensureSchema();
      let row;
      if (req.headers['if-none-match']) {
        const m = await pool.query('SELECT content_type, byte_size, sha256, updated_at FROM product_images WHERE product_id = $1', [id]);
        row = m.rows[0];
        if (!row) return sendJson(res, 404, { error: 'No image for this product' });
        const etag = `"${row.sha256}"`;
        if (etagMatches(req.headers['if-none-match'], etag)) {
          res.status(304);
          res.setHeader('ETag', etag);
          res.setHeader('Cache-Control', 'no-cache');
          return res.end();
        }
      }
      const full = await pool.query('SELECT content_type, byte_size, sha256, updated_at, data FROM product_images WHERE product_id = $1', [id]);
      row = full.rows[0];
      if (!row) return sendJson(res, 404, { error: 'No image for this product' });

      res.status(200);
      res.setHeader('Content-Type', row.content_type);
      res.setHeader('Content-Length', String(row.data.length));
      res.setHeader('ETag', `"${row.sha256}"`);
      res.setHeader('Last-Modified', new Date(row.updated_at).toUTCString());
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Content-Disposition', 'inline');
      return res.end(row.data);
    } catch (err) {
      return fail(res, err, `read for product ${id}`);
    }
  };

  const getMeta = async (req, res) => {
    const id = parseProductId(req.params.productId);
    if (!id) return sendJson(res, 400, { error: 'Invalid product id' });
    try {
      await ensureSchema();
      const { rows } = await pool.query(
        'SELECT product_id, content_type, byte_size, sha256, original_name, updated_at FROM product_images WHERE product_id = $1', [id]);
      if (!rows[0]) return sendJson(res, 404, { error: 'No image for this product' });
      return sendJson(res, 200, metaOf(rows[0]));
    } catch (err) {
      return fail(res, err, `meta for product ${id}`);
    }
  };

  const list = async (_req, res) => {
    try {
      await ensureSchema();
      const { rows } = await pool.query(
        'SELECT product_id, content_type, byte_size, sha256, original_name, updated_at FROM product_images ORDER BY product_id LIMIT 5000');
      return sendJson(res, 200, { count: rows.length, images: rows.map(metaOf) });
    } catch (err) {
      return fail(res, err, 'list');
    }
  };

  const remove = async (req, res) => {
    const id = parseProductId(req.params.productId);
    if (!id) return sendJson(res, 400, { error: 'Invalid product id' });
    try {
      await ensureSchema();
      const { rowCount } = await pool.query('DELETE FROM product_images WHERE product_id = $1', [id]);
      if (!rowCount) return sendJson(res, 404, { error: 'No image for this product' });
      res.status(204);
      return res.end();
    } catch (err) {
      return fail(res, err, `delete for product ${id}`);
    }
  };

  const router = Router();
  router.get('/productImages', list);
  router.get('/productImage/:productId/meta', getMeta);
  router.get('/productImage/:productId', getImage);
  router.post('/productImage/:productId', parseUpload, upload);
  router.put('/productImage/:productId', parseUpload, upload);
  router.delete('/productImage/:productId', remove);
  router.ensureSchema = ensureSchema; // exposed so the host app can warm it at boot
  return router;
}

export default { createProductImageRouter };
