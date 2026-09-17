import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';
 import { getConnection } from '../config/db.js';

const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;


const cacheKey = 'stockedItems'; // Key to store the list in Redis

const getStockList = async (req, res) => {
  logRequestDetails(req, "getStockList");
  console.log(`${cacheKey} backend started...`);

  const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
  const _pgQuery = `SELECT * FROM ${cacheKey}`;
  console.log("Now Quering : Key[" + cacheKey + "] mysl:[" + _mysqlQuery + "] pgSql:" + _pgQuery + "]");

  try {
    // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
    // { text, values } specs, not positional (mysqlQuery, pgQuery) args.
    const data = await getCachedOrQuery(cacheKey, {
      mysqlQuery: { text: _mysqlQuery },
      pgQuery: { text: _pgQuery },
    });

    // NOTE: this used to call res.status(200).send(data) directly,
    // bypassing logResponseDetails entirely — this endpoint's requests
    // never got logged, unlike every other endpoint in this codebase.
    // Routed through logResponseDetails instead.
    return logResponseDetails(req, res, data, cacheKey, 200);

  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    // NOTE: this also used to bypass logResponseDetails with a raw
    // res.status(500).send(...) call. Routed through logResponseDetails.
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: `Error fetching ${cacheKey}`,
      error: error.message || error,
    }, cacheKey, 500);
  }

}

const deleteStock = async (req, res) => {
  logRequestDetails(req, "deleteStock");
  try {

    const productId = req.body.id;
    // NOTE: this used to check `!lastUpdated` — `lastUpdated` is never
    // declared anywhere in this function, so this threw a ReferenceError
    // on every call instead of validating the actually-relevant
    // `productId`. Fixed to check `productId`.
    if (!productId) {
      // NOTE: this used to call logResponseDetails with only 3 arguments
      // (missing cacheKey and the status code), unlike every other
      // endpoint in this file/codebase. Added both.
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "PLease provide student Id => " + productId
      }, cacheKey, 404)
    } else {

      try {
        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs, not a positional (mysqlQuery,
        // replacements) call — Postgres was never deleted from at all
        // before. Added the matching pgQuery, quoted.
        const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
        const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

        const result = await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

        return logResponseDetails(req, res, {
          status: 200,
          success: true,
          message: `ID [${productId}] deleted successfully`,
          result
        }, cacheKey, 200)

      } catch (error) {
        // NOTE: missing cacheKey/status args here too — added.
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: "Error occurred while trying to delete.",
          error,
        }, cacheKey, 500)
      }

    }

  } catch (error) {
    console.log(error)
    // NOTE: this used to bypass logResponseDetails with a raw
    // res.status(500).send(...) call. Routed through logResponseDetails.
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in Deleting Student",
      error
    }, cacheKey, 500)
  }

}

// NOTE: this inserted into a table literally named `stockItems`, while
// every other function in this file reads/writes/caches under the
// module-level cacheKey `'stockedItems'`. Caching this insert under
// `stockedItems` would tie a completely different table's data to that
// table's cache key. `stockItems` (current per-product stock: name,
// flavor, price, quantity) and `stockedItems` (individual stocking events:
// date, price, quantity) look like two distinct tables here, so this now
// uses its own cache key that actually matches the table it writes to.
// Worth double-checking against your schema that these are meant to be two
// separate tables rather than one misnamed table.
const stockItemsCacheKey = 'stockItems';

const addStock = async (req, res) => {
  logRequestDetails(req, "addStock");
  try {
    const { productId, productName, productFlavor, productPrice, lastUpdated, productQuantity } = req.body;

    console.log("id =>" + productId);
    console.log("name => " + productName);
    console.log("flavor  => " + productFlavor);
    console.log("price => " + productPrice);
    console.log("lastUpdated=> " + lastUpdated);
    console.log("productQuantity => " + productQuantity);


    if (
      productId == null || productName == null || productFlavor == null || productPrice == null || lastUpdated == null || productQuantity == null
      || productId == undefined || productName == undefined || productFlavor == undefined || productPrice == undefined || lastUpdated == undefined || productQuantity == undefined

    ) {
      // NOTE: this used to bypass logResponseDetails with a raw
      // res.status(500).send(...) call. Routed through logResponseDetails.
      return logResponseDetails(req, res, {
        status: 400,
        success: false,
        message: "PLease Provide all fields"
      }, stockItemsCacheKey, 400)

    } else {

      // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
      // { text, values } specs, not a positional (query, replacements)
      // call — Postgres was never written to at all before. Added the
      // matching pgQuery, quoted.
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
        values: [productId, productName, productFlavor, productPrice, lastUpdated, productQuantity],
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
        values: [productId, productName, productFlavor, productPrice, lastUpdated, productQuantity],
      };

      // NOTE: this call used to be fired without `await`, its result was
      // never checked, and no response was ever sent back to the client —
      // the request would hang until it timed out. Both are fixed here.
      const result = await addCachedAndQuery(stockItemsCacheKey, { pgQuery, mysqlQuery });

      return logResponseDetails(req, res, {
        status: 200,
        success: true,
        message: `[${productId}] added/updated successfully`,
        result,
      }, stockItemsCacheKey, 200)

    }

  } catch (error) {
    console.log(error)
    // NOTE: this used status 404 for a generic catch-all error, and
    // bypassed logResponseDetails with a raw res.status(404).send(...)
    // call. Changed to 500 (matching every other catch block in this
    // codebase) and routed through logResponseDetails.
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in create Student API ",
      error
    }, stockItemsCacheKey, 500)

  }

}

