// routes/productImageRoutes.js
// Wires the product-image router to the real Postgres pool and the MySQL productList check.
import { pgClient } from '../config/postgres.js';
import { mysqlPool } from '../config/db.js';
import { createProductImageRouter } from '../controller/productImageController.js';

// productList is the authoritative product table (MySQL). Used only to reject uploads for ids that
// do not exist; if this lookup itself fails the upload is still accepted (see controller).
const productExists = async (productId) => {
  const [rows] = await mysqlPool.query('SELECT 1 FROM productList WHERE productId = ? LIMIT 1', [productId]);
  return rows.length > 0;
};

const router = createProductImageRouter({ pool: pgClient, productExists });

// Warm the schema at boot (non-fatal: the first request retries if this fails).
router.ensureSchema().catch(err => console.warn('[product-images] schema not ready at boot:', err.message));

export default router;
