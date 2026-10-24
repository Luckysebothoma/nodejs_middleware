import { formatForMySQL } from '../utils/formatForMySQL.js';
import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { getLongTime } = TimeUtils;

import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';

import { getConnection } from '../config/db.js';
import multer from 'multer';
import { pgClient } from '../config/postgres.js';
import redisClient from '../config/redisClient.js';

const { addCachedAndQuery } = ControllerHandler;
const { safeInvalidateKey } = redisClient;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Run one write on BOTH databases (MySQL + Postgres) through the tiered handler.
const dualWrite = async (key, pgQuery, mysqlQuery) => {
  try {
    return await addCachedAndQuery(key, { pgQuery, mysqlQuery });
  } catch (error) {
    console.error(`❌ Failed on key [${key}]:`, error);
    throw new Error(`Exception on ${key}: ${error.message || error}`, { cause: error });
  }
};

// Timestamp helper: falls back to "now" when the client omits the value.
const ts = (v) => formatForMySQL(v || new Date());

// ---------------------------------------------------------------------------
// File upload handling
// ---------------------------------------------------------------------------

const storage = multer.diskStorage({
  destination: './uploads',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '_' + file.originalname);
  }
});
export const upload = multer({ storage });

export async function handleFileUpload(req, res) {
  try {
    const productId = req.body.product_id;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded.' });
    }

    const client = await pgClient.connect();

    try {
      for (const file of files) {
        const imageUrl = `/uploads/${file.filename}`;
        await client.query(
          'UPDATE products SET image_url = $1 WHERE id = $2',
          [imageUrl, productId]
        );
      }
    } finally {
      client.release();
    }

    res.status(200).json({ message: 'Upload successful.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed.' });
  }
}

// ---------------------------------------------------------------------------
// Reusable record writers (CREATE + UPDATE via upsert, both databases)
// Postgres: tables are unquoted (fold to lowercase), camelCase columns are quoted.
// ---------------------------------------------------------------------------

async function addProductRecord(p) {
  console.log(getLongTime() + ": addProductRecord called..!");
  const values = [p.productId, p.productName, p.productFlavor, p.productPrice, p.image_url];

  return dualWrite("productList",
    {
      text: `
        INSERT INTO productList ("productId", "productName", "productFlavor", "productPrice", image_url)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT ("productId") DO UPDATE SET
          "productName" = EXCLUDED."productName",
          "productFlavor" = EXCLUDED."productFlavor",
          "productPrice" = EXCLUDED."productPrice",
          image_url = EXCLUDED.image_url`,
      values
    },
    {
      text: `
        INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          productName = VALUES(productName),
          productFlavor = VALUES(productFlavor),
          productPrice = VALUES(productPrice),
          image_url = VALUES(image_url)`,
      values
    }
  );
}

async function addYummyRecord(p) {
  console.log("addYummyRecord called..!", p);
  // itemGrouping is optional: when omitted, an existing value is kept (COALESCE).
  const values = [
    p.productId, p.costPerItem, p.sellingPrice, p.productCommission,
    p.productProfit, p.productQuantity, p.productSize, p.itemGrouping ?? null
  ];

  return dualWrite("productPricing",
    {
      text: `
        INSERT INTO productPricing ("productId", "costPerItem", "sellingPrice", "productCommission", "productProfit", "productQuantity", "productSize", "itemGrouping")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT ("productId") DO UPDATE SET
          "costPerItem" = EXCLUDED."costPerItem",
          "sellingPrice" = EXCLUDED."sellingPrice",
          "productCommission" = EXCLUDED."productCommission",
          "productProfit" = EXCLUDED."productProfit",
          "productQuantity" = EXCLUDED."productQuantity",
          "productSize" = EXCLUDED."productSize",
          "itemGrouping" = COALESCE(EXCLUDED."itemGrouping", productPricing."itemGrouping")`,
      values
    },
    {
      text: `
        INSERT INTO productPricing (productId, costPerItem, sellingPrice, productCommission, productProfit, productQuantity, productSize, itemGrouping)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          costPerItem = VALUES(costPerItem),
          sellingPrice = VALUES(sellingPrice),
          productCommission = VALUES(productCommission),
          productProfit = VALUES(productProfit),
          productQuantity = VALUES(productQuantity),
          productSize = VALUES(productSize),
          itemGrouping = COALESCE(VALUES(itemGrouping), itemGrouping)`,
      values
    }
  );
}

