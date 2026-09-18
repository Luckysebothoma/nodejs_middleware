import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime } = TimeUtils;
 import { getConnection } from '../config/db.js';

import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';


const { 
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
const cacheKey = 'productList';

const getProductList = async (req, res) => {

    logRequestDetails(req, "getProductList");

 console.log(`${cacheKey} backend started...`);

  const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
  const _pgQuery = `SELECT * FROM ${cacheKey}`;
  console.log("Now Quering : Key[" + cacheKey + "] mysl:[" + _mysqlQuery + "] pgSql:" + _pgQuery + "]");

  try {

    const data = await getCachedOrQuery(cacheKey, {
      mysqlQuery: { text: _mysqlQuery },
      pgQuery: { text: _pgQuery },
    });

    return logResponseDetails(req, res, data, cacheKey,200);

  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: `Error fetching ${cacheKey}`,
      error: error.message || error,
   }, cacheKey, 500);
  }

};

// Function to get product by ID (not an HTTP handler)
// NOTE: this used to be unusable — it called console.Error (not a real
// method), referenced `key` and `err` that were never declared anywhere in
// scope, read `mysqlResult` without declaring it (an implicit global, which
// throws under ES module strict mode instead of silently leaking), called
// `JSON.parse[mysqlResult]` with square brackets instead of parens (indexing
// a function rather than calling it), ran a raw connection.beginTransaction()
// for what is just a SELECT, and tried to call logResponseDetails(req, res, ...)
// even though this function is explicitly "not an HTTP handler" and never
// receives req/res. Rewritten to use the same getCachedOrQuery({ pgQuery,
// mysqlQuery }) pattern as the rest of this file/controller, and to just
// return the data or throw so callers can handle it.
const _getProductByID = async (productId) => {
  if (!productId) {
    throw new Error("Invalid or missing product ID");
  }

  const mysqlQuery = { text: `SELECT * FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
  const pgQuery = { text: `SELECT * FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

  try {
    const data = await getCachedOrQuery(`${cacheKey}:${productId}`, { pgQuery, mysqlQuery });
    return data;
  } catch (error) {
    console.error(`_getProductByID error for productId [${productId}]:`, error);
    throw error;
  }
};

const getProductByID = async (req, res) => {
  logRequestDetails(req, "getProductByID");

  // NOTE: `productId` was previously assigned with `productId = req.params.id`
  // (no declaration). This file is an ES module, which runs in strict mode,
  // so that line threw a ReferenceError on every call instead of silently
  // creating a global. Declared it properly, and hoisted it above the try
  // block so the catch block (which logs it) can still see it.
  const productId = req.params.id;

  try {
    if (!productId) {
      // NOTE: body said status 404 but this used to pass 500 as the actual
      // HTTP status — aligned with the body.
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: "INvalid or Provide Student ID"
      }, cacheKey, 404)
    } else {
      // NOTE: this used to call `dbSequelize.query(...)`, but `dbSequelize`
      // is never imported anywhere in this file — every call threw a
      // ReferenceError. Replaced with the same getCachedOrQuery({ pgQuery,
      // mysqlQuery }) pattern used by every other endpoint here.
      const mysqlQuery = { text: `SELECT * FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
      const pgQuery = { text: `SELECT * FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

      const data = await getCachedOrQuery(`${cacheKey}:${productId}`, { pgQuery, mysqlQuery });

      if (!data || (Array.isArray(data) && data.length === 0)) {
        return logResponseDetails(req, res, {
          status: 404,
          success: false,
          message: "NO Recotdas found"
        }, cacheKey, 404)

      } else {
        return logResponseDetails(req, res, {
          status: 200,
          success: true,
          studentDetails: data
        }, cacheKey, 200)
      }
    }

  } catch (error) {
    console.log(error)
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: "Error in Get Students by ID API, Passed ID=0" + productId,
      error
    }, cacheKey, 500)
  }

}