const addStockedItems = async (req, res) => {
  logRequestDetails(req, "addStockedItems");
  const { productId, stockDate, stockId, stockPrice, stockQuantity } = req.body;


  try {

    console.log("id =>" + productId);
    console.log("stockDate => " + stockDate);
    console.log("stockId  => " + stockId);
    console.log("stockPrice => " + stockPrice);
    console.log("stockQuantity => " + stockQuantity);


    if (
      productId == null || stockDate == null || stockId == null || stockPrice == null || stockQuantity == null
      || productId == undefined || stockDate == undefined || stockId == undefined || stockPrice == undefined || stockQuantity == undefined

    ) {
      // NOTE: this used to bypass logResponseDetails with a raw
      // res.status(500).send(...) call. Routed through logResponseDetails.
      return logResponseDetails(req, res, {
        status: 400,
        success: false,
        message: "PLease Provide all fields",
        response: "There are missing fields"
      }, cacheKey, 400)

    } else {

      // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
      // { text, values } specs, not a positional (query, replacements)
      // call — Postgres was never written to at all before. Added the
      // matching pgQuery, quoted.
      const mysqlQuery = {
        text: `
          INSERT INTO stockedItems (productId, stockDate, stockId, stockPrice, stockQuantity)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            stockDate = VALUES(stockDate),
            stockId = VALUES(stockId),
            stockPrice = VALUES(stockPrice),
            stockQuantity = VALUES(stockQuantity)
        `,
        values: [productId, stockDate, stockId, stockPrice, stockQuantity],
      };

      const pgQuery = {
        text: `
          INSERT INTO stockedItems ("productId", "stockDate", "stockId", "stockPrice", "stockQuantity")
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT ("stockId") DO UPDATE SET
            "stockDate" = EXCLUDED."stockDate",
            "productId" = EXCLUDED."productId",
            "stockPrice" = EXCLUDED."stockPrice",
            "stockQuantity" = EXCLUDED."stockQuantity"
        `,
        values: [productId, stockDate, stockId, stockPrice, stockQuantity],
      };

      const result = await addCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

      // NOTE: this used to send a success response unconditionally,
      // without checking whether the insert actually returned anything,
      // and it bypassed logResponseDetails with a raw
      // res.status(200).send(...) call. Added a basic result check and
      // routed through logResponseDetails.
      if (!result) {
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: "Error: could not add stocked item",
        }, cacheKey, 500)
      }

      return logResponseDetails(req, res, {
        status: 200,
        success: true,
        message: "Stocked Item Added Successfully",
        result
      }, cacheKey, 200)

    }

  } catch (error) {
    console.log(error)
    // NOTE: this used status 404 for a generic catch-all error, and
    // bypassed logResponseDetails with a raw res.status(404).send(...)
    // call. Changed to 500 (matching every other catch block in this
    // codebase) and routed through logResponseDetails.
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in create Student API ",
      error
    }, cacheKey, 500)

  }

}

const removeStockedItems = async (req, res) => {
  logRequestDetails(req, "removeStockedItems");


  const productId = req.params.id; // Extract student ID from the request URL

  try {

    console.log(formattedDate() + "ID Pricing to delte: " + productId);

    if (!productId) {
      // NOTE: this used to bypass logResponseDetails with a raw
      // res.status(404).send(...) call. Routed through logResponseDetails.
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "PLease provide student Id => " + productId
      }, cacheKey, 404)
    } else {

      try {
        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs, not a positional (mysqlQuery,
        // replacements) call — Postgres was never deleted from at all
        // before. Added the matching pgQuery, quoted.
        const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
        const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

        const result = await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

        return logResponseDetails(req, res, {
          status: 200,
          success: true,
          message: `ID [${productId}] deleted successfully`,
        }, cacheKey, 200);

      } catch (error) {
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: "Error occurred while trying to delete.",
          error,
        }, cacheKey, 500);
      }

    }

  } catch (error) {
    // NOTE: this used to call logResponseDetails with only 3 arguments
    // (missing cacheKey and the status code). Added both.
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in Deleting Student",
      error
    }, cacheKey, 500)
  }

}


export default { addStock, getStockList, deleteStock, addStockedItems, removeStockedItems };