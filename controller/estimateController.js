
import TimeUtils from '../utils/Time.js';

import ControllerHandler from "../utils/ControllerHandler.js";
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';


const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
 
const cacheKey = 'estimates'; // Key to store the list in Redis


const removeEstimateById = async(req, res) =>{

logRequestDetails(req, "removeEstimateById");

    
    try {

        const productId = req.params.id;

        if(!productId){
         return logResponseDetails(req, res, {
      status: 404,
     
                success:false,
                message:"PLease provide student Id => " + productId
            }, cacheKey, 404)
        }else{


try {
    const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
    const replacements = [productId];

     const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);
        result.info = cacheKey;

    return logResponseDetails(req, res, {
            success: true,
            message: `ID [${productId}] deleted successfully`,
        }, cacheKey,200)

} catch (error) {
   return logResponseDetails(req, res, {
        success: false,
        message: "Error occurred while trying to delete.",
        error,
},cacheKey,200)
}
 
        
	 
			
        }
        
    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res, {
      status: 500,
     
            success:false,
            message: "Error in Deleting Student",
            error
        }, cacheKey, 500)
    }

}


const getEstimates = async(req, res) =>{

logRequestDetails(req, "getEstimates");
  console.log( formattedDate() + ` ${cacheKey} backend started...`);

  const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
  const _pgQuery = `SELECT * FROM ${cacheKey}`;
  console.log(formattedDate() + "Now Quering : Key[" + cacheKey + "] mysql:[" + _mysqlQuery + "] pgSql:" + _pgQuery + "]");

  try {

    const data = await getCachedOrQuery(cacheKey, _mysqlQuery, _pgQuery);
        return logResponseDetails(req, res, data, cacheKey, 200);
    
    //res.status(200).send(data);
  } catch (error) {
    console.error(formattedDate() + `getCachedOrQuery error for ${cacheKey}:`, error);
    return logResponseDetails(req, res, {
      status: 500,
      success: false,
      message: `${formattedDate()} Error fetching ${cacheKey}`,
      error: error.message || error,
    },cacheKey, 500);
  }

}

// Adding to Pricing Table
const addEstimates = async(req, res) => {

logRequestDetails(req,cacheKey);

    try {

        /*
                productId: number;
    estimatedSelling:number;
    actualSelling:number;
    lastUpdated:Date;
        */


        const { productId, estimatedSelling,actualSelling,_lastUpdated} = req.body;
        const lastUpdated = formatForMySQL(_lastUpdated);
        console.log("id =>" +productId);
        console.log("estimatedSelling => " + estimatedSelling);
        console.log("actualSelling  => " + actualSelling);
        console.log("lastUpdated => " + lastUpdated);
       

        if(productId === undefined || productId === null ||
            estimatedSelling === undefined || estimatedSelling === null ||
            actualSelling === undefined || actualSelling === null ||
            lastUpdated === undefined || lastUpdated === null) {

         return logResponseDetails(req, res, {
      status: 500,
                success:false,
                message:"PLease Provide all fields"
            }, cacheKey, 500)

        }else{

        // SQL INSERT statement with ON DUPLICATE KEY UPDATE for MySQL
        const query_old = `
            INSERT INTO estimates (productId, estimatedSelling, actualSelling, lastUpdated)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                estimatedSelling = VALUES(estimatedSelling),
                actualSelling = VALUES(actualSelling),
                lastUpdated = VALUES(lastUpdated)
        `;

         const query = `
            INSERT INTO estimates (productId, estimatedSelling, actualSelling, lastUpdated)
            VALUES (?, ?, ?, ?)`;
        // Parameterized query with replacements
        const replacements = [productId, estimatedSelling,actualSelling,lastUpdated];

        // Execute the query
        addCachedAndQuery("estimates",query,replacements);
        
        
        }
    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res, {
      status: 404,
     
            success:false,
            message:"Error in create Student API ",
            error
        }, cacheKey, 500)
        
    }

}