const updateProduct = async (req, res) => {
  logRequestDetails(req, "updateProduct");

  const { productId, productName, productFlavor, productPrice, image_url } = req.body;

  // Basic validation
  if (!productId || !productName || !productFlavor || !productPrice || !image_url) {
    // NOTE: body said status 400 but this used to pass 500 as the actual
    // HTTP status — aligned with the body.
    return logResponseDetails(req, res, {
      status: 400,
      success: false,
      message: `❌ Invalid input: ${JSON.stringify(req.body)}`
   }, cacheKey, 400);
  }

  // Use positional parameters (?)
  const query = `
    UPDATE ${cacheKey} 
    SET productName = ?, productFlavor = ?, productPrice = ?, image_url = ? 
    WHERE productId = ?
  `;

  const replacements = [productName, productFlavor, productPrice, image_url, productId];

  // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
  // { text, values } specs. Only mysqlQuery existed before — Postgres was
  // never updated at all. Added the matching pgQuery, quoted.
  const pgQuery = {
    text: `
      UPDATE ${cacheKey}
      SET "productName" = $1, "productFlavor" = $2, "productPrice" = $3, "image_url" = $4
      WHERE "productId" = $5
    `,
    values: [productName, productFlavor, productPrice, image_url, productId],
  };

  try {
    const result = await updateCachedOrQuery(cacheKey, {
      mysqlQuery: { text: query, values: replacements },
      pgQuery,
    });

    console.log(`✅ ${cacheKey} updated successfully:`, result);

    if (!result || (result.affectedRows === 0 || result.rowCount === 0)) {
      // NOTE: body said status 404 but this used to pass 500 as the actual
      // HTTP status — aligned with the body.
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: `❌ No rows updated in ${cacheKey}. Invalid productId or no changes.`,
        result
     }, cacheKey, 404);
    }

    return logResponseDetails(req, res, {
      status: 200,
      success: true,
      message: `✅ ${cacheKey} updated successfully`,
      result
   }, cacheKey, 200);

  } catch (error) {
    console.error(`❌ Update error for ${cacheKey}:`, error);
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: `❌ Failed to update ${cacheKey}`,
      error: error.message
   }, cacheKey, 500);
  }
};

const purgingProduct = async (req, res) => {

    logRequestDetails(req, "purgingProduct");
	        const productId = req.params.id;

	console.log("purgeProduct");
		console.log("ID: " + productId);

    try {

        if (!productId) {
          // NOTE: body said status 404 but this used to pass 500 as the
          // actual HTTP status — aligned with the body.
          return logResponseDetails(req, res, {
            status: 404,
            success: false,
            message: "Please provide a product ID"
          }, cacheKey, 404);
        }

        // NOTE: this used to call `dbSequelize.query(...)` twice —
        // `dbSequelize` is never imported anywhere in this file, so every
        // call threw a ReferenceError before either delete could run.
        // Rewritten with removeCachedAndQuery({ pgQuery, mysqlQuery }),
        // matching the pattern used by deleteProduct/deletePricing.
        const pricingMysqlQuery = { text: `DELETE FROM productPricing WHERE productId = ?`, values: [productId] };
        const pricingPgQuery = { text: `DELETE FROM productPricing WHERE "productId" = $1`, values: [productId] };
        const productMysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
        const productPgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

        const [pricingResult, productResult] = await Promise.all([
          removeCachedAndQuery('productPricing', { pgQuery: pricingPgQuery, mysqlQuery: pricingMysqlQuery }),
          removeCachedAndQuery(cacheKey, { pgQuery: productPgQuery, mysqlQuery: productMysqlQuery }),
        ]);

        const pricingAffected = pricingResult?.affectedRows ?? pricingResult?.rowCount ?? 0;
        const productAffected = productResult?.affectedRows ?? productResult?.rowCount ?? 0;

        // Check if both queries were successful
        if (pricingAffected === 0 && productAffected === 0) {
          return logResponseDetails(req, res, {
            status: 404,
            success: false,
            message: "No product found with the provided ID"
          }, cacheKey, 404);
        }

     return logResponseDetails(req, res, {
      status: 200,
            success: true,
            message: "Product with ID " + productId + " deleted successfully from both tables"
       }, cacheKey,200);
    } catch (error) {
        console.log(error);
     return logResponseDetails(req, res, {
      status: 500,
            success: false,
            message: "Error in deleting product",
            error: error.message // Send error message only
       }, cacheKey,500);
    }
};

