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

const cacheKey = 'productPricing'; // Key to store the list in Redis

const getPricingList = async (req, res) => {
  logRequestDetails(req, "getPricingList")

  console.log(`${cacheKey} backend started...`);

  // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
  // { text, values } specs, not positional (mysqlQuery, pgQuery) args.
  const mysqlQuery = { text: `SELECT * FROM ${cacheKey}` };
  const pgQuery = { text: `SELECT * FROM ${cacheKey}` };
  console.log("Now Quering : Key[" + cacheKey + "] mysl:[" + mysqlQuery.text + "] pgSql:" + pgQuery.text + "]");

  try {

    const data = await getCachedOrQuery(cacheKey, { pgQuery, mysqlQuery });
    data.info = cacheKey;

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
const add2Pricing = async (req, res) => {
  logRequestDetails(req, "add2Pricing")
  try {
    const { productId, costPerItem, sellingPrice, productCommission, productProfit, productQuantity, productSize } = req.body;

    console.log("id =>" + productId);
    console.log("costPerItem => " + costPerItem);
    console.log("sellingPrice  => " + sellingPrice);
    console.log("productCommission => " + productCommission);
    console.log("productProfit =>" + productProfit);
    console.log("productQuantity => " + productQuantity);
    console.log("productSize  => " + productSize);

    if (
      productId == null || costPerItem == null || sellingPrice == null || productCommission == null ||
      productProfit == null || productQuantity == null || productSize == null
    ) {
      return logResponseDetails(req, res, {
        status: 500,
        success: false,
        message: "PLease Provide all fields"
      }, cacheKey, 500)

    } else {

      // NOTE: this query was missing the `ON DUPLICATE KEY UPDATE` keyword —
      // the `columnName = VALUES(...)` lines were dangling straight after
      // `VALUES (?, ?, ...)` with nothing introducing them, which is a SQL
      // syntax error on every call. Added the missing keyword and, since
      // this is an upsert, added the matching pgQuery (it didn't exist at
      // all before).
      const mysqlQuery = {
        text: `
          INSERT INTO productPricing (productId, costPerItem, sellingPrice, productCommission, productProfit, productQuantity, productSize)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            costPerItem = VALUES(costPerItem),
            sellingPrice = VALUES(sellingPrice),
            productCommission = VALUES(productCommission),
            productProfit = VALUES(productProfit),
            productQuantity = VALUES(productQuantity),
            productSize = VALUES(productSize)
        `,
        values: [productId, costPerItem, sellingPrice, productCommission, productProfit, productQuantity, productSize],
      };

      const pgQuery = {
        text: `
          INSERT INTO productPricing ("productId", "costPerItem", "sellingPrice", "productCommission", "productProfit", "productQuantity", "productSize")
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT ("productId") DO UPDATE SET
            "costPerItem" = EXCLUDED."costPerItem",
            "sellingPrice" = EXCLUDED."sellingPrice",
            "productCommission" = EXCLUDED."productCommission",
            "productProfit" = EXCLUDED."productProfit",
            "productQuantity" = EXCLUDED."productQuantity",
            "productSize" = EXCLUDED."productSize"
        `,
        values: [productId, costPerItem, sellingPrice, productCommission, productProfit, productQuantity, productSize],
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
    }, cacheKey, 500)

  }

}

/*
SELECT 
    table1.productId,
    table1.column1 AS column1_table1,
    table1.column2 AS column2_table1,
    table2.column1 AS column1_table2,
    table2.column2 AS column2_table2
FROM 
    table1
JOIN 
    table2 ON table1.productId = table2.productId;
*/

//Merge the tables

const getYummyList = async (req, res) => {
  logRequestDetails(req, "getYummyList")

  const yummyCacheKey = 'yummyList';
  console.log(`${yummyCacheKey} backend started...`);

  const mysqlQuery = {
    text: `
      SELECT 
          productList.productId, 
          productList.productName, 
          productList.productFlavor, 
          productList.productPrice, 
          productPricing.costPerItem, 
          productPricing.sellingPrice, 
          productPricing.productCommission, 
          productPricing.productProfit, 
          productPricing.productQuantity, 
          productPricing.productSize 
      FROM productList 
      JOIN productPricing ON productList.productId = productPricing.productId
    `,
  };
  // NOTE: this used to reuse the mysql query string as-is for Postgres. Its
  // camelCase columns were unquoted, which Postgres folds to lowercase —
  // silently mismatching the real columns. Given its own quoted version.
  const pgQuery = {
    text: `
      SELECT 
          productList."productId", 
          productList."productName", 
          productList."productFlavor", 
          productList."productPrice", 
          productPricing."costPerItem", 
          productPricing."sellingPrice", 
          productPricing."productCommission", 
          productPricing."productProfit", 
          productPricing."productQuantity", 
          productPricing."productSize" 
      FROM productList 
      JOIN productPricing ON productList."productId" = productPricing."productId"
    `,
  };
  console.log("Now Quering : Key[" + yummyCacheKey + "] mysl:[" + mysqlQuery.text + "] pgSql:" + pgQuery.text + "]");

  try {
    const data = await getCachedOrQuery(yummyCacheKey, { pgQuery, mysqlQuery });
    // NOTE: these two logResponseDetails calls were logging under `cacheKey`
    // ('productPricing') instead of `yummyCacheKey`, filing this endpoint's
    // logs under the wrong key.
    return logResponseDetails(req, res, {
      status: 200,
      success: true,
      data,
    }, yummyCacheKey, 200);
  } catch (error) {
    console.error(`getCachedOrQuery error for ${yummyCacheKey}:`, error);
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: `Error fetching ${yummyCacheKey}`,
      error: error.message || error,
    }, yummyCacheKey, 500);
  }

}

