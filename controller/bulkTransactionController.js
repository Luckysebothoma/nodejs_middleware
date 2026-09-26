import { formatForMySQL } from '../utils/formatForMySQL.js';
import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';

import { getConnection, mysqlPool } from '../config/db.js';
import multer from 'multer';
import { pgClient } from '../config/postgres.js';

const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;

const productPricingKey = "productPricing";
const availableItemsKey = "availableItems";
const cartListKey = "cartList";
const estimatesKey = "estimates";
const productInventoryKey = "productInventory";
const productItemPricingKey = "productItemPricing";
const productListKey = "productList";
const sodEodItemsKey = "sodEodItems";
const stockItemsKey = "stockItems";
const stockedItemsKey = "stockedItems";

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
      // NOTE: release() belongs in `finally` so a failed UPDATE mid-loop
      // doesn't leak the pg client.
      client.release();
    }

    res.status(200).json({ message: 'Upload successful.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed.' });
  }
}

// ---------------------------------------------------------------------------
// updateProducts_Batch
// ---------------------------------------------------------------------------

const updateProducts_Batch = async (req, res) => {
  logRequestDetails(req, "updateProducts_Batch");

  const { productList, pricingList, availableItems, priceTracingList } = req.body;

  // `connection` is declared outside the try block so it stays in scope for
  // beginTransaction/query/commit/rollback/release below.
  let connection;
  try {
    connection = await getConnection();
  } catch (err) {
    console.error("🔥 Error getting MySQL connection:", err);
    return res.status(500).json({ message: 'Error getting MySQL connection' });
  }

  console.log("🟢 updateProducts_Batch called with body:\n", JSON.stringify(req.body, null, 2));

  const missingFields = [];
  if (!productList) missingFields.push("productList");
  if (!pricingList) missingFields.push("pricingList");
  if (!availableItems) missingFields.push("availableItems");
  if (!priceTracingList) missingFields.push("priceTracingList");

  if (missingFields.length > 0) {
    console.error("❌ Missing required root fields:", missingFields);
    connection.release();
    return logResponseDetails(
      req, res,
      { status: 400, error: `Missing required fields: ${missingFields.join(", ")}` },
      "updateProducts_Batch", 400
    );
  }

  try {
    await connection.beginTransaction();

    await connection.query(
      "INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE productName = VALUES(productName), productFlavor = VALUES(productFlavor), productPrice = VALUES(productPrice), image_url = VALUES(image_url)",
      [productList.productId, productList.productName, productList.productFlavor, productList.productPrice, productList.image_url]
    );

    await connection.query(
      "INSERT INTO productPricing (productId, productSize, productQuantity, costPerItem, productProfit, sellingPrice, productCommission, itemGrouping) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE productSize = VALUES(productSize), productQuantity = VALUES(productQuantity), costPerItem = VALUES(costPerItem), productProfit = VALUES(productProfit), sellingPrice = VALUES(sellingPrice), productCommission = VALUES(productCommission), itemGrouping = VALUES(itemGrouping)",
      [
        pricingList.productId, pricingList.productSize, pricingList.productQuantity, pricingList.costPerItem,
        pricingList.productProfit, pricingList.sellingPrice, pricingList.productCommission, pricingList.itemGrouping
      ]
    );

    await connection.query(
      "INSERT INTO availableItems (productId, itemsRemaining, lastUpdated) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE itemsRemaining = VALUES(itemsRemaining), lastUpdated = VALUES(lastUpdated)",
      [availableItems.productId, availableItems.itemsRemaining, formatForMySQL(availableItems.lastUpdated)]
    );

    await connection.query(
      "INSERT INTO priceTracing (productId, accAmount, date) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE accAmount = VALUES(accAmount), date = VALUES(date)",
      [priceTracingList.productId, priceTracingList.accAmount, priceTracingList.date]
    );

    await connection.commit();
    console.log("✅ Batch upsert completed.");
    return logResponseDetails(req, res, { status: 200, success: true }, "updateProducts_Batch", 200);

  } catch (error) {
    await connection.rollback();
    console.error("🔥 Batch upsert error:", error);
    return logResponseDetails(
      req, res,
      { status: 500, error: "Internal server error", details: error.message },
      "updateProducts_Batch", 500
    );
  } finally {
    // `.release()` returns a pooled connection to the pool; `.end()` would
    // destroy it and permanently shrink the pool on every call.
    connection.release();
  }
};