//deletins
const deleteEstimates = async(req, res) =>{
logRequestDetails(req, "deleteEstimates");
            const id = req.body;
//            const productId = req.params.id;
 const productId = id;
        console.log(formattedDate() + "ID Pricing to delte: " + productId);

    try {

        console.log("ID Pricing to delte");
        console.log(productId);

        if(!productId){
             return logResponseDetails(req, res, {
      status: 404,
     
                success:false,
                message:"PLease provide student Id => " + productId
            }, cacheKey, 500)
        }else{


            try {
				

                const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
                                const pgQuery = `DELETE FROM ${cacheKey} WHERE productId= $1`;
                                const replacements = [productId];
                
                                await removeCachedAndQuery(cacheKey,mysqlQuery, replacements);
                
                return logResponseDetails(req, res, {
      status: 200,
     
                    success:true,
                    message:"ID [" + productId +"] DELETED Successfully"
                }, cacheKey, 200)



            } catch (error) {
                console.log(error)
                return logResponseDetails(req, res, {
      status: 500,
     
                    success:false,
                    message:"Something happening while trying to delete",
                    error
                }, cacheKey, 500)
                
            }    
        
	 
			
        }
        
    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res, {
      status: 500,
     
            success:false,
            message: "Error in Deleting Student",
            error
        }, cacheKey, 500)
    }

}

// UPdating 
const updateEstimates= async(req, res) => {
    logRequestDetails(req, "updateEstimates");
    const { productId, estimatedSelling,actualSelling,_lastUpdated} = req.body;
    const lastUpdated = formatForMySQL(_lastUpdated);

    console.log("id =>" +productId);
    console.log("estimatedSelling => " + estimatedSelling);
    console.log("actualSelling  => " + actualSelling);
    console.log("lastUpdated => " + lastUpdated);

    try {



        if(productId === undefined || productId === null ||
            estimatedSelling === undefined || estimatedSelling === null ||
            actualSelling === undefined || actualSelling === null ||
            lastUpdated === undefined || lastUpdated === null) {

            console.log("id =>" +productId);
            console.log("estimatedSelling => " + estimatedSelling);
            console.log("actualSelling  => " + actualSelling);
            console.log("lastUpdated => " + lastUpdated);

         return logResponseDetails(req, res, {
      status: 404,
     
                success:false,
                message:"Invalid IR Or provide id => "+ productId
            }, cacheKey, 404)

        }else{

            try {
    // Construct the SQL UPDATE statement for both MySQL and PostgreSQL
    const mysqlQuery = `UPDATE estimates SET estimatedSelling = ?, actualSelling = ?, lastUpdated = ? WHERE productId = ?`;
    const pgQuery = `UPDATE estimates SET estimatedSelling = $1, actualSelling = $2, lastUpdated = $3 WHERE productId = $4`;
    const replacements = [estimatedSelling, actualSelling, lastUpdated, productId];

    let result;
    try {
        result = await updateCachedOrQuery(cacheKey, mysqlQuery, pgQuery, replacements);
        console.log('✅ productItemPricing updated successfully:', result);
    } catch (error) {
        console.error('❌ Error updating productItemPricing:', error);
        throw error;
    }
        // respond with result
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
                return logResponseDetails(req, res, {
      status: 500,
     
                    success:false,
                    message:"Something wrong happened while updating the record \n _name" + _name + " _flavor" +_flavor + " _price" + _price + " _image_url" + _image_url, 
                    error
                }, cacheKey, 200)
            }
        }
        
    } catch (error) {
        
                    
        return logResponseDetails(req, res, {
      status: 500,
     
            success:false,
            message:"Error in Update Student API", 
            error
        }, cacheKey, 500)
    }
}

export default {removeEstimateById, getEstimates,addEstimates, deleteEstimates, updateEstimates}