import { formatForMySQL } from '../utils/formatForMySQL.js';
const cacheKey = 'availableItems'; // Key to store the list in Redis
let keyExist = false;
import TimeUtils from '../utils/Time.js';
import ControllerHandler from "../utils/ControllerHandler.js";
 
import { getConnection } from '../config/db.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';

/**
 * Helper utility to normalize/format JavaScript dates or ISO strings into MySQL compatible 'YYYY-MM-DD HH:MM:SS'
 */
/**
 * Normalize a JS Date / ISO string / MySQL datetime string into
 * MySQL DATETIME format: 'YYYY-MM-DD HH:MM:SS' (UTC).
 */
const MYSQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;


const removeAvailableItemsById = async(req, res) =>{
logRequestDetails(req, "removeAvailableItemsById");
            const productId = req.params.id;
    console.log("Attempting to remove available id[" + productId + "]")
    try {
        if(!productId){
        return logResponseDetails(req, res, {
        status: 400,
        success: true,
        message: "PLease provide student Id => " + productId},cacheKey,400)
        }else{
try {
    // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
    // { text, values } specs, not positional (query, replacements) args.
    // The pgQuery was also missing entirely before, so Postgres never
    // received the delete.
    const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
    const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };
    const result = await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });
        result.info = cacheKey;
    return logResponseDetails(req,res,result, cacheKey,200);
} catch (error) {
    console.error(error);
        return logResponseDetails(req,res,error, cacheKey,500);
}
  
        
	 
			
        }
        
    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res,  {
        status: 400,
            success:false,
            message: "Error in Deleting Student",
            error
        },cacheKey,400)
    }
}

const getAvailableItems = async (req, res) => {
    logRequestDetails(req, "getAvailableItems");
  console.log(`${cacheKey} backend started...`);
  // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
  // { text, values } specs, not positional (mysqlQuery, pgQuery) args.
  const mysqlQuery = { text: `SELECT * FROM ${cacheKey}` };
  const pgQuery = { text: `SELECT * FROM ${cacheKey}` };
  console.log("Now Quering : Key[" + cacheKey + "] mysl:" + mysqlQuery.text + "pgSql:" + pgQuery.text);
  try {
    const data = await getCachedOrQuery(cacheKey, { pgQuery, mysqlQuery });
    return logResponseDetails(req,res,data,cacheKey,200)
  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    return logResponseDetails(req, res,`Error in ${cacheKey}`,cacheKey,500)
  }
};

const deleteAvailableItems = async(req, res) =>{
        logRequestDetails(req, "deleteAvailableItems");
    const productId = req.body.id;
        console.log(formattedDate() + "ID Pricing to delte: " + productId);
    try {
        if(!productId){
              return logResponseDetails(req, res,  {
        status: 404,
                success:false,
                message:"PLease provide student Id => " + productId
            },cacheKey,500)
        }else{
            try {
				
                // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
                // { text, values } specs, not positional args. Also the pgQuery's
                // "productId" column was unquoted, which Postgres folds to
                // lowercase (productid) and would never match the real column.
                const mysqlQuery = { text: `DELETE FROM ${cacheKey} WHERE productId = ?`, values: [productId] };
                const pgQuery = { text: `DELETE FROM ${cacheKey} WHERE "productId" = $1`, values: [productId] };
                await removeCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });
                return logResponseDetails(req, res,  {
                    status: 200,
                    success:true,
                    message:"ID [" + productId +"] DELETED Successfully"
                },cacheKey,500)
            } catch (error) {
                console.log(error)
                return logResponseDetails(req, res,  {
                    status: 500,
                    success:false,
                    message:"Something happening while trying to delete",
                    error
                },cacheKey,500)
            }    
        }
    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res,  {
            status: 500,
            success:false,
            message: "Error in Deleting Student",
            error
        },cacheKey,500)
    }
}