const deleteProduct = async(req, res) =>{
    logRequestDetails(req, "deleteProduct");
    try {

    const productId = req.body.id;
        console.log("Product Id: "+  productId);
        if(!productId){
          // NOTE: body said status 404 but this used to pass 500 as the
          // actual HTTP status — aligned with the body.
          return logResponseDetails(req, res, {
            status: 404,
                success:false,
                message:"PLease provide student Id => " + productId
           }, cacheKey,404)
        }else{

          try {
              // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
              // { text, values } specs. Only mysqlQuery existed before —
              // Postgres was never deleted from at all. Added the matching
              // pgQuery, quoted.
              const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
              const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };

              const result = await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

              if (result.affectedRows > 0) {
                  return logResponseDetails(req,res,{
                      success: true,
                      message: `ID [${productId}] deleted successfully`,
                 }, cacheKey,200);
              } else {
                 // NOTE: this previously reported "not found" with an actual
                 // HTTP status of 500 and no status field in the body —
                 // changed to 404, matching the equivalent branch in
                 // deletePricing.
                 return logResponseDetails(req,res,{
                      status: 404,
                      success: false,
                      message: `ID [${productId}] not found in [${cacheKey}]`,
                 }, cacheKey,404);
              }

          } catch (error) {
              console.error(error);
              return logResponseDetails(req,res,{
                  success: false,
                  message: "Error occurred while trying to delete.",
                  error,
             }, cacheKey,500);
          }

        }
        
    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res, {
      status: 500,
            success:false,
            message: "Error in Deleting Student",
            error
       }, cacheKey,500)
    }

}

const addProduct = async(req, res) => {
logRequestDetails(req, "addProduct");

    try {
        const { productId, productName,productFlavor,productPrice, image_url} = req.body;

        console.log("id =>" +productId);
        console.log("name => " + productName);
        console.log("flavor  => " + productFlavor);
        console.log("price => " + productPrice);
        console.log("image_url => " + image_url);
       

        if(
            
            productName ==null || productFlavor ==null || productPrice ==null || image_url==null
            || productName==undefined || productFlavor==undefined || productPrice==undefined || image_url == undefined
        
        ){
         return logResponseDetails(req, res, {
      status: 500,
                success:false,
                message:"PLease Provide all fields"
           }, cacheKey,500)

        }else{

        // SQL INSERT statement with ON DUPLICATE KEY UPDATE
        const query = `
          INSERT INTO productList (productId, productName, productFlavor, productPrice, image_url)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE 
            productName = VALUES(productName),
            productFlavor = VALUES(productFlavor),
            productPrice = VALUES(productPrice),
            image_url = VALUES(image_url)
        `;

        // Parameterized query with replacements
        const replacements = [productId, productName,productFlavor,productPrice, image_url];

        // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
        // { text, values } specs. Only mysqlQuery existed before — Postgres
        // never received the insert/upsert at all. Added the matching
        // pgQuery (quoted columns, ON CONFLICT upsert), mirroring add2Pricing.
        const pgQuery = {
          text: `
            INSERT INTO productList ("productId", "productName", "productFlavor", "productPrice", "image_url")
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT ("productId") DO UPDATE SET
              "productName" = EXCLUDED."productName",
              "productFlavor" = EXCLUDED."productFlavor",
              "productPrice" = EXCLUDED."productPrice",
              "image_url" = EXCLUDED."image_url"
          `,
          values: [productId, productName, productFlavor, productPrice, image_url],
        };

        // NOTE: `const connection = await getConnection();` used to sit here,
        // unused and never released — a dead connection acquired and leaked
        // on every call. Removed; addCachedAndQuery handles its own
        // connections.
        const dbres = await addCachedAndQuery(cacheKey, {
          mysqlQuery: { text: query, values: replacements },
          pgQuery,
        });
        
        return logResponseDetails(req, res, dbres, cacheKey, 200)
        }



    } catch (error) {
        // NOTE: this used to pass the raw `error` object as the whole
        // response body instead of a { status, success, message, error }
        // shape — inconsistent with every other endpoint's error response.
        console.log(error)
        return logResponseDetails(req, res, {
          status: 500,
          success: false,
          message: "Error in addProduct API",
          error
        }, cacheKey, 500)
        
    }



}

export default {getProductList, getProductByID, updateProduct, deleteProduct, addProduct, purgingProduct, _getProductByID}