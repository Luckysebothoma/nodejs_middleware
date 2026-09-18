import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';
 import { getConnection } from '../config/db.js';

const { formattedDate, getShortTime, getMidTime } = TimeUtils;

const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
const cacheKey = 'sodEodItems'; // Key to store the list in Redis

// NOTE: `import { query } from "express";` used to sit at the top of this
// file. `express` doesn't have a named export called `query`, and since
// this is an ES module, importing a named export that doesn't exist from a
// CommonJS package like express fails at load time — this file could never
// be imported at all. It was also unused (every function below declares its
// own local `query`/`mysqlQuery` constant, shadowing it even where it
// would have worked). Removed.

const getSodEodList = async (req, res) => {
  logRequestDetails(req, "getSodEodList");
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

    // NOTE: this used to call res.status(200).send(data) directly,
    // bypassing logResponseDetails entirely — this endpoint's requests
    // never got logged, unlike every other endpoint in this codebase.
    // Routed through logResponseDetails instead.
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

const addSodEodList = async (req, res) => {
  logRequestDetails(req, "addSodEodList");

  // NOTE: this whole function used to have no outer try/catch at all —
  // added one, matching the pattern every sibling endpoint uses.
  try {
    const { productId, itemsTaken, itemsRemaining, lastUpdated, productName, availableItems, outOfStock } = req.body;

    //  displayedColumnsSodEod: string[] = ['productId', 'itemsTaken', 'itemsRemaining', 'date', 'productName', 'availableItems', 'outOfStock'

    console.log("id =>" + productId);
    console.log("itemsRemaining => " + itemsRemaining);
    console.log("lastUpdated => " + lastUpdated);
    console.log("productName =>" + productName);
    console.log("itemsTaken => " + itemsTaken);
    console.log("itemsTaken => " + availableItems);
    console.log("itemsTaken => " + outOfStock);

    if (productId === undefined || productId === null ||
      itemsRemaining === undefined || itemsRemaining === null ||
      itemsTaken === undefined || itemsTaken === null ||
      lastUpdated === undefined || lastUpdated === null ||
      productName === undefined || productName === null ||
      availableItems === undefined || availableItems === null ||
      outOfStock === undefined || outOfStock === null) {

      // NOTE: this branch used to reference an `error` variable
      // (`console.log(error)`, `error.message`) that was never declared
      // anywhere in scope — this isn't a catch block, so every call with a
      // missing field threw a ReferenceError instead of returning the
      // validation message. Removed the bogus `error` references.
      return logResponseDetails(req, res, {
        status: 400,
        success: false,
        message: "PLease Provide all fields"
      }, cacheKey, 400)

    } else {

      // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
      // { text, values } specs, not a positional (query, replacements)
      // call — Postgres was never written to at all before. Added the
      // matching pgQuery, quoted.
      const mysqlQuery = {
        text: `
          INSERT INTO sodEodItems (productName, itemsTaken, itemsRemaining, lastUpdated, productId, availableItems, outOfStock)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            productName = VALUES(productName),
            itemsTaken = VALUES(itemsTaken),
            itemsRemaining = VALUES(itemsRemaining),
            lastUpdated = VALUES(lastUpdated),
            availableItems = VALUES(availableItems),
            outOfStock = VALUES(outOfStock)
        `,
        values: [productName, itemsTaken, itemsRemaining, lastUpdated, productId, availableItems, outOfStock],
      };

      const pgQuery = {
        text: `
          INSERT INTO sodEodItems ("productName", "itemsTaken", "itemsRemaining", "lastUpdated", "productId", "availableItems", "outOfStock")
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT ("productId") DO UPDATE SET
            "productName" = EXCLUDED."productName",
            "itemsTaken" = EXCLUDED."itemsTaken",
            "itemsRemaining" = EXCLUDED."itemsRemaining",
            "lastUpdated" = EXCLUDED."lastUpdated",
            "availableItems" = EXCLUDED."availableItems",
            "outOfStock" = EXCLUDED."outOfStock"
        `,
        values: [productName, itemsTaken, itemsRemaining, lastUpdated, productId, availableItems, outOfStock],
      };

      // NOTE: this call's result used to be thrown away and no response
      // was ever sent back on success — the request would hang until it
      // timed out. Captured the result and added a success response.
      const result = await addCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

      return logResponseDetails(req, res, {
        status: 200,
        success: true,
        message: `[${productId}] added/updated successfully`,
        result,
      }, cacheKey, 200)

    }
  } catch (error) {
    console.log(error)
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in create Student API ",
      error: error.message || error
    }, cacheKey, 500)
  }
}