const updateAvailableItems = async(req, res) => {
    logRequestDetails(req, "updateAvailableItems");
    try {
        const { productId, itemsRemaining, _lastUpdated } = req.body;


        const lastUpdated = formatForMySQL(_lastUpdated);
       
        if(productId == null || itemsRemaining == null || lastUpdated == null){
              return logResponseDetails(req, res, {
                status: 500,
                success: false,
                message: "Please Provide all fields"
            }, cacheKey, 500);
        } else {
            // Sanitize / normalize the date value for MySQL
            const normalizedDate = formatForMySQL(lastUpdated);

            // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
            // { text, values } specs, not positional (query, replacements) args.
            // pgQuery was missing entirely before, so Postgres was never updated.
            const mysqlQuery = {
                text: `UPDATE availableItems SET itemsRemaining = ?, lastUpdated = ? WHERE productId = ?`,
                values: [itemsRemaining, normalizedDate, productId],
            };
            const pgQuery = {
                text: `UPDATE availableItems SET "itemsRemaining" = $1, "lastUpdated" = $2 WHERE "productId" = $3`,
                values: [itemsRemaining, normalizedDate, productId],
            };
            let result;
            try {
                result = await updateCachedOrQuery(cacheKey, { pgQuery, mysqlQuery });
                console.log('✅ productItemPricing updated successfully:', result);
            } catch (error) {
                console.error('❌ Error updating productItemPricing:', error);
                return logResponseDetails(req, res, {
                    status: 400,
                    success: false,
                    message: "❌ Error while updating available items",
                    error: error.message
                }, cacheKey, 400);
            }   

            if (!result || (typeof result.affectedRows === 'number' && result.affectedRows === 0) || (typeof result.rowCount === 'number' && result.rowCount === 0)) {
                return logResponseDetails(req, res, {
                    status: 400,
                    success: false,
                    message: `❌ No rows updated in ${cacheKey}. Invalid productId or no change.`,
                    result
                }, cacheKey, 400);
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
        console.log(error);
        return logResponseDetails(req, res, {
            status: 500,
            success: false,
            message: "❌ Error while updating available items",
            error: error.message
        }, cacheKey, 500);
    }
}

const addAvailableItems = async(req, res) => {
    logRequestDetails(req, "addAvailableItems");
    try {
        const { productId, itemsRemaining, _lastUpdated } = req.body;
        const lastUpdated = formatForMySQL(_lastUpdated);
        console.log("id => " + productId);
        console.log("itemsRemaining => " + itemsRemaining);
        console.log("lastUpdated => " + lastUpdated);
       
        if(productId == null || itemsRemaining == null || lastUpdated == null){
              return logResponseDetails(req, res, {
                status: 400,
                success: false,
                message: "Please Provide all fields"
            }, cacheKey, 400);
        } else {
            // Sanitize / normalize the datetime input string to avoid MySQL 'Incorrect datetime value' error
            const normalizedDate = formatForMySQL(lastUpdated);

            // NOTE: ControllerHandler now expects { pgQuery, mysqlQuery } as
            // { text, values } specs, not positional (query, replacements) args.
            // pgQuery was missing entirely before, so Postgres never received the insert/upsert.
            const mysqlQuery = {
                text: `
                    INSERT INTO availableItems (productId, itemsRemaining, lastUpdated)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE 
                        itemsRemaining = VALUES(itemsRemaining),
                        lastUpdated = VALUES(lastUpdated)
                `,
                values: [productId, itemsRemaining, normalizedDate],
            };
            const pgQuery = {
                text: `
                    INSERT INTO availableItems ("productId", "itemsRemaining", "lastUpdated")
                    VALUES ($1, $2, $3)
                    ON CONFLICT ("productId") DO UPDATE SET
                        "itemsRemaining" = EXCLUDED."itemsRemaining",
                        "lastUpdated" = EXCLUDED."lastUpdated"
                `,
                values: [productId, itemsRemaining, normalizedDate],
            };

            await addCachedAndQuery(cacheKey, { pgQuery, mysqlQuery });

            return logResponseDetails(req, res, {
                status: 200,
                success: true,
                message: "✅ Available items added/updated successfully"
            }, cacheKey, 200);
        }
    } catch (error) {
        console.log(error);
        return logResponseDetails(req, res, {
            status: 404,
            success: false,
            message: "Error in create/add item API", 
            error: error.message
        }, cacheKey, 400);
    }
}

export default { removeAvailableItemsById, addAvailableItems, deleteAvailableItems, getAvailableItems, updateAvailableItems };