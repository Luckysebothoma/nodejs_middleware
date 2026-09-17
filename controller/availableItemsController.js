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
const formatForMySQL = (dateInput) => {
    if (!dateInput) return formattedDate ? formattedDate() : new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) {
        // Fallback if parsing fails entirely, return current date formatted
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    
    // Converts to 'YYYY-MM-DD HH:MM:SS' format required by MySQL
    return date.toISOString().slice(0, 19).replace('T', ' ');
};

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
    const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
    const replacements = [productId];
    const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);
        result.info = cacheKey;
    logResponseDetails(req,res,result, cacheKey,200);
} catch (error) {
    console.error(error);
        logResponseDetails(req,res,error, cacheKey,500);
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
  const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
  const _pgQuery = `SELECT * FROM ${cacheKey}`;
  console.log("Now Quering : Key[" + cacheKey + "] mysl:" + _mysqlQuery + "pgSql:" + _pgQuery);
  try {
    const data = await getCachedOrQuery(cacheKey, _mysqlQuery, _pgQuery);
    logResponseDetails(req,res,data,cacheKey,200)
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
				
                const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
                const pgQuery = `DELETE FROM ${cacheKey} WHERE productId= $1`;
                const replacements = [productId];
                await removeCachedAndQuery(cacheKey, mysqlQuery, pgQuery, replacements);
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
        const { productId, itemsRemaining, lastUpdated } = req.body;
       
        if(productId == null || itemsRemaining == null || lastUpdated == null){
              return logResponseDetails(req, res, {
                status: 500,
                success: false,
                message: "Please Provide all fields"
            }, cacheKey, 500);
        } else {
            // Sanitize / normalize the date value for MySQL
            const normalizedDate = formatForMySQL(lastUpdated);

            const query = `UPDATE availableItems SET itemsRemaining = ?, lastUpdated = ? WHERE productId = ?`;
            const replacements = [itemsRemaining, normalizedDate, productId];
            let result;
            try {
                result = await updateCachedOrQuery(cacheKey, query, replacements);
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
        const { productId, itemsRemaining, lastUpdated } = req.body;
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

            // SQL INSERT statement
            const query = `
                INSERT INTO availableItems (productId, itemsRemaining, lastUpdated)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                    itemsRemaining = VALUES(itemsRemaining),
                    lastUpdated = VALUES(lastUpdated)
            `;   
            
            // Parameterized query with normalized replacements
            const replacements = [productId, itemsRemaining, normalizedDate];
            await addCachedAndQuery(cacheKey, query, replacements);

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