//deletins

const deletePricing = async (req, res) => {
  logRequestDetails(req, "deletePricing");

  const productId = req.body.id;
  try {

    console.log(formattedDate() + "ID Pricing to delte: " + productId);


    if (!productId) {
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "PLease provide student Id => " + productId
      }, cacheKey, 500)
    } else {

      try {
        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs, not positional (query, replacements) args.
        // The old query also used a `??` identifier placeholder for the
        // table name with cacheKey stuffed into replacements, and had no
        // pgQuery. This also used to bypass logResponseDetails entirely
        // with raw res.status().send(obj, cacheKey, code) calls — res.send()
        // only takes one argument, so the trailing cacheKey/code were
        // silently dropped every time. Routed through logResponseDetails
        // like every other endpoint in this file.
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

const updateProductPricing = async (req, res) => {
  logRequestDetails(req, "updateProductPricing");
  /*
  export interface ProductPricing{

      productId:number;
      productSize:number;
      productQuantity:number;
      costPerItem:number;
      productProfit:number;
      sellingPrice:number;
      productCommission:number;

  }

  */

  //const productId  = req.params.id; // Extract student ID from the request URL


  const {
    costPerItem, productCommission, productId, itemGrouping,
    productProfit, productQuantity, productSize, sellingPrice

  } = req.body;

  try {

    if (
      productId == null || costPerItem == null || sellingPrice == null || productCommission == null ||
      productProfit == null || productQuantity == null || productSize == null
    ) {
      console.log("ERROR ->> Error ");
      console.log(" productId[" + productId + "]")
      console.log(" costPerItem[" + costPerItem + "]")
      console.log(" sellingPrice[" + sellingPrice + "]")
      console.log(" productCommission[" + productCommission + "]")
      console.log(" productProfit[" + productProfit + "]")
      console.log(" productQuantity[" + productQuantity + "]")
      console.log(" productSize[" + productSize + "]")
      console.log(" itemGrouping[" + itemGrouping + "]")

      console.log(" **************************************************")


      return logResponseDetails(req, res, {
        status: 500,
        success: false,
        message: "PLease Provide all fields"
      }, cacheKey, 500)


    } else {
      console.log("SUCCESSFULLY READ");
      console.log(" productId[" + productId + "]")
      console.log(" costPerItem[" + costPerItem + "]")
      console.log(" sellingPrice[" + sellingPrice + "]")
      console.log(" productCommission[" + productCommission + "]")
      console.log(" productProfit[" + productProfit + "]")
      console.log(" productQuantity[" + productQuantity + "]")
      console.log(" productSize[" + productSize + "]")
      console.log(" itemGrouping[" + itemGrouping + "]")

      console.log(" **************************************************")

      /* Sql STatement to UPdate */

      try {
        // NOTE: this used to only build a mysqlQuery and call
        // updateCachedOrQuery(cacheKey, query, replacements) — no pgQuery
        // existed at all, so Postgres was never updated. Added it, quoted.
        const mysqlQuery = {
          text: `UPDATE productPricing SET costPerItem = ?, sellingPrice = ?, productCommission = ?, productProfit = ?,productQuantity = ?,productSize = ?,itemGrouping = ? WHERE productId = ?`,
          values: [
            costPerItem,
            sellingPrice,
            productCommission,
            productProfit,
            productQuantity,
            productSize,
            itemGrouping,
            productId
          ],
        };
        const pgQuery = {
          text: `UPDATE productPricing SET "costPerItem" = $1, "sellingPrice" = $2, "productCommission" = $3, "productProfit" = $4, "productQuantity" = $5, "productSize" = $6, "itemGrouping" = $7 WHERE "productId" = $8`,
          values: [
            costPerItem,
            sellingPrice,
            productCommission,
            productProfit,
            productQuantity,
            productSize,
            itemGrouping,
            productId
          ],
        };

        console.log('Updating productPricing with replacements:', mysqlQuery.values);

        let result;
        try {
          result = await updateCachedOrQuery(cacheKey, { pgQuery, mysqlQuery });
          console.log('✅ productItemPricing updated successfully:', result);
        } catch (error) {
          console.error('❌ Error updating productItemPricing:', error);
          throw error;
        }
        // respond with result
        // Check if result is valid and rows were affected
        if (!result || (typeof result.affectedRows === 'number' && result.affectedRows === 0) || (typeof result.rowCount === 'number' && result.rowCount === 0)) {
          // NOTE: body said status 404 but this used to pass 500 as the
          // actual HTTP status — aligned with the body (and with
          // updateEstimates' equivalent, near-identical branch).
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
        // NOTE: this previously referenced _name/_flavor/_price/_image_url
        // here, none of which exist anywhere in this function — that threw
        // a ReferenceError and masked whatever the real update error was.
        // Fixed to reference the actual fields this function deals with.
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: `Something wrong happened while updating the record. productId=${productId} costPerItem=${costPerItem} sellingPrice=${sellingPrice} productCommission=${productCommission} productProfit=${productProfit} productQuantity=${productQuantity} productSize=${productSize} itemGrouping=${itemGrouping}`,
          error
        }, cacheKey, 500)
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

const updatePricingList = async (req, res) => {
  logRequestDetails(req, "updatePricingList");

  const { productId, costPerItem, sellingPrice, productCommission,
    productProfit, productQuantity, productSize } = req.body;

  try {

    // NOTE: this validation used to be inverted. The original code had an
    // outer `if (!productId) { return error }` followed by, inside its
    // `else`, a SECOND check `if (productId == null || costPerItem == null
    // || ...)` that only runs the actual UPDATE when that condition is
    // TRUE — i.e. only when fields are missing. When every field was
    // actually valid, that inner `if` was false, so nothing happened at
    // all: no query ran and no response was ever sent, leaving the request
    // to hang until timeout. When fields were missing, it ran the update
    // anyway with null/undefined values. Replaced with a single check that
    // validates first and only proceeds to update when the data is valid,
    // matching every other endpoint in this file. Also filled in the
    // cacheKey/status args this response was missing entirely.
    if (
      productId == null || costPerItem == null || sellingPrice == null || productCommission == null ||
      productProfit == null || productQuantity == null || productSize == null
    ) {
      console.log("productId Provided=> " + productId)
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "** Invalid IR Or provide id ** "
          + " productId[" + productId + "]"
          + " costPerItem[" + costPerItem + "]"
          + " sellingPrice[" + sellingPrice + "]"
          + " productCommission[" + productCommission + "]"
          + " productProfit[" + productProfit + "]"
          + " productQuantity[" + productQuantity + "]"
          + " productSize[" + productSize + "]"
          + " **************************************************"
      }, cacheKey, 404)

    } else {

      console.log("id =>" + productId);
      console.log("costPerItem => " + costPerItem);
      console.log("sellingPrice  => " + sellingPrice);
      console.log("productCommission => " + productCommission);
      console.log("productProfit =>" + productProfit);
      console.log("productQuantity => " + productQuantity);
      console.log("productSize  => " + productSize);// Extract updated values from the request body

      try {
        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs, not the old 4-arg positional call
        // (cacheKey, mysqlQuery, pgQuery, replacements). Quoted the
        // camelCase pg columns too.
        const mysqlQuery = {
          text: `UPDATE ${cacheKey} SET costPerItem = ?, sellingPrice = ?, productCommission = ?, productProfit = ?, productQuantity = ?, productSize = ? WHERE productId = ?`,
          values: [
            costPerItem,
            sellingPrice,
            productCommission,
            productProfit,
            productQuantity,
            productSize,
            productId
          ],
        };
        const pgQuery = {
          text: `UPDATE ${cacheKey} SET "costPerItem" = $1, "sellingPrice" = $2, "productCommission" = $3, "productProfit" = $4, "productQuantity" = $5, "productSize" = $6 WHERE "productId" = $7`,
          values: [
            costPerItem,
            sellingPrice,
            productCommission,
            productProfit,
            productQuantity,
            productSize,
            productId
          ],
        };

        const result = await updateCachedOrQuery(cacheKey, { pgQuery, mysqlQuery });

        console.log('✅ productPricing updated successfully:', result);

        // Check if any rows were affected/updated
        if (
          !result ||
          (typeof result.affectedRows === 'number' && result.affectedRows === 0) ||
          (typeof result.rowCount === 'number' && result.rowCount === 0)
        ) {
          // NOTE: body said status 404 but this used to pass 500 as the
          // actual HTTP status — aligned with the body.
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
            message: "✅ productPricing updated successfully",
            result
          }, cacheKey, 200);
        }
      } catch (error) {
        console.error('❌ Error updating productPricing:', error);
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


export default { deletePricing, getPricingList, add2Pricing, getYummyList, updateProductPricing, updatePricingList }