async function addAvailableItems(a) {
  console.log("addAvailableItems called..!");
  const values = [a.productId, a.itemsRemaining, ts(a.lastUpdated)];

  return dualWrite("availableItems",
    {
      text: `
        INSERT INTO availableItems ("productId", "itemsRemaining", "lastUpdated")
        VALUES ($1, $2, $3)
        ON CONFLICT ("productId") DO UPDATE SET
          "itemsRemaining" = EXCLUDED."itemsRemaining",
          "lastUpdated" = EXCLUDED."lastUpdated"`,
      values
    },
    {
      text: `
        INSERT INTO availableItems (productId, itemsRemaining, lastUpdated)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          itemsRemaining = VALUES(itemsRemaining),
          lastUpdated = VALUES(lastUpdated)`,
      values
    }
  );
}

async function addPriceTrace(t) {
  const values = [t.productId, t.accAmount, ts(t.date || t.lastUpdated)];

  return dualWrite("priceTracing",
    {
      text: `
        INSERT INTO priceTracing ("productId", "accAmount", "date")
        VALUES ($1, $2, $3)
        ON CONFLICT ("productId") DO UPDATE SET
          "accAmount" = EXCLUDED."accAmount",
          "date" = EXCLUDED."date"`,
      values
    },
    {
      text: `
        INSERT INTO priceTracing (productId, accAmount, date)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          accAmount = VALUES(accAmount),
          date = VALUES(date)`,
      values
    }
  );
}

async function addEstimates(e) {
  const values = [e.productId, e.estimatedSelling, e.actualSelling, ts(e.lastUpdated)];

  return dualWrite("estimates",
    {
      text: `
        INSERT INTO estimates ("productId", "estimatedSelling", "actualSelling", "lastUpdated")
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ("productId") DO UPDATE SET
          "estimatedSelling" = EXCLUDED."estimatedSelling",
          "actualSelling" = EXCLUDED."actualSelling",
          "lastUpdated" = EXCLUDED."lastUpdated"`,
      values
    },
    {
      text: `
        INSERT INTO estimates (productId, estimatedSelling, actualSelling, lastUpdated)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          estimatedSelling = VALUES(estimatedSelling),
          actualSelling = VALUES(actualSelling),
          lastUpdated = VALUES(lastUpdated)`,
      values
    }
  );
}

async function addSodEod(s) {
  const values = [s.productId, s.productName, s.itemsRemaining, s.itemsTaken, ts(s.lastUpdated)];

  return dualWrite("sodEodItems",
    {
      text: `
        INSERT INTO sodEodItems ("productId", "productName", "itemsRemaining", "itemsTaken", "lastUpdated")
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT ("productId") DO UPDATE SET
          "productName" = EXCLUDED."productName",
          "itemsRemaining" = EXCLUDED."itemsRemaining",
          "itemsTaken" = EXCLUDED."itemsTaken",
          "lastUpdated" = EXCLUDED."lastUpdated"`,
      values
    },
    {
      text: `
        INSERT INTO sodEodItems (productId, productName, itemsRemaining, itemsTaken, lastUpdated)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          productName = VALUES(productName),
          itemsRemaining = VALUES(itemsRemaining),
          itemsTaken = VALUES(itemsTaken),
          lastUpdated = VALUES(lastUpdated)`,
      values
    }
  );
}

async function addProductItemPricing(p) {
  const values = [
    p.productId, p.productDescription, p.itemGroup, p.itemsRemainder,
    p.costOfRemainder, p.groupedQuantity, p.groupedProfit, p.groupedCommission
  ];

  return dualWrite("productItemPricing",
    {
      text: `
        INSERT INTO productItemPricing ("productId", "productDescription", "itemGroup", "itemsRemainder", "costOfRemainder", "groupedQuantity", "groupedProfit", "groupedCommission")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT ("productId") DO UPDATE SET
          "productDescription" = EXCLUDED."productDescription",
          "itemGroup" = EXCLUDED."itemGroup",
          "itemsRemainder" = EXCLUDED."itemsRemainder",
          "costOfRemainder" = EXCLUDED."costOfRemainder",
          "groupedQuantity" = EXCLUDED."groupedQuantity",
          "groupedProfit" = EXCLUDED."groupedProfit",
          "groupedCommission" = EXCLUDED."groupedCommission"`,
      values
    },
    {
      text: `
        INSERT INTO productItemPricing (productId, productDescription, itemGroup, itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          productDescription = VALUES(productDescription),
          itemGroup = VALUES(itemGroup),
          itemsRemainder = VALUES(itemsRemainder),
          costOfRemainder = VALUES(costOfRemainder),
          groupedQuantity = VALUES(groupedQuantity),
          groupedProfit = VALUES(groupedProfit),
          groupedCommission = VALUES(groupedCommission)`,
      values
    }
  );
}

