import { formatForMySQL } from '../utils/formatForMySQL.js';
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

const cacheKey = 'priceTracing'; // Key to store the list in Redis
let keyExist = false;

const removeEstimateById = async (req, res) => {

  logRequestDetails(req, "removeEstimateById");

  try {

    const productId = req.params.id;

    if (!productId) {
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "PLease provide student Id => " + productId
      }, cacheKey, 404)
    } else {

      try {
        // NOTE: this previously called `dbSequelize.query(...)` — dbSequelize
        // was never imported or defined anywhere in this file, so every call
        // threw ReferenceError before touching the database. Rewritten to use
        // the same ControllerHandler { pgQuery, mysqlQuery } pattern as the
        // rest of this file (a pgQuery was also missing entirely).
        const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
        const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

        const data = await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });
        data.info = cacheKey;

        return logResponseDetails(req, res, {
          status: 200,
          success: true,
          message: data
        }, cacheKey, 200)

      } catch (error) {
        console.log(error)
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: "Something happening while trying to delete",
          error
        }, cacheKey, 500)
      }
    }

  } catch (error) {
    console.log(error)
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in Deleting Student",
      error
    }, cacheKey, 500)
  }

}

const removePriceTracing = async (req, res) => {
  logRequestDetails(req, "removePriceTracing")
  try {

    const productId = req.body.id;
    if (!productId) {
      // NOTE: body said status 404 but this used to pass 500 as the actual
      // HTTP status — aligned with the body, matching estimates.js.
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "PLease provide student Id => " + productId
      }, cacheKey, 404)
    } else {

      try {
        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs, not positional (query, replacements) args.
        // The old query also used a `??` identifier placeholder for the
        // table name with cacheKey stuffed into replacements — switched to
        // the same trusted-template-literal convention used everywhere else
        // in this codebase, and added the missing pgQuery.
        const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
        const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

        const result = await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

        if (result.affectedRows > 0) {
          return logResponseDetails(req, res, {
            success: true,
            message: `ID [${productId}] deleted successfully`,
          }, cacheKey, 200);
        } else {
          return logResponseDetails(req, res, {
            success: false,
            message: `ID [${productId}] not found in [${cacheKey}]`,
          }, cacheKey, 200);
        }

      } catch (error) {
        return logResponseDetails(req, res, {
          success: false,
          message: "Error occurred while trying to delete.",
          error,
        }, cacheKey, 500);
      }
    }

  } catch (error) {
    return logResponseDetails(req, res, {
      success: false,
      message: "Error in Deleting Student",
      error
    }, cacheKey, 500)
  }

}

const getPriceTracing = async (req, res) => {

  logRequestDetails(req, "getPriceTracing")

  console.log(`${cacheKey} backend started...`);

  // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
  // { text, values } specs, not positional (mysqlQuery, pgQuery) args.
  const mysqlQuery = { text: `SELECT * FROM ${cacheKey}` };
  const pgQuery = { text: `SELECT * FROM ${cacheKey}` };
  console.log("Now Quering : Key[" + cacheKey + "] mysl:[" + mysqlQuery.text + "] pgSql:" + pgQuery.text + "]");

  try {

    const data = await getCachedOrQuery(cacheKey, { pgQuery, mysqlQuery });
    return logResponseDetails(req, res, data, cacheKey, 200);

  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: `Error fetching ${cacheKey}`,
      error: error.message || error,
    }, cacheKey, 500);
  }
}

// Adding to Pricing Table
const addPriceTracing = async (req, res) => {

  logRequestDetails(req, "addPriceTracing")

  try {

    /*
            productId: number;
    estimatedSelling:number;
    actualSelling:number;
    lastUpdated:Date;
        */


    const { productId, accAmount, _lastUpdated } = req.body;
    const lastUpdated = formatForMySQL(_lastUpdated);

    console.log("id =>" + productId);
    console.log("accAmount => " + accAmount);
    console.log("lastUpdated => " + lastUpdated);

    if (productId == null || accAmount == null || lastUpdated == null) {
      return logResponseDetails(req, res, {
        status: 500,
        success: false,
        message: "PLease Provide all fields"
      }, cacheKey, 500)

    } else {

      // Upsert on both tiers, so re-sending the same productId updates
      // rather than throwing a duplicate-key error.
      const mysqlQuery = {
        text: `
          INSERT INTO ${cacheKey} (productId, date, accAmount)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE
            accAmount = VALUES(accAmount),
            date = VALUES(date)
        `,
        values: [productId, lastUpdated, accAmount],
      };

      // NOTE: "date" is a reserved word in Postgres, so it — along with the
      // other camelCase columns — needs to be quoted.
      const pgQuery = {
        text: `
          INSERT INTO ${cacheKey} ("productId", "date", "accAmount")
          VALUES ($1, $2, $3)
          ON CONFLICT ("productId") DO UPDATE SET
            "accAmount" = EXCLUDED."accAmount",
            "date" = EXCLUDED."date"
        `,
        values: [productId, lastUpdated, accAmount],
      };

      // NOTE: this call was previously fired without `await`, its result was
      // never checked, and no response was ever sent back to the client —
      // the request would hang until it timed out. Both are fixed here.
      const result = await addCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

      return logResponseDetails(req, res, {
        success: true,
        message: `[${productId}] added/updated successfully`,
        result,
      }, cacheKey, 200)

    }
  } catch (error) {
    console.log(error)
    return logResponseDetails(req, res, {
      status: 404,
      success: false,
      message: "Error in create Student API ",
      error
    }, cacheKey, 404)

  }

}

