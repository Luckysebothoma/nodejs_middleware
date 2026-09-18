import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime } = TimeUtils;
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';
 import { getConnection } from '../config/db.js';


const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
const cacheKey = 'productItemPricing'; // Key to store the list in Redis


const getProductItemPricingList = async (req, res) => {
  logRequestDetails(req, "getProductItemPricingList");
  console.log(`${cacheKey} backend started...`);

  const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
  const _pgQuery = `SELECT * FROM ${cacheKey}`;
  console.log("Now Quering : Key[" + cacheKey + "] mysl:" + _mysqlQuery + "pgSql:" + _pgQuery);

  try {
    // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
    // { text, values } specs, not positional (mysqlQuery, pgQuery) args.
    const data = await getCachedOrQuery(cacheKey, {
      mysqlQuery: { text: _mysqlQuery },
      pgQuery: { text: _pgQuery },
    });

    return logResponseDetails(req, res, data, cacheKey, 200);

  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    // NOTE: this used to bypass logResponseDetails entirely with a raw
    // res.status(500).send(obj, cacheKey, 500) call — res.send() only takes
    // one argument, so the trailing cacheKey/status arguments were silently
    // dropped every time. Routed through logResponseDetails like every
    // other endpoint in this file.
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: `Error fetching ${cacheKey}`,
      error: error.message || error,
    }, cacheKey, 500);
  }

}

// Adding to Pricing Table
const addProductItemPricing = async (req, res) => {
  logRequestDetails(req, "addProductItemPricing");
  console.log("Now addProductItemPricing");

  try {
    const { productId, productDescription, itemGroup, itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission } = req.body;

    console.log("id =>" + productId);
    console.log("productDescription => " + productDescription);
    console.log("itemGroup  => " + itemGroup);
    console.log("itemsRemainder => " + itemsRemainder);
    console.log("costOfRemainder =>" + costOfRemainder);
    console.log("groupedQuantity => " + groupedQuantity);
    console.log("groupedProfit  => " + groupedProfit);
    console.log("groupedProfit  => " + groupedCommission);



    if (
      productId == null || productDescription == null || itemGroup == null || itemsRemainder == null || costOfRemainder == null || groupedQuantity == null || groupedProfit == null || groupedCommission == null
      || productId == undefined || productDescription == undefined || itemGroup == undefined || itemsRemainder == undefined || costOfRemainder == undefined || groupedQuantity == undefined || groupedProfit == undefined || groupedCommission == undefined

    ) {
      // NOTE: this used to bypass logResponseDetails entirely with a raw
      // res.status(500).send(obj, cacheKey, 500) call — the trailing
      // cacheKey/status arguments were silently dropped by res.send().
      // Routed through logResponseDetails like every other endpoint here.
      return logResponseDetails(req, res, {
        status: 500,
        success: false,
        message: "PLease Provide all fields"
      }, cacheKey, 500)

    } else {

      // NOTE: two query strings used to be built here — `query_db`, a
      // correct upsert with ON DUPLICATE KEY UPDATE, and `query`, a plain
      // INSERT with no upsert clause at all. The plain, wrong `query` was
      // the one actually sent to addCachedAndQuery; `query_db` was built
      // and then discarded, unused. Kept the upsert version (renamed
      // mysqlQuery) and added the matching pgQuery — ControllerHandler now
      // expects { pgQuery, mysqlQuery } as { text, values } specs, not the
      // old positional (query, replacements, connection) call, and
      // Postgres was never written to at all before.
      const mysqlQuery = {
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
            groupedCommission = VALUES(groupedCommission)
        `,
        values: [productId, productDescription, itemGroup, itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission],
      };

      const pgQuery = {
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
            "groupedCommission" = EXCLUDED."groupedCommission"
        `,
        values: [productId, productDescription, itemGroup, itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission],
      };

      // NOTE: `const connection = await getConnection();` used to sit here,
      // unused and never released — a dead connection acquired and leaked
      // on every call. Removed; addCachedAndQuery handles its own
      // connections.
      const dbres = await addCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

      return logResponseDetails(req, res, dbres, cacheKey, 200)

    }
  } catch (error) {
    console.log(error)
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in create Student API ",
      error
    }, cacheKey, 500)

  }

}

const deleteProductItemPricing = async (req, res) => {
  logRequestDetails(req, "deleteProductItemPricing");
  const productId = req.body.id;
  console.log("removeEstimateById Request Params: ", req.params);
  console.log("removeEstimateById Product ID: ", productId);

  console.log(formattedDate() + "ID Pricing to delte: " + productId);

  if (!productId) {
    // NOTE: body had no `status` field, and this used to pass 500 as the
    // actual HTTP status for a missing-parameter error. Added the status
    // field and aligned the actual status to 404, matching the equivalent
    // check in every other delete endpoint in this codebase.
    return logResponseDetails(req, res, {
      status: 404,
      success: false,
      message: "PLease provide student Id => " + productId
    }, cacheKey, 404)
  }

  try {
    // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
    // { text, values } specs, not a positional (mysqlQuery, replacements)
    // call — Postgres was never deleted from at all before. Added the
    // matching pgQuery, quoted.
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
    // NOTE: this used status 404 for a generic query/connection failure —
    // 404 implies "not found", which isn't what a caught exception here
    // means. Changed to 500, matching the catch blocks in every other
    // endpoint in this codebase.
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error occurred while trying to delete.",
      error,
    }, cacheKey, 500);
  }

}