// ---------------------------------------------------------------------------
// CREATE: addNewCandy / addNewCandy_with_image
// ---------------------------------------------------------------------------

// Parent (productList) first so FKs are satisfied in both databases.
async function addNewCandy_function(productList, pricing, available, priceTracing) {
  const productResult = await addProductRecord(productList);
  const yummyResult = await addYummyRecord(pricing);
  const availableResult = await addAvailableItems(available);
  const traceResult = await addPriceTrace(priceTracing);
  return { productResult, yummyResult, availableResult, traceResult };
}

const addNewCandy = async (req, res) => {
  logRequestDetails(req, "addNewCandy");

  const { addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing } = req.body;

  try {
    await addNewCandy_function(addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing);
    console.log('✅ All records added for productId:', addProductListRequest.productId);
    return logResponseDetails(
      req, res,
      { status: 200, success: true, message: `${getLongTime()}: Operation completed successfully` },
      "addNewCandy", 200
    );
  } catch (error) {
    const errorMessage = `${getLongTime()}: 🔥 addNewCandy failed: ${error.message || error}`;
    console.error(errorMessage);
    return logResponseDetails(
      req, res,
      { status: 500, success: false, message: errorMessage },
      "addNewCandy", 500
    );
  }
};

const addNewCandy_with_image = async (req, res) => {
  logRequestDetails(req, "addNewCandy_with_image");

  try {
    const { addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing } = req.body;
    const file = req.file;

    console.log(`Image: ${JSON.stringify(file)}
  ProductList: ${JSON.stringify(addProductListRequest)}
  Pricing: ${JSON.stringify(addProductPricingRequest)}
  Available Items: ${JSON.stringify(addAvailableItemsRequest)}
  Price Tracing: ${JSON.stringify(addPriceTracing)}
  `);

    if (!file) {
      return logResponseDetails(
        req, res,
        { success: false, message: "No image file uploaded" },
        "addNewCandy_with_image", 400
      );
    }

    await addNewCandy_function(addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing);
    console.log("Done adding product, now adding image");

    const imageInsertQuery = `
      INSERT INTO images (filename, mimetype, size, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (filename) DO UPDATE SET
        mimetype = EXCLUDED.mimetype,
        size = EXCLUDED.size,
        created_at = NOW()
    `;
    const imageReplacements = [file.filename, file.mimetype, file.size];

    // Postgres-only syntax, so it goes under pgQuery.
    const responses = await addCachedAndQuery("images", {
      pgQuery: { text: imageInsertQuery, values: imageReplacements }
    });
    console.log("Response after adding image:", responses);

    return logResponseDetails(
      req, res,
      { success: true, message: "Candy and image added successfully", responses },
      "images", 200
    );
  } catch (error) {
    console.error("🔥 addNewCandy_with_image failed:", error);
    return logResponseDetails(
      req, res,
      { success: false, message: error.message || String(error) },
      "addNewCandy_with_image", 500
    );
  }
};

// ---------------------------------------------------------------------------
// UPDATE: updateProducts_Batch (upserts into BOTH databases)
// ---------------------------------------------------------------------------

const updateProducts_Batch = async (req, res) => {
  logRequestDetails(req, "updateProducts_Batch");

  const { productList, pricingList, availableItems, priceTracingList } = req.body;

  const missingFields = [];
  if (!productList) missingFields.push("productList");
  if (!pricingList) missingFields.push("pricingList");
  if (!availableItems) missingFields.push("availableItems");
  if (!priceTracingList) missingFields.push("priceTracingList");

  if (missingFields.length > 0) {
    console.error("❌ Missing required root fields:", missingFields);
    return logResponseDetails(
      req, res,
      { status: 400, error: `Missing required fields: ${missingFields.join(", ")}` },
      "updateProducts_Batch", 400
    );
  }

  try {
    await addProductRecord(productList);
    await addYummyRecord(pricingList);
    await addAvailableItems(availableItems);
    await addPriceTrace(priceTracingList);

    console.log("✅ Batch upsert completed in MySQL and Postgres.");
    return logResponseDetails(req, res, { status: 200, success: true }, "updateProducts_Batch", 200);
  } catch (error) {
    console.error("🔥 Batch upsert error:", error);
    return logResponseDetails(
      req, res,
      { status: 500, error: "Internal server error", details: error.message },
      "updateProducts_Batch", 500
    );
  }
};

// ---------------------------------------------------------------------------
// CREATE/UPDATE: addListOfSodEod
// ---------------------------------------------------------------------------