//deletins

const deletePriceTracing = async (req, res) => {
  logRequestDetails(req, "deletePriceTracing")
  const productId = req.params.id;

  console.log(`[deletePriceTracing] Requested deletion for productId: ${productId}`);

  if (!productId || isNaN(productId)) {
    // NOTE: was a raw res.status().json() call that skipped logResponseDetails
    // entirely, unlike every other endpoint in this file. Routed through
    // logResponseDetails for consistent logging/response handling.
    return logResponseDetails(req, res, {
      status: 400,
      success: false,
      message: `Invalid or missing productId: ${productId}`
    }, cacheKey, 400);
  }

  try {
    // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
    // { text, values } specs, not positional (query, replacements) args.
    // The old query also used a `??` identifier placeholder for the table
    // name with cacheKey stuffed into replacements, and had no pgQuery.
    const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
    const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

    const result = await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

    if (result.affectedRows > 0) {
      return logResponseDetails(req, res, {
        status: 200,
        success: true,
        message: `ID [${productId}] deleted successfully`,
      }, cacheKey, 200);
    } else {
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: `ID [${productId}] not found in [${cacheKey}]`,
      }, cacheKey, 404);
    }

  } catch (error) {
    console.error(error);
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error occurred while trying to delete.",
      error,
    }, cacheKey, 500);
  }

};

// UPdating 

const updatePriceTracing = async (req, res) => {
  logRequestDetails(req, "updatePriceTracing")

  const { productId, accAmount, _lastUpdated } = req.body;
  const lastUpdated = formatForMySQL(_lastUpdated);
  console.log("++  updatePriceTracing ++ ");
  console.log("id =>" + productId);
  console.log("accAmount => " + accAmount);
  console.log("lastUpdated => " + lastUpdated);

  try {

    if (productId == null || accAmount == null || lastUpdated == null) {

      console.log("id =>" + productId);
      console.log("accAmount => " + accAmount);
      console.log("lastUpdated => " + lastUpdated);

      // NOTE: body said status 404 but this used to pass 500 as the actual
      // HTTP status — aligned with the body, matching estimates.js.
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "Invalid IR Or provide id => " + productId
      }, cacheKey, 404)

    } else {

      try {
        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs, not positional (query, replacements) args.
        // A pgQuery was already being built below but never actually passed
        // through — Postgres was never updated. Wired it in and quoted the
        // camelCase/reserved-word columns.
        const mysqlQuery = {
          text: `UPDATE ${cacheKey} SET accAmount = ?, date = ? WHERE productId = ?`,
          values: [accAmount, lastUpdated, productId],
        };
        const pgQuery = {
          text: `UPDATE ${cacheKey} SET "accAmount" = $1, "date" = $2 WHERE "productId" = $3`,
          values: [accAmount, lastUpdated, productId],
        };

        const result = await updateCachedOrQuery(cacheKey, { pgQuery, mysqlQuery });

        console.log('✅ priceTracing updated successfully:', result);

        // Check if any rows were affected/updated
        if (
          !result ||
          (typeof result.affectedRows === 'number' && result.affectedRows === 0) ||
          (typeof result.rowCount === 'number' && result.rowCount === 0)
        ) {
          // NOTE: body said status 404 but this used to pass 500 as the
          // actual HTTP status — aligned with the body, matching estimates.js.
          return logResponseDetails(req, res, {
            status: 404,
            success: false,
            message: `❌ No rows updated in ${cacheKey}. Invalid productId or no change.`,
            result
          }, cacheKey, 404);
        } else {
          return logResponseDetails(req, res, {
            status: 200,
            success: true,
            message: "✅ priceTracing updated successfully",
            result
          }, cacheKey, 200);
        }
      } catch (error) {
        console.error('❌ Error updating priceTracing:', error);
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: "Something went wrong while updating the record.",
          error
        }, cacheKey, 500);
      }

    }

  } catch (error) {

    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in Update Student API",
      error
    }, cacheKey, 500)
  }
}



export default { removePriceTracing, removeEstimateById, getPriceTracing, addPriceTracing, deletePriceTracing, updatePriceTracing }