// ---------------------------------------------------------------------------
// addNewCandy_with_image
// ---------------------------------------------------------------------------

const addNewCandy_with_image = async (req, res) => {
  logRequestDetails(req, "addNewCandy_with_image");

  try {
    const {
      addProductListRequest,
      addProductPricingRequest,
      addAvailableItemsRequest,
      addPriceTracing
    } = req.body;

    const file = req.file; // multer adds the file here

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

    // Must be awaited: without it, the image insert below could run before
    // the candy records finished writing, and any error thrown inside
    // addNewCandy_function would become an unhandled promise rejection
    // instead of being caught by this try/catch.
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

    // This is Postgres syntax ($1/$2/$3, ON CONFLICT), so it belongs under
    // pgQuery, not mysqlQuery.
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
    // Without this catch, any failure above (missing file aside) becomes an
    // unhandled promise rejection and the client hangs until it times out.
    console.error("🔥 addNewCandy_with_image failed:", error);
    return logResponseDetails(
      req, res,
      { success: false, message: error.message || String(error) },
      "addNewCandy_with_image", 500
    );
  }
};

// ---------------------------------------------------------------------------
// addNewCandy
// ---------------------------------------------------------------------------

const addNewCandy = async (req, res) => {
  logRequestDetails(req, "addNewCandy");

  const { addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing } = req.body;

  let connection;
  try {
    connection = await getConnection();
  } catch (err) {
    console.error("🔥 Error getting MySQL connection:", err);
    return res.status(500).json({ message: 'Error getting MySQL connection' });
  }

  try {
    await connection.beginTransaction();

    try {
      const productResult = await addProductRecord(addProductListRequest, connection);
      const yummyResult = await addYummyRecord(addProductPricingRequest, connection);
      const available_itemsResult = await addAvailableItems(addAvailableItemsRequest, connection);
      const price_tracing_Result = await addPriceTrace(addPriceTracing, connection);

      // Must be awaited so the success response below only fires once the
      // commit has actually finished.
      await connection.commit();

    } catch (error) {
      await connection.rollback();
      const errorMessage = `${getLongTime()}: 🔥 Rollback Operation: ${error}`;
      console.error(errorMessage);

      if (!res.headersSent) {
        return logResponseDetails(
          req, res,
          { status: 500, success: false, message: errorMessage },
          "addNewCandy", 500
        );
      }
    } finally {
      connection.release();

      if (!res.headersSent) {
        console.log('✅ Transaction completed successfully. All records added. for productId:', addProductListRequest.productId);
        return logResponseDetails(
          req, res,
          { status: 200, success: true, message: `${getLongTime()}: Operation completed successfully` },
          "addNewCandy", 200
        );
      }
    }
  } catch (err) {
    console.error("🔥 Unexpected error in addNewCandy:", err);
    if (!res.headersSent) {
      return res.status(500).json({ message: 'Unexpected error in addNewCandy' });
    }
  }
};

async function addNewCandy_function(addProductListRequest, addProductPricingRequest, addAvailableItemsRequest, addPriceTracing) {
  console.log("" + ' \n Add Product Request:', addProductListRequest);
  console.log("" + '\n Add Yummy Request:', addProductPricingRequest);
  console.log("" + '\n Add Available Items:', addAvailableItemsRequest);
  console.log("" + '\n Add Price Tracing:', addPriceTracing);

  const productResult = await addProductRecord(addProductListRequest);
  const yummyResult = await addYummyRecord(addProductPricingRequest);
  const available_itemsResult = await addAvailableItems(addAvailableItemsRequest);
  const price_tracing_Result = await addPriceTrace(addPriceTracing);

  console.log(productResult + ' \n Add Product Request:', addProductListRequest);
  console.log(yummyResult + '\n Add Yummy Request:', addProductPricingRequest);
  console.log(available_itemsResult + '\n Add Available Items:', addAvailableItemsRequest);
  console.log(price_tracing_Result + '\n Add Price Tracing:', addPriceTracing);
}

