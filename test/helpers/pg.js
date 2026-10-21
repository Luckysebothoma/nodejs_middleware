// Scratch-schema Postgres helper for the integration tests.
// Requires TEST_PG_URL pointing at a SCRATCH database (never production).
import pg from 'pg';
import { randomBytes } from 'node:crypto';

export const TEST_PG_URL = process.env.TEST_PG_URL || '';

export async function makeScratchPool({ createTable = false } = {}) {
  const schema = `img_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: TEST_PG_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: TEST_PG_URL, max: 5, options: `-c search_path=${schema}` });
  if (createTable) {
    const { readFile } = await import('node:fs/promises');
    await pool.query(await readFile(new URL('../../sql/001_product_images.sql', import.meta.url), 'utf8'));
  }
  return {
    pool, schema,
    async drop() { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
  };
}
