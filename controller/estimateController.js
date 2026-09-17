import TimeUtils from '../utils/Time.js';

import ControllerHandler from "../utils/ControllerHandler.js";
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';

// ⚠️ TODO: formatForMySQL(...) is used below (addEstimates, updateEstimates)
// but is not imported anywhere in this file. As written it will throw
// `ReferenceError: formatForMySQL is not defined` before any DB call runs.
// Add the correct import for it, e.g.:
//   import { formatForMySQL } from '../utils/whereverItLives.js';

const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;

const cacheKey = 'estimates'; // Key to store the list in Redis


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
        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs, not positional (query, replacements) args.
        const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
        const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

        const result = await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });
        result.info = cacheKey;

        return logResponseDetails(req, res, {
          success: true,
          message: `ID [${productId}] deleted successfully`,
        }, cacheKey, 200)

      } catch (error) {
        return logResponseDetails(req, res, {
          success: false,
          message: "Error occurred while trying to delete.",
          error,
        }, cacheKey, 200)
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


const getEstimates = async (req, res) => {

  logRequestDetails(req, "getEstimates");
  console.log(formattedDate() + ` ${cacheKey} backend started...`);

  // NOTE: no WHERE clause here, so no `values` needed on either query.
  const mysqlQuery = { text: `SELECT * FROM ${cacheKey}` };
  const pgQuery = { text: `SELECT * FROM ${cacheKey}` };
  console.log(formattedDate() + "Now Quering : Key[" + cacheKey + "] mysql:[" + mysqlQuery.text + "] pgSql:" + pgQuery.text + "]");

  try {

    const data = await getCachedOrQuery(cacheKey, {
      pgQuery,
      mysqlQuery,
      // Optional: if a row set is only found in MySQL, sync it into Postgres
      // in the background so future reads don't need MySQL again. Adjust the
      // column list here if the `estimates` table has more/different columns.
      pgBackfillQuery: (rows) => {
        if (!rows || rows.length === 0) return null;
        const values = [];
        const rowPlaceholders = rows.map((row, i) => {
          const base = i * 4;
          values.push(row.productId, row.estimatedSelling, row.actualSelling, row.lastUpdated);
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        });
        return {
          text: `
            INSERT INTO estimates (productId, estimatedSelling, actualSelling, lastUpdated)
            VALUES ${rowPlaceholders.join(', ')}
            ON CONFLICT (productId) DO UPDATE SET
              estimatedSelling = EXCLUDED.estimatedSelling,
              actualSelling = EXCLUDED.actualSelling,
              lastUpdated = EXCLUDED.lastUpdated
          `,
          values,
        };
      },
    });
    return logResponseDetails(req, res, data, cacheKey, 200);

  } catch (error) {
    console.error(formattedDate() + `getCachedOrQuery error for ${cacheKey}:`, error);
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: `${formattedDate()} Error fetching ${cacheKey}`,
      error: error.message || error,
    }, cacheKey, 500);
  }

}

// Adding to Pricing Table
const addEstimates = async (req, res) => {

  logRequestDetails(req, cacheKey);

  try {

    /*
            productId: number;
            estimatedSelling:number;
            actualSelling:number;
            lastUpdated:Date;
    */

    const { productId, estimatedSelling, actualSelling, _lastUpdated } = req.body;
    const lastUpdated = formatForMySQL(_lastUpdated);
    console.log("id =>" + productId);
    console.log("estimatedSelling => " + estimatedSelling);
    console.log("actualSelling  => " + actualSelling);
    console.log("lastUpdated => " + lastUpdated);


    if (productId === undefined || productId === null ||
      estimatedSelling === undefined || estimatedSelling === null ||
      actualSelling === undefined || actualSelling === null ||
      lastUpdated === undefined || lastUpdated === null) {

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
          INSERT INTO estimates (productId, estimatedSelling, actualSelling, lastUpdated)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            estimatedSelling = VALUES(estimatedSelling),
            actualSelling = VALUES(actualSelling),
            lastUpdated = VALUES(lastUpdated)
        `,
        values: [productId, estimatedSelling, actualSelling, lastUpdated],
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
        values: [productId, estimatedSelling, actualSelling, lastUpdated],
      };

      // Was previously fired without `await` and with no response sent on
      // success — the request would hang until timeout. Both are fixed here.
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
    }, cacheKey, 500)

  }

}

//deletins
const deleteEstimates = async (req, res) => {
  logRequestDetails(req, "deleteEstimates");
  const id = req.body;
  const productId = id;
  console.log(formattedDate() + "ID Pricing to delte: " + productId);

  try {

    console.log("ID Pricing to delte");
    console.log(productId);

    if (!productId) {
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "PLease provide student Id => " + productId
      }, cacheKey, 500)
    } else {

      try {

        const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
        // `pgQuery` was being built but never passed through before — now it's used.
        const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

        await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

        return logResponseDetails(req, res, {
          status: 200,
          success: true,
          message: "ID [" + productId + "] DELETED Successfully"
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

// UPdating 
const updateEstimates = async (req, res) => {
  logRequestDetails(req, "updateEstimates");
  const { productId, estimatedSelling, actualSelling, _lastUpdated } = req.body;
  const lastUpdated = formatForMySQL(_lastUpdated);

  console.log("id =>" + productId);
  console.log("estimatedSelling => " + estimatedSelling);
  console.log("actualSelling  => " + actualSelling);
  console.log("lastUpdated => " + lastUpdated);

  try {

    if (productId === undefined || productId === null ||
      estimatedSelling === undefined || estimatedSelling === null ||
      actualSelling === undefined || actualSelling === null ||
      lastUpdated === undefined || lastUpdated === null) {

      console.log("id =>" + productId);
      console.log("estimatedSelling => " + estimatedSelling);
      console.log("actualSelling  => " + actualSelling);
      console.log("lastUpdated => " + lastUpdated);

      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "Invalid IR Or provide id => " + productId
      }, cacheKey, 404)

    } else {

      try {
        const mysqlQuery = {
          text: `UPDATE estimates SET estimatedSelling = ?, actualSelling = ?, lastUpdated = ? WHERE productId = ?`,
          values: [estimatedSelling, actualSelling, lastUpdated, productId],
        };
        const pgQuery = {
          text: `UPDATE estimates SET "estimatedSelling" = $1, "actualSelling" = $2, "lastUpdated" = $3 WHERE "productId" = $4`,
          values: [estimatedSelling, actualSelling, lastUpdated, productId],
        };

        let result;
        try {
          result = await updateCachedOrQuery(cacheKey, { pgQuery, mysqlQuery });
          console.log('✅ productItemPricing updated successfully:', result);
        } catch (error) {
          console.error('❌ Error updating productItemPricing:', error);
          throw error;
        }

        // Check if result is valid and rows were affected
        if (!result || (typeof result.affectedRows === 'number' && result.affectedRows === 0) || (typeof result.rowCount === 'number' && result.rowCount === 0)) {
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
            message: "✅ Available items updated successfully",
            result
          }, cacheKey, 200);
        }
      } catch (error) {
        console.log(error);
        // Previously referenced _name/_flavor/_price/_image_url here, none of
        // which exist in this function — that threw a ReferenceError and
        // masked whatever the real update error was. Fixed to reference the
        // actual fields this function deals with.
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: `Something wrong happened while updating the record. productId=${productId} estimatedSelling=${estimatedSelling} actualSelling=${actualSelling} lastUpdated=${lastUpdated}`,
          error
        }, cacheKey, 200)
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

export default { removeEstimateById, getEstimates, addEstimates, deleteEstimates, updateEstimates }