// UPdating 

const updateProductItemPricing = async (req, res) => {
  logRequestDetails(req, "updateProductItemPricing");

  try {
    //const productId  = req.params.id; // Extract student ID from the request URL


    const { productId, productDescription, itemGroup, itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission } = req.body;


    if (
      productId == null || productDescription == null || itemGroup == null || itemsRemainder == null || costOfRemainder == null || groupedQuantity == null || groupedProfit == null || groupedCommission == null
      || productId == undefined || productDescription == undefined || itemGroup == undefined || itemsRemainder == undefined || costOfRemainder == undefined || groupedQuantity == undefined || groupedProfit == undefined || groupedCommission == undefined

    ) {
      console.log("ERROR ->> Error ");
      console.log(" productId[" + productId + "]")
      console.log(" productDescription[" + productDescription + "]")
      console.log(" itemGroup[" + itemGroup + "]")
      console.log(" itemsRemainder[" + itemsRemainder + "]")
      console.log(" costOfRemainder[" + costOfRemainder + "]")
      console.log(" groupedQuantity[" + groupedQuantity + "]")
      console.log(" groupedProfit[" + groupedProfit + "]")
      console.log("groupedProfit  => " + groupedCommission);

      console.log(" **************************************************")

      // NOTE: this used to bypass logResponseDetails entirely with a raw
      // res.status(500).send(obj, cacheKey, 500) call — the trailing
      // cacheKey/status arguments were silently dropped by res.send().
      // Routed through logResponseDetails like every other endpoint here.
      return logResponseDetails(req, res, {
        status: 500,
        success: false,
        message: "PLease Provide all fields"
      }, cacheKey, 500)


    } else {
      console.log("SUCCESSFULLY READ");
      console.log(" productId[" + productId + "]")
      console.log(" productDescription[" + productDescription + "]")
      console.log(" itemGroup[" + itemGroup + "]")
      console.log(" itemsRemainder[" + itemsRemainder + "]")
      console.log(" costOfRemainder[" + costOfRemainder + "]")
      console.log(" groupedQuantity[" + groupedQuantity + "]")
      console.log(" groupedProfit[" + groupedProfit + "]")
      console.log("groupedProfit  => " + groupedCommission);
      console.log(" **************************************************")

      /* Sql STatement to UPdate */

      try {
        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs, not a positional (query, replacements)
        // call — Postgres was never updated at all before. Added the
        // matching pgQuery, quoted.
        const mysqlQuery = {
          text: `UPDATE productItemPricing SET productDescription = ?, itemGroup = ?, itemsRemainder = ?, costOfRemainder = ?, groupedQuantity = ?, groupedProfit = ?, groupedCommission = ? WHERE productId = ?`,
          values: [
            productDescription,
            itemGroup,
            itemsRemainder,
            costOfRemainder,
            groupedQuantity,
            groupedProfit,
            groupedCommission,
            productId
          ],
        };

        const pgQuery = {
          text: `UPDATE productItemPricing SET "productDescription" = $1, "itemGroup" = $2, "itemsRemainder" = $3, "costOfRemainder" = $4, "groupedQuantity" = $5, "groupedProfit" = $6, "groupedCommission" = $7 WHERE "productId" = $8`,
          values: [
            productDescription,
            itemGroup,
            itemsRemainder,
            costOfRemainder,
            groupedQuantity,
            groupedProfit,
            groupedCommission,
            productId
          ],
        };

        const result = await updateCachedOrQuery(cacheKey, { pgQuery, mysqlQuery });

        return logResponseDetails(req, res, {
          status: 200,
          success: true,
          message: "✅ Available items updated successfully",
          result
        }, cacheKey, 200)


      } catch (error) {
        // NOTE: this used status 404 for a generic query failure — 404
        // implies "not found", which isn't what a caught exception here
        // means. Changed to 500, matching the equivalent catch block in
        // updateProductPricing.
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: '❌ Error updating productItemPricing:',
          error,
        }, cacheKey, 500);
      }

      // NOTE: an unreachable `return res.status(200).send(...)` used to sit
      // here, after the try/catch above already returns on every path —
      // dead code, removed.

    }

  } catch (error) {
    // NOTE: this function had no outer try/catch at all before — if
    // anything outside the inner query try/catch threw (e.g. destructuring
    // req.body), it would crash unhandled instead of returning a response.
    // Added, matching the outer/inner try/catch pattern used by every
    // sibling update endpoint (e.g. updateProductPricing).
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in Update Student API",
      error
    }, cacheKey, 500)
  }

}

export default { getProductItemPricingList, addProductItemPricing, deleteProductItemPricing, updateProductItemPricing }