const getSodEodItems = async (req, res) => {
  logRequestDetails(req, "getSodEodItems");
  try {

    const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
    const _pgQuery = `SELECT * FROM ${cacheKey}`;

    // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
    // { text, values } specs, not positional (query, query) args.
    const dbDataResult = await getCachedOrQuery(cacheKey, {
      mysqlQuery: { text: _mysqlQuery },
      pgQuery: { text: _pgQuery },
    });

    // NOTE: this used to ignore `dbDataResult` completely and always
    // respond with success:false / "Resource not found", even when the
    // query succeeded and returned data. Now actually returns what was
    // fetched.
    return logResponseDetails(req, res, {
      status: 200,
      success: true,
      data: dbDataResult,
    }, cacheKey, 200);

  } catch (error) {
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in getting all " + error,
    }, cacheKey, 500)
  }


}

// NOTE: kept as-is functionally (still unused/not exported below) but fixed
// the same way as its near-duplicate `removeSodEodById`, since it's still
// live code that could be wired up later.
const removeSodEodByIdSS = async (req, res) => {

  logRequestDetails(req, "removeSodEodById");
  try {

    const productId = req.body.id;

    if (!productId) {
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

        // NOTE: this used to report success unconditionally, even when
        // nothing was actually deleted. Added the affectedRows/rowCount
        // check used by deleteSodEodItems below.
        const affected = result?.affectedRows ?? result?.rowCount ?? 0;

        if (affected > 0) {
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

const removeSodEodById = async (req, res) => {
  logRequestDetails(req, "removeSodEodById");

  const productId = req.params.id;

  if (!productId) {
    return logResponseDetails(req, res, {
      success: false,
      message: "Please provide student Id",
    }, cacheKey, 400); // 400 = Bad Request
  }

  try {
    // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
    // { text, values } specs, not a positional (mysqlQuery, replacements)
    // call — Postgres was never deleted from at all before. Added the
    // matching pgQuery, quoted.
    const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
    const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

    const result = await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

    // NOTE: this used to report success unconditionally, even when nothing
    // was actually deleted. Added the affectedRows/rowCount check used by
    // deleteSodEodItems below.
    const affected = result?.affectedRows ?? result?.rowCount ?? 0;

    if (affected === 0) {
      return logResponseDetails(req, res, {
        success: false,
        message: `ID [${productId}] not found in [${cacheKey}]`,
      }, cacheKey, 404);
    }

    return logResponseDetails(req, res, {
      success: true,
      message: `ID [${productId}] deleted successfully`,
    }, cacheKey, 200);
  } catch (error) {
    return logResponseDetails(req, res, {
      success: false,
      message: "Error occurred while trying to delete.",
      error,
    }, cacheKey, 500);
  }
};


const deleteSodEodItems = async (req, res) => {
  logRequestDetails(req, "deleteSodEodItems");
  try {

    const productId = req.params.id;
    console.log(formattedDate() + "ID Pricing to delte: " + productId);

    if (!productId) {
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "PLease provide student Id => " + productId
      }, cacheKey, 404)
    } else {

      try {
        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs, not a positional (mysqlQuery,
        // replacements) call. `replacements` was also being passed as the
        // bare value `productId` instead of `[productId]` — a parameterized
        // query needs an array of bind values, not the raw value itself.
        // Added the matching pgQuery, quoted, and fixed replacements to an
        // array.
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

const updateSodEodItems = async (req, res) => {
  logRequestDetails(req, "updateSodEodItems");
  try {
    const { productId, itemsTaken, itemsRemaining, date, productName } = req.body;

    console.log("id =>" + productId);
    console.log("itemsRemaining => " + itemsRemaining);
    console.log("lastUpdated => " + date);
    console.log("productName =>" + productName);
    console.log("itemsTaken => " + itemsTaken);



    if (productId === undefined || productId === null ||
      itemsRemaining === undefined || itemsRemaining === null ||
      itemsTaken === undefined || itemsTaken === null ||
      date === undefined || date === null ||
      productName === undefined || productName === null) {

      return logResponseDetails(req, res, {
        status: 400,
        success: false,
        message: "PLease Provide all fields"
      }, cacheKey, 400)

    } else {
      // NOTE: `result` used to be declared with `const` *inside* the try
      // block below, then read again after that block ended. A
      // const/let declared inside a block doesn't exist outside it, so the
      // result-checking code after the try/catch threw "result is not
      // defined" on every call. Hoisted the declaration above the try so
      // both the try and the check below share the same variable.
      let result;
      try {
        // Construct the SQL UPDATE statement with replacements
        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs, not a positional (query, replacements)
        // call — Postgres was never updated at all before. Added the
        // matching pgQuery, quoted.
        const mysqlQuery = {
          text: `UPDATE sodEodItems SET productName = ?, itemsTaken = ?, itemsRemaining = ?, lastUpdated = ? WHERE productId = ?`,
          values: [productName, itemsTaken, itemsRemaining, date, productId],
        };
        const pgQuery = {
          text: `UPDATE sodEodItems SET "productName" = $1, "itemsTaken" = $2, "itemsRemaining" = $3, "lastUpdated" = $4 WHERE "productId" = $5`,
          values: [productName, itemsTaken, itemsRemaining, date, productId],
        };

        console.log('Updating sodEodItems with replacements:', mysqlQuery.values);

        result = await updateCachedOrQuery(cacheKey, { pgQuery, mysqlQuery });
        console.log('✅ sodEodItems updated successfully:', result);
      } catch (error) {
        // NOTE: this used to just log the error and fall through to the
        // result-check below, which (combined with the scoping bug above)
        // meant a query failure crashed on an undefined `result` instead of
        // returning a proper error response. Now returns directly.
        console.error('❌ Error updating sodEodItems:', error);
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: '❌ Error updating sodEodItems',
          error,
        }, cacheKey, 500);
      }

      // respond with result
      // Check if result is valid and rows were affected
      if (!result || (typeof result.affectedRows === 'number' && result.affectedRows === 0) || (typeof result.rowCount === 'number' && result.rowCount === 0)) {
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
          message: "✅ Available items updated successfully",
          result
        }, cacheKey, 200);
      }


    }



  } catch (error) {
    console.log(error)
    // NOTE: this used status 404 for a generic/unexpected error — changed
    // to 500, matching the catch blocks in every other endpoint in this
    // codebase.
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in Update Student API",
      error
    }, cacheKey, 500)
  }

}

const addSodEodItems = async (req, res) => {
  logRequestDetails(req, "addSodEodItems");

  // NOTE: this whole function used to have no outer try/catch at all —
  // added one, matching the pattern every sibling endpoint uses.
  try {
    const { productId, itemsTaken, itemsRemaining, lastUpdated, productName } = req.body;

    console.log("id =>" + productId);
    console.log("itemsRemaining => " + itemsRemaining);
    console.log("lastUpdated => " + lastUpdated);
    console.log("productName =>" + productName);
    console.log("itemsTaken => " + itemsTaken);


    if (productId === undefined || productId === null ||
      itemsRemaining === undefined || itemsRemaining === null ||
      itemsTaken === undefined || itemsTaken === null ||
      lastUpdated === undefined || lastUpdated === null ||
      productName === undefined || productName === null) {

      // NOTE: this branch used to reference an `error` variable
      // (`console.log(error)`, `error.message`) that was never declared
      // anywhere in scope — this isn't a catch block, so every call with a
      // missing field threw a ReferenceError instead of returning the
      // validation message. Removed the bogus `error` references.
      return logResponseDetails(req, res, {
        status: 400,
        success: false,
        message: "PLease Provide all fields"
      }, cacheKey, 400)

    } else {

      // SQL INSERT statement with ON DUPLICATE KEY UPDATE
      // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
      // { text, values } specs, not a positional (query, replacements)
      // call — Postgres was never written to at all before. Added the
      // matching pgQuery, quoted.
      const mysqlQuery = {
        text: `
          INSERT INTO sodEodItems (productName, itemsTaken, itemsRemaining, lastUpdated, productId)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            productName = VALUES(productName),
            itemsTaken = VALUES(itemsTaken),
            itemsRemaining = VALUES(itemsRemaining),
            lastUpdated = VALUES(lastUpdated)
        `,
        values: [productName, itemsTaken, itemsRemaining, lastUpdated, productId],
      };

      const pgQuery = {
        text: `
          INSERT INTO sodEodItems ("productName", "itemsTaken", "itemsRemaining", "lastUpdated", "productId")
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT ("productId") DO UPDATE SET
            "productName" = EXCLUDED."productName",
            "itemsTaken" = EXCLUDED."itemsTaken",
            "itemsRemaining" = EXCLUDED."itemsRemaining",
            "lastUpdated" = EXCLUDED."lastUpdated"
        `,
        values: [productName, itemsTaken, itemsRemaining, lastUpdated, productId],
      };

      const data = await addCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

      if (!data) {
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: "Error: CNNOT INSERT DATA TO CART DUE TO A ERROR",

        }, cacheKey, 500)
      } else {
        return logResponseDetails(req, res, {
          status: 200,
          success: true,
          message: "Successfully Added New SodEod",
        }, cacheKey, 200)
      }


    }
  } catch (error) {
    // NOTE: this used to build the response body with `error` (shorthand)
    // and then `error: errorMessage` right after — the second key silently
    // overwrote the first, and `errorMessage` was never declared anywhere
    // in this catch block, so every failed insert threw a ReferenceError
    // from inside its own error handler instead of returning a response.
    // Collapsed to a single `error` field using the caught error.
    console.log(error)
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in create Student API ",
      error: error.message || error
    }, cacheKey, 500)
  }

}

export default { addSodEodList, getSodEodList, removeSodEodById, addSodEodItems, deleteSodEodItems, getSodEodItems, updateSodEodItems }