// ---------------------------------------------------------------------------
// deleteAllProductData / deleteItem
// ---------------------------------------------------------------------------

export const deleteAllProductData = async (req, res) => {
  const productId = req.params.id;

  if (!productId) {
    return logResponseDetails(
      req, res,
      { success: false, message: "Missing product ID for deleting all product data" },
      "deleteAllProductData", 400
    );
  }

  const dataTargets = [
    { key: "productPricing", table: "productPricing" },
    { key: "availableItems", table: "availableItems" },
    { key: "cartList", table: "cartList" },
    { key: "estimates", table: "estimates" },
    { key: "productItemPricing", table: "productItemPricing" },
    { key: "productList", table: "productList" },
    { key: "sodEodItems", table: "sodEodItems" },
    { key: "stockItems", table: "stockItems" },
  ];

  let deleteResults = [];

  for (const { key, table } of dataTargets) {
    const query = `DELETE FROM \`${table}\` WHERE productId = ?`;
    const values = [productId];

    try {
      console.log(`🔄 Deleting from ${table} WHERE productId=${productId}`);
      const mysqlResult = await removeCachedAndQuery(key, { mysqlQuery: { text: query, values } });

      if (mysqlResult?.affectedRows > 0) {
        console.log(`✅ Deleted from ${table}: ${mysqlResult.affectedRows} rows`);
      } else {
        console.warn(`⚠️ No matching rows in ${table} for productId: ${productId}`);
      }

      deleteResults.push({ table, affectedRows: mysqlResult?.affectedRows || 0 });

    } catch (err) {
      console.error(`🔥 Error deleting from ${table}: ${err.message}`);
      return logResponseDetails(
        req, res,
        { success: false, message: `Error deleting from ${table}: ${err.message}` },
        "deleteAllProductData", 500
      );
    }
  }

  return logResponseDetails(
    req, res,
    { success: true, message: "Deletion completed across all tables", results: deleteResults },
    "deleteAllProductData", 200
  );
};

