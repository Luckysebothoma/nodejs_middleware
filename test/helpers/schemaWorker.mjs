// Child process: creates the product-images router (real controller code) on the scratch schema and
// forces its lazy CREATE TABLE, like one cluster worker booting. Prints one JSON line.
import pg from 'pg';
import { createProductImageRouter } from '../../controller/productImageController.js';

const pool = new pg.Pool({ connectionString: process.env.TEST_PG_URL, max: 2, options: `-c search_path=${process.env.PG_SCHEMA}` });
const router = createProductImageRouter({ pool, logger: { log() {}, warn() {}, error() {} } });
try {
  await router.ensureSchema();
  console.log(JSON.stringify({ ok: true }));
} catch (err) {
  console.log(JSON.stringify({ ok: false, message: String(err.cause?.message || err.message).slice(0, 160) }));
}
await pool.end();