const addListOfSodEod = async (req, res) => {
  const { sodEOd, availableItems, estimates, pricingTracing, ProductItemPricing } = req.body;

  console.log(`pricingTracing: ${JSON.stringify(pricingTracing)} \n sodEOd: ${JSON.stringify(sodEOd)}, \n availableItems: ${JSON.stringify(availableItems)}, \n estimates: ${JSON.stringify(estimates)}`);

  try {
    const sodEodResponse = await addSodEod(sodEOd);
    const availableItemsResponse = await addAvailableItems(availableItems);
    const estimateResponse = await addEstimates(estimates);
    const productItemPricingResponse = await addProductItemPricing(ProductItemPricing);
    const pricetracingReponse = await addPriceTrace(pricingTracing);

    return logResponseDetails(
      req, res,
      { sodEodResponse, availableItemsResponse, estimateResponse, productItemPricingResponse, pricetracingReponse },
      "addListOfSodEod", 200
    );
  } catch (error) {
    console.error(`🔥 addListOfSodEod failed:`, error);
    return logResponseDetails(
      req, res,
      { success: false, message: error.message || String(error) },
      "addListOfSodEod", 500
    );
  }
};

// ---------------------------------------------------------------------------
// DELETE: both databases at once, each in a single transaction
// ---------------------------------------------------------------------------

// Children first, parent last, so FKs never block the delete in either database.
const PRODUCT_TABLES = [
  'stockedItems', 'stockItems', 'cartList', 'sodEodItems', 'estimates',
  'priceTracing', 'productItemPricing', 'availableItems', 'productPricing',
  'productList',
];

const deleteFromMysql = async (productId) => {
  const conn = await getConnection();
  const counts = {};
  try {
    await conn.beginTransaction();
    for (const t of PRODUCT_TABLES) {
      const [r] = await conn.query(`DELETE FROM \`${t}\` WHERE productId = ?`, [productId]);
      counts[t] = r.affectedRows;
    }
    await conn.commit();
    return counts;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
};

const deleteFromPostgres = async (productId) => {
  const client = await pgClient.connect();
  const counts = {};
  try {
    await client.query('BEGIN');
    for (const t of PRODUCT_TABLES) {
      // Postgres tables are lowercase (unquoted); only the camelCase column needs quotes.
      const r = await client.query(`DELETE FROM ${t} WHERE "productId" = $1`, [productId]);
      counts[t] = r.rowCount;
    }
    await client.query('COMMIT');
    return counts;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

export const deleteAllProductData = async (req, res) => {
  const productId = req.params.id;

  if (!productId) {
    return logResponseDetails(
      req, res,
      { success: false, message: "Missing product ID for deleting all product data" },
      "deleteAllProductData", 400
    );
  }

  // Clear the cache first: a cache hit triggers a reconcile that can restore rows from Redis.
  await Promise.all(PRODUCT_TABLES.map((k) => safeInvalidateKey(k)));

  const [my, pg] = await Promise.allSettled([
    deleteFromMysql(productId),
    deleteFromPostgres(productId),
  ]);

  await Promise.all(PRODUCT_TABLES.map((k) => safeInvalidateKey(k)));

  if (my.status === 'fulfilled' && pg.status === 'fulfilled') {
    console.log(`✅ Deleted productId=${productId} from both databases`);
    return logResponseDetails(
      req, res,
      {
        success: true,
        message: "Deletion completed in MySQL and Postgres",
        results: { mysql: my.value, postgres: pg.value }
      },
      "deleteAllProductData", 200
    );
  }

  // One side failed and rolled back, so the other database may be ahead and the sync would
  // copy the rows back. The delete is idempotent, so the client should simply retry.
  const failures = {
    mysql: my.status === 'rejected' ? my.reason?.message : null,
    postgres: pg.status === 'rejected' ? pg.reason?.message : null,
  };
  console.error(`🔥 Delete diverged for productId=${productId}:`, failures);
  return logResponseDetails(
    req, res,
    { success: false, message: "Delete failed on one database. Retry the request.", failures },
    "deleteAllProductData", 500
  );
};

const deleteItem = async (req, res) => {
  logRequestDetails(req, "deleteItem");

  const { productId } = req.body;
  console.log(`${getLongTime()}: 🧹 Deleting productId: [${productId}]`);

  try {
    return await deleteAllProductData({ params: { id: productId } }, res);
  } catch (error) {
    const errMsg = `${getLongTime()}: ❌ Failed to purge productId [${productId}]: ${error}`;
    console.error(errMsg);
    return logResponseDetails(
      req, res,
      { status: 500, success: false, message: errMsg },
      "failed_purge", 500
    );
  }
};

export default {
  addNewCandy,
  addNewCandy_with_image,
  deleteItem,
  updateProducts_Batch,
  addListOfSodEod,
  addSodEod
};