const deleteItem = async (req, res) => {
  logRequestDetails(req, "deleteItem");

  const { productId } = req.body;
  console.log(`${getLongTime()}: 🧹 Deleting productId: [${productId}]`);

  try {
    // deleteAllProductData is an Express-style handler expecting (req, res)
    // and reads req.params.id, so it must be called with a req-shaped
    // object, not the bare productId. It already sends its own response via
    // logResponseDetails, so we return its result directly.
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

// ---------------------------------------------------------------------------
// Reusable record inserters
// ---------------------------------------------------------------------------

async function addProductRecord(addProductListRequest, mySqlConnection) {
  console.log(getLongTime() + ": addProductRecord called..!");

  const key = "productList";
  const query = `INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url) VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE 
      productName = VALUES(productName),
      productFlavor = VALUES(productFlavor),
      productPrice = VALUES(productPrice),
      image_url = VALUES(image_url)`;

  // Identifiers are quoted here because Postgres folds unquoted identifiers
  // to lowercase (productid, productname, ...), which wouldn't match the
  // real camelCase columns.
  const pgInsertQuery = `
    INSERT INTO productList ("productId", "productName", "productFlavor", "productPrice", image_url)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT ("productId") DO UPDATE SET
      "productName" = EXCLUDED."productName",
      "productFlavor" = EXCLUDED."productFlavor",
      "productPrice" = EXCLUDED."productPrice",
      image_url = EXCLUDED.image_url
  `;

  const replacements = [
    addProductListRequest.productId, addProductListRequest.productName,
    addProductListRequest.productFlavor, addProductListRequest.productPrice,
    addProductListRequest.image_url
  ];

  try {
    return await addCachedAndQuery(key, {
      mysqlQuery: { text: query, values: replacements },
      pgQuery: { text: pgInsertQuery, values: replacements }
    });
  } catch (error) {
    // mySqlConnection isn't passed by every caller (e.g. addNewCandy_function
    // calls this with no connection at all), so guard before calling
    // .rollback() to avoid masking the real error with a TypeError.
    if (mySqlConnection) {
      await mySqlConnection.rollback();
    }
    console.log(`❌ Failed: Rollback occurred on key [${key}] \n ${error}`);
    throw new Error(`Exception on ${key}: ${error.message || error}`, { cause: error });
  }
}

async function addYummyRecord(addProductPricingRequest, mySqlConnection) {
  console.log("addYummyRecord called..!", addProductPricingRequest);

  const key = "productPricing";
  const query = `INSERT INTO productPricing (productId, costPerItem, sellingPrice, productCommission, productProfit, productQuantity, productSize)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      costPerItem = VALUES(costPerItem),
      sellingPrice = VALUES(sellingPrice),
      productCommission = VALUES(productCommission),
      productProfit = VALUES(productProfit),
      productQuantity = VALUES(productQuantity),
      productSize = VALUES(productSize)`;

  const pgInsertQuery = `
    INSERT INTO productPricing ("productId", "costPerItem", "sellingPrice", "productCommission", "productProfit", "productQuantity", "productSize")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT ("productId") DO UPDATE SET
      "costPerItem" = EXCLUDED."costPerItem",
      "sellingPrice" = EXCLUDED."sellingPrice",
      "productCommission" = EXCLUDED."productCommission",
      "productProfit" = EXCLUDED."productProfit",
      "productQuantity" = EXCLUDED."productQuantity",
      "productSize" = EXCLUDED."productSize"
  `;

  const replacements = [
    addProductPricingRequest.productId,
    addProductPricingRequest.costPerItem,
    addProductPricingRequest.sellingPrice,
    addProductPricingRequest.productCommission,
    addProductPricingRequest.productProfit,
    addProductPricingRequest.productQuantity,
    addProductPricingRequest.productSize
  ];

  try {
    return await addCachedAndQuery(key, {
      mysqlQuery: { text: query, values: replacements },
      pgQuery: { text: pgInsertQuery, values: replacements }
    });
  } catch (error) {
    if (mySqlConnection) {
      await mySqlConnection.rollback();
    }
    console.log(`❌ Failed: Rollback occurred on key [${key}] \n ${error}`);
    throw new Error(`Exception on ${key}: ${error.message || error}`, { cause: error });
  }
}

async function addAvailableItems(addAvailableItemsRequest, mySqlConnection) {
  console.log("addAvailableItems called..!");

  const key = "availableItems";
  const query = `INSERT INTO availableItems (productId, itemsRemaining, lastUpdated) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      itemsRemaining = VALUES(itemsRemaining),
      lastUpdated = VALUES(lastUpdated)`;

  const pgInsertQuery = `
    INSERT INTO availableItems ("productId", "itemsRemaining", "lastUpdated")
    VALUES ($1, $2, $3)
    ON CONFLICT ("productId") DO UPDATE SET
      "itemsRemaining" = EXCLUDED."itemsRemaining",
      "lastUpdated" = EXCLUDED."lastUpdated"
  `;

  const replacements = [
    addAvailableItemsRequest.productId,
    addAvailableItemsRequest.itemsRemaining,
    formatForMySQL(addAvailableItemsRequest.lastUpdated)
  ];

  try {
    return await addCachedAndQuery(key, {
      mysqlQuery: { text: query, values: replacements },
      pgQuery: { text: pgInsertQuery, values: replacements }
    });
  } catch (error) {
    if (mySqlConnection) {
      await mySqlConnection.rollback();
    }
    console.log(`❌ Failed: Rollback occurred on key [${key}] \n ${error}`);
    throw new Error(`Exception on ${key}: ${error.message || error}`, { cause: error });
  }
}

async function addPriceTrace(addPriceTracing, mySqlConnection) {
  const key = "priceTracing";
  const query = `INSERT INTO priceTracing (productId, accAmount, date) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      accAmount = VALUES(accAmount),
      date = VALUES(date)`;

  const pgInsertQuery = `
    INSERT INTO priceTracing ("productId", "accAmount", date)
    VALUES ($1, $2, $3)
    ON CONFLICT ("productId") DO UPDATE SET
      "accAmount" = EXCLUDED."accAmount",
      date = EXCLUDED.date
  `;

  const replacements = [
    addPriceTracing.productId,
    addPriceTracing.accAmount,
    formatForMySQL(addPriceTracing.lastUpdated)
  ];

  try {
    return await addCachedAndQuery(key, {
      mysqlQuery: { text: query, values: replacements },
      pgQuery: { text: pgInsertQuery, values: replacements }
    });
  } catch (error) {
    if (mySqlConnection) {
      await mySqlConnection.rollback();
    }
    console.log(`❌ Failed: Rollback occurred on key [${key}] \n ${error}`);
    throw new Error(`Exception on ${key}: ${error.message || error}`, { cause: error });
  }
}

async function addEstimates(estimate, mySqlConnection) {
  const key = "estimates";

  const values = [
    estimate.productId,
    estimate.estimatedSelling,
    estimate.actualSelling,
    formatForMySQL(estimate.lastUpdated),
  ];

  // Upsert, so re-sending an existing productId updates instead of failing
  // on uk_productId. (This is what fixed the "Duplicate entry ... for key
  // 'estimates.uk_productId'" crash — make sure the running container is
  // actually built from this version, not a stale image.)
  const mysqlQuery = {
    text: `
      INSERT INTO estimates (productId, estimatedSelling, actualSelling, lastUpdated)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        estimatedSelling = VALUES(estimatedSelling),
        actualSelling = VALUES(actualSelling),
        lastUpdated = VALUES(lastUpdated)
    `,
    values,
  };

  const pgQuery = {
    text: `
      INSERT INTO estimates ("productId", "estimatedSelling", "actualSelling", "lastUpdated")
      VALUES ($1, $2, $3, $4)
      ON CONFLICT ("productId") DO UPDATE SET
        "estimatedSelling" = EXCLUDED."estimatedSelling",
        "actualSelling" = EXCLUDED."actualSelling",
        "lastUpdated" = EXCLUDED."lastUpdated"
    `,
    values,
  };

  try {
    return await addCachedAndQuery(key, { pgQuery, mysqlQuery });
  } catch (error) {
    if (mySqlConnection) {
      try {
        await mySqlConnection.rollback();
      } catch (rollbackError) {
        console.error(`Rollback failed on key [${key}]:`, rollbackError);
      }
    }
    console.error(`❌ Failed on key [${key}]:`, error);
    throw new Error(`Exception on ${key}: ${error.message || error}`, { cause: error });
  }
}

async function addSodEod(sodEodList, mySqlConnection) {
  const key = "sodEodItems";

  // Upsert added (matching addEstimates) — if sodEodItems has a unique
  // constraint on productId, a plain INSERT will throw the same
  // "Duplicate entry ... uk_productId" error this table's siblings had.
  // Adjust/remove ON DUPLICATE KEY UPDATE if this table intentionally
  // allows multiple historical rows per productId.
  const query = `
    INSERT INTO sodEodItems (productId, productName, itemsRemaining, itemsTaken, lastUpdated)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      productName = VALUES(productName),
      itemsRemaining = VALUES(itemsRemaining),
      itemsTaken = VALUES(itemsTaken),
      lastUpdated = VALUES(lastUpdated)
  `;

  const replacements = [
    sodEodList.productId,
    sodEodList.productName,
    sodEodList.itemsRemaining,
    sodEodList.itemsTaken,
    formatForMySQL(sodEodList.lastUpdated),
  ];

  try {
    return await addCachedAndQuery(key, { mysqlQuery: { text: query, values: replacements } });
  } catch (error) {
    if (mySqlConnection) {
      await mySqlConnection.rollback();
    }
    console.log(`❌ Failed: Rollback occurred on key [${key}] \n ${error}`);
    throw new Error(`Exception on ${key}: ${error.message || error}`, { cause: error });
  }
}

async function addProductItemPricing(productItemPricing, mySqlConnection) {
  const key = "productItemPricing";

  // Upsert added for the same reason as addSodEod above — adjust/remove if
  // this table intentionally allows multiple rows per productId.
  const query = `
    INSERT INTO productItemPricing (productId, productDescription, itemGroup, itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      productDescription = VALUES(productDescription),
      itemGroup = VALUES(itemGroup),
      itemsRemainder = VALUES(itemsRemainder),
      costOfRemainder = VALUES(costOfRemainder),
      groupedQuantity = VALUES(groupedQuantity),
      groupedProfit = VALUES(groupedProfit),
      groupedCommission = VALUES(groupedCommission)
  `;

  const replacements = [
    productItemPricing.productId, productItemPricing.productDescription, productItemPricing.itemGroup,
    productItemPricing.itemsRemainder, productItemPricing.costOfRemainder, productItemPricing.groupedQuantity,
    productItemPricing.groupedProfit, productItemPricing.groupedCommission
  ];

  try {
    return await addCachedAndQuery(key, { mysqlQuery: { text: query, values: replacements } });
  } catch (error) {
    if (mySqlConnection) {
      await mySqlConnection.rollback();
    }
    console.log(`❌ Failed: Rollback occurred on key [${key}] \n ${error}`);
    throw new Error(`Exception on ${key}: ${error.message || error}`, { cause: error });
  }
}

// ---------------------------------------------------------------------------
// addListOfSodEod
// ---------------------------------------------------------------------------

const addListOfSodEod = async (req, res) => {
  const { sodEOd, availableItems, estimates, pricingTracing, ProductItemPricing } = req.body;

  console.log(`pricingTracing: ${JSON.stringify(pricingTracing)} \n sodEOd: ${JSON.stringify(sodEOd)}, \n availableItems: ${JSON.stringify(availableItems)}, \n estimates: ${JSON.stringify(estimates)}`);

  let dbConnection;
  try {
    dbConnection = await getConnection();
  } catch (err) {
    console.error("🔥 Error getting MySQL connection:", err);
    return res.status(500).json({ message: 'Error getting MySQL connection' });
  }

  // Everything below used to run with no try/catch at all: any thrown
  // error (e.g. the duplicate-key error from addEstimates) became an
  // UnhandledPromiseRejection, the client request just hung forever, and
  // dbConnection was never released — leaking a pooled connection on every
  // failure. Wrapped in try/catch/finally to fix both.
  try {
    const sodEodResponse = await addSodEod(sodEOd, dbConnection);
    const availableItemsResponse = await addAvailableItems(availableItems, dbConnection);
    const estimateResponse = await addEstimates(estimates, dbConnection);
    // Was previously `await (ProductItemPricing);` — it just awaited the
    // raw request object instead of calling addProductItemPricing, so no
    // productItemPricing row was ever written.
    const productItemPricingResponse = await addProductItemPricing(ProductItemPricing, dbConnection);
    const pricetracingReponse = await addPriceTrace(pricingTracing, dbConnection);

    const response = {
      sodEodResponse,
      availableItemsResponse,
      estimateResponse,
      productItemPricingResponse, // was previously omitted from the response
      pricetracingReponse
    };

    return logResponseDetails(req, res, response, "addListOfSodEod", 200);

  } catch (error) {
    console.error(`🔥 addListOfSodEod failed:`, error);
    return logResponseDetails(
      req, res,
      { success: false, message: error.message || String(error) },
      "addListOfSodEod", 500
    );
  } finally {
    dbConnection.release();
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