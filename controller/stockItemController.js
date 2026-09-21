import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';

const { formattedDate, toSqlFormatOrNull } = TimeUtils;

const {
  getCachedOrQuery,
  addCachedAndQuery,
  removeCachedAndQuery
} = ControllerHandler;

// `stockedItems` = individual stocking events (stockId, stockDate, price, quantity)
const cacheKey = 'stockedItems';
// `stockItems` = current per-product stock (name, flavor, price, quantity)
const stockItemsCacheKey = 'stockItems';

// ---------- helpers ----------

const isMissing = (v) =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

const isNumeric = (v) => !isMissing(v) && Number.isFinite(Number(v));

const errorMessage = (e) => e?.message || String(e);

// Builds the { status, success, ... } body and routes it through logResponseDetails.
const respond = (req, res, key, status, body) =>
  logResponseDetails(req, res, { status, success: status < 400, ...body }, key, status);

const missingFields = (fields) =>
  Object.keys(fields).filter((k) => isMissing(fields[k]));

// ---------- handlers ----------

const getStockList = async (req, res) => {
  logRequestDetails(req, "getStockList");

  const text = `SELECT * FROM ${cacheKey}`;
  console.log(`${formattedDate()} Querying [${cacheKey}]: ${text}`);

  try {
    const data = await getCachedOrQuery(cacheKey, {
      mysqlQuery: { text },
      pgQuery: { text },
    });

    return logResponseDetails(req, res, data, cacheKey, 200);
  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    return respond(req, res, cacheKey, 500, {
      message: `Error fetching ${cacheKey}`,
      error: errorMessage(error),
    });
  }
};

const deleteStock = async (req, res) => {
  logRequestDetails(req, "deleteStock");

  // Accepts { id } or { productId } in the body, or :id in the URL.
  const productId = req.body?.id ?? req.body?.productId ?? req.params?.id;

  if (isMissing(productId)) {
    return respond(req, res, stockItemsCacheKey, 400, {
      message: "Please provide a product Id",
    });
  }

  try {
    // Deletes from stockItems (the table addStock writes to), where
    // productId is the unique key.
    const mysqlQuery = { text: `DELETE FROM ${stockItemsCacheKey} WHERE productId = ?`, values: [productId] };
    const pgQuery = { text: `DELETE FROM ${stockItemsCacheKey} WHERE "productId" = $1`, values: [productId] };

    const result = await removeCachedAndQuery(stockItemsCacheKey, { pgQuery, mysqlQuery });

    return respond(req, res, stockItemsCacheKey, 200, {
      message: `ID [${productId}] deleted successfully`,
      result,
    });
  } catch (error) {
    console.error("deleteStock error:", error);
    return respond(req, res, stockItemsCacheKey, 500, {
      message: "Error occurred while trying to delete stock.",
      error: errorMessage(error),
    });
  }
};

const addStock = async (req, res) => {
  logRequestDetails(req, "addStock");

  try {
    const { productId, productName, productFlavor, productPrice, lastUpdated, productQuantity } = req.body ?? {};

    const missing = missingFields({ productId, productName, productFlavor, productPrice, lastUpdated, productQuantity });
    if (missing.length) {
      return respond(req, res, stockItemsCacheKey, 400, {
        message: "Please provide all fields",
        response: `Missing: ${missing.join(", ")}`,
      });
    }

    if (!isNumeric(productPrice) || !isNumeric(productQuantity)) {
      return respond(req, res, stockItemsCacheKey, 400, {
        message: "productPrice and productQuantity must be numbers",
      });
    }

    // Normalise to 'YYYY-MM-DD HH:MM:SS' (Africa/Johannesburg); reject junk.
    const lastUpdatedSql = toSqlFormatOrNull(lastUpdated);
    if (!lastUpdatedSql) {
      return respond(req, res, stockItemsCacheKey, 400, {
        message: `Invalid lastUpdated date: ${lastUpdated}`,
      });
    }

    const values = [productId, productName, productFlavor, productPrice, lastUpdatedSql, productQuantity];

    const mysqlQuery = {
      text: `
        INSERT INTO stockItems (productId, productName, productFlavor, productPrice, lastUpdated, productQuantity)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          productName = VALUES(productName),
          productFlavor = VALUES(productFlavor),
          productPrice = VALUES(productPrice),
          lastUpdated = VALUES(lastUpdated),
          productQuantity = VALUES(productQuantity)
      `,
      values,
    };

    const pgQuery = {
      text: `
        INSERT INTO stockItems ("productId", "productName", "productFlavor", "productPrice", "lastUpdated", "productQuantity")
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT ("productId") DO UPDATE SET
          "productName" = EXCLUDED."productName",
          "productFlavor" = EXCLUDED."productFlavor",
          "productPrice" = EXCLUDED."productPrice",
          "lastUpdated" = EXCLUDED."lastUpdated",
          "productQuantity" = EXCLUDED."productQuantity"
      `,
      values,
    };

    const result = await addCachedAndQuery(stockItemsCacheKey, { pgQuery, mysqlQuery });

    return respond(req, res, stockItemsCacheKey, 200, {
      message: `[${productId}] added/updated successfully`,
      result,
    });
  } catch (error) {
    console.error("addStock error:", error);
    return respond(req, res, stockItemsCacheKey, 500, {
      message: "Error in addStock API",
      error: errorMessage(error),
    });
  }
};

