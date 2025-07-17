 
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
    const mysqlQuery = `DELETE FROM ?? WHERE productId = ?`;
    const replacements = [cacheKey, productId];

    const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);
        result.info = cacheKey;
    if (result.affectedRows > 0) {
        res.status(200).send({
            success: true,
            message: `ID [${productId}] deleted successfully`,
        });
    } else {
        res.status(404).send({
            success: false,
            message: `ID [${productId}] not found in [${cacheKey}]`,
        });
    }

} catch (error) {
    console.error(error);
    res.status(500).send({
        success: false,
        message: "Error occurred while trying to delete.",
        error,
    });
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
    //res.status(200).send(data);

  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    return logResponseDetails(req, res,`Error in ${cacheKey}`,cacheKey,500)
  }
};

const deleteAvailableItems = async(req, res) =>{
        logRequestDetails(req, "deleteAvailableItems");


            const productId = req.params.id;
        console.log(formattedDate() + "ID Pricing to delte: " + productId);

    try {


        if(!productId){
              return logResponseDetails(req, res,  {
        status: 404,
                success:false,
                message:"PLease provide student Id => " + lastUpdated
            },cacheKey,500)
        }else{


            try {
				
const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
                const pgQuery = `DELETE FROM ${cacheKey} WHERE productId= $1`;
                const replacements = [productId];

                await removeCachedAndQuery(cacheKey,mysqlQuery, pgQuery, replacements);


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
        const { productId,  itemsRemaining , lastUpdated} = req.body;

        console.log("id =>" +productId);
        console.log("itemsRemaining => " + itemsRemaining);
        console.log("lastUpdated => " + lastUpdated);
       

        if(productId == null || productId == undefined || itemsRemaining==null 
            ||  itemsRemaining === undefined  || lastUpdated === null || lastUpdated === undefined ){
              return logResponseDetails(req, res,  {
        status: 500,
                success:false,
                message:"PLease Provide all fields"
            },cacheKey,500)

        }else{

            // SQL UPDATE statement
            const query = `UPDATE availableItems SET itemsRemaining =? ,lastUpdated=? WHERE productId =?`;

            // Parameterized query with replacements
            const replacements = [itemsRemaining, lastUpdated, productId];

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
                },cacheKey,400);
            }   // respond with result
        // Check if result is valid and rows were affected
        if (!result || (typeof result.affectedRows === 'number' && result.affectedRows === 0) || (typeof result.rowCount === 'number' && result.rowCount === 0)) {
            return logResponseDetails(req, res, {
            status: 400,
            success: false,
            message: `❌ No rows updated in ${cacheKey}. Invalid productId or no change.`,
            result
            },cacheKey,400);
        } else {
            return logResponseDetails(req, res, {
            status: 200,
            success: true,
            message: "✅ Available items updated successfully",
            result
            },cacheKey,200);
        }   
    }



    } catch (error) {
        console.log(error)
          return logResponseDetails(req, res,  {
        status: 500,
        success: false,
        message: "❌ Error while updating available items",
        error: error.message
        },cacheKey,500);
            
    }

}

const addAvailableItems = async(req, res) => {


    logRequestDetails(req, "addAvailableItems");

    try {
        const { productId,  itemsRemaining , lastUpdated} = req.body;

        console.log("id =>" +productId);
        console.log("itemsRemaining => " + itemsRemaining);
        console.log("lastUpdated => " + lastUpdated);
       

        if(productId == null || productId == undefined || itemsRemaining==null 
            ||  itemsRemaining === undefined  || lastUpdated === null || lastUpdated === undefined ){
              return logResponseDetails(req, res,  {
        status: 400,
                success:false,
                message:"PLease Provide all fields"
            },cacheKey,400)

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO availableItems (productId, itemsRemaining, lastUpdated)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE 
                itemsRemaining = VALUES(itemsRemaining),
                lastUpdated = VALUES(lastUpdated)
        `;   // Parameterized query with replacements
        const replacements = [productId, itemsRemaining, lastUpdated];

        addCachedAndQuery(cacheKey, query , replacements);
        
        
        }



    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res,  {
        status: 404,
            success:false,
            message:"Error in create Student API ", error
        },cacheKey,400)
        
    }

}

export default {removeAvailableItemsById, addAvailableItems, deleteAvailableItems, getAvailableItems, updateAvailableItems};