const addStockedItems = async (req, res) => {
  logRequestDetails(req, "addStockedItems");

  try {
    const { productId, stockDate, stockId, stockPrice, stockQuantity } = req.body ?? {};

    const missing = missingFields({ productId, stockDate, stockId, stockPrice, stockQuantity });
    if (missing.length) {
      return respond(req, res, cacheKey, 400, {
        message: "Please provide all fields",
        response: `Missing: ${missing.join(", ")}`,
      });
    }

    if (!isNumeric(stockPrice) || !isNumeric(stockQuantity)) {
      return respond(req, res, cacheKey, 400, {
        message: "stockPrice and stockQuantity must be numbers",
      });
    }

    const stockDateSql = toSqlFormatOrNull(stockDate);
    if (!stockDateSql) {
      return respond(req, res, cacheKey, 400, {
        message: `Invalid stockDate: ${stockDate}`,
      });
    }

    const values = [productId, stockDateSql, stockId, stockPrice, stockQuantity];

    // Both dialects upsert on stockId and update the same set of columns.
    const mysqlQuery = {
      text: `
        INSERT INTO stockedItems (productId, stockDate, stockId, stockPrice, stockQuantity)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          productId = VALUES(productId),
          stockDate = VALUES(stockDate),
          stockPrice = VALUES(stockPrice),
          stockQuantity = VALUES(stockQuantity)
      `,
      values,
    };

    const pgQuery = {
      text: `
        INSERT INTO stockedItems ("productId", "stockDate", "stockId", "stockPrice", "stockQuantity")
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT ("stockId") DO UPDATE SET
          "productId" = EXCLUDED."productId",
          "stockDate" = EXCLUDED."stockDate",
          "stockPrice" = EXCLUDED."stockPrice",
          "stockQuantity" = EXCLUDED."stockQuantity"
      `,
      values,
    };

    const result = await addCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

    if (!result) {
      return respond(req, res, cacheKey, 500, {
        message: "Error: could not add stocked item",
      });
    }

    return respond(req, res, cacheKey, 200, {
      message: "Stocked Item Added Successfully",
      result,
    });
  } catch (error) {
    console.error("addStockedItems error:", error);
    return respond(req, res, cacheKey, 500, {
      message: "Error in addStockedItems API",
      error: errorMessage(error),
    });
  }
};

const removeStockedItems = async (req, res) => {
  logRequestDetails(req, "removeStockedItems");

  const productId = req.params.id;
  console.log(`${formattedDate()} ID to delete from ${cacheKey}: ${productId}`);

  if (isMissing(productId)) {
    return respond(req, res, cacheKey, 400, {
      message: "Please provide a product Id",
    });
  }

  try {
    const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
    const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

    await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

    return respond(req, res, cacheKey, 200, {
      message: `ID [${productId}] deleted successfully`,
    });
  } catch (error) {
    console.error("removeStockedItems error:", error);
    return respond(req, res, cacheKey, 500, {
      message: "Error occurred while trying to delete.",
      error: errorMessage(error),
    });
  }
};

export default { addStock, getStockList, deleteStock, addStockedItems, removeStockedItems };