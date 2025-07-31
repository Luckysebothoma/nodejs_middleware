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

const removeEstimateById = async(req, res) =>{
    logRequestDetails(req, "removeEstimateById");

    try {

        
             const productId = req.params.id;

//            const productId = req.params.id;
         if(!productId){
         return logResponseDetails(req, res, {
      status: 404,
     
                success:false,
                message:"PLease provide student Id => " + productId
            }, cacheKey, 500)
        }else{


            try {
				

                 const data = await dbSequelize.query('DELETE FROM priceTracing WHERE productId = :productId', {
                    replacements: { productId }, // Pass the parameter explicitly
                    type: dbSequelize.QueryTypes.DELETE
                }); 
        data.info = cacheKey;

                return logResponseDetails(req, res, {
      status: 200,
     
                    success:true,
                    message:data
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

const removePriceTracing = async(req, res) =>{
    logRequestDetails(req, "removePriceTracing")
    try {

    const productId = req.body.id;
        if(!productId){
         return logResponseDetails(req, res, {
      status: 404,
     
                success:false,
                message:"PLease provide student Id => " + productId
            }, cacheKey, 500)
        }else{


try {
    const mysqlQuery = `DELETE FROM ?? WHERE productId = ?`;
    const replacements = [cacheKey, productId];

    const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);

    if (result.affectedRows > 0) {
        return logResponseDetails(req, res, {
            success: true,
            message: `ID [${productId}] deleted successfully`,
        },cacheKey,200);
    } else {
        return logResponseDetails(req, res, {
            success: false,
            message: `ID [${productId}] not found in [${cacheKey}]`,
        },cacheKey,200);
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
      //  console.log(error)
        return logResponseDetails(req, res, {
            success:false,
            message: "Error in Deleting Student",
            error
        }, cacheKey, 500)
    }

}

const getPriceTracing = async(req, res) =>{

    logRequestDetails(req, "getPriceTracing")

 /*   try {
           // If not in cache, query the database
            console.log('Cache miss: Querying database');
        
            const [data] = await dbSequelize.query('SELECT * FROM priceTracing ')


            if (!data) { 
                return return logResponseDetails(req, res, {
      status: 404,
     
                    success: false,
                    message: "Resource not found"
                });
            } else if (data.length === 0) {
                return return logResponseDetails(req, res, {
      status: 200,
     
                    success: true,
                    data: [],
                    message: "No data available"
                });
            }else{
                
                const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));
                // Cache the data in Redis (set it for 1 hour)

                // Send the filtered data to the client
                res.json(objectsOnly);
            }



    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res, {
      status: 500,
     
            success:false,
            message:"Error in getting all",
            error
        })
    }
*/


  console.log(`${cacheKey} backend started...`);

  const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
  const _pgQuery = `SELECT * FROM ${cacheKey}`;
  console.log("Now Quering : Key[" + cacheKey + "] mysl:[" + _mysqlQuery + "] pgSql:" + _pgQuery + "]");

  try {

    const data = await getCachedOrQuery(cacheKey, _mysqlQuery, _pgQuery);
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
}

// Adding to Pricing Table
const addPriceTracing  = async(req, res) => {

    logRequestDetails(req, "addPriceTracing")

    try {

        /*
                productId: number;
    estimatedSelling:number;
    actualSelling:number;
    lastUpdated:Date;
        */


        const { productId, accAmount ,lastUpdated} = req.body;

        console.log("id =>" +productId);
        console.log("accAmount => " + accAmount);
        console.log("lastUpdated => " + lastUpdated);
       

        if( productId == null ||  accAmount== null ||  lastUpdated== null
            || productId == undefined ||  accAmount== undefined ||  lastUpdated== undefined
        
        ){
         return logResponseDetails(req, res, {
      status: 500,
     
                success:false,
                message:"PLease Provide all fields"
            }, cacheKey, 500)

        }else{
            
        const query = `
            INSERT INTO ${cacheKey} (productId, date, accAmount)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
            accAmount = VALUES(accAmount),
            date = VALUES(date);
        `;
        // Parameterized query with replacements
        const replacements = [productId,lastUpdated,accAmount];

        // Execute the query
        addCachedAndQuery(cacheKey,query , replacements)
        
        
        }
    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res, {
      status: 404,
     
            success:false,
            message:"Error in create Student API ",
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
        return res.status(400).json({
            success: false,
            message: `Invalid or missing productId: ${productId}`
        });
    }

try {
    const mysqlQuery = `DELETE FROM ?? WHERE productId = ?`;
    const replacements = [cacheKey, productId];

    const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);

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


};

// UPdating 

const updatePriceTracing = async(req, res) => {
    logRequestDetails(req, "updatePriceTracing")
    //        const { productId, accAmount ,lastUpdated} = req.body;

    const { productId, accAmount ,lastUpdated} = req.body;
    console.log("++  updatePriceTracing ++ ");
    console.log("id =>" +productId);
    console.log("accAmount => " + accAmount);
    console.log("lastUpdated => " + lastUpdated);

    try {



        if(
            productId == null ||  accAmount== null ||  lastUpdated== null
            || productId == undefined ||  accAmount== undefined ||  lastUpdated== undefined
        ){

            console.log("id =>" +productId);
            console.log("accAmount => " + accAmount);
            console.log("lastUpdated => " + lastUpdated);

         return logResponseDetails(req, res, {
      status: 404,
     
                success:false,
                message:"Invalid IR Or provide id => "+ productId
            }, cacheKey, 500)

        }else{

            try {
                // Prepare SQL queries for both MySQL and PostgreSQL
                const mysqlQuery = `UPDATE ${cacheKey} SET accAmount = ?, date = ? WHERE productId = ?`;
                const pgQuery = `UPDATE ${cacheKey} SET accAmount = $1, date = $2 WHERE productId = $3`;
                const replacements = [accAmount, lastUpdated, productId];

                const result = await updateCachedOrQuery(cacheKey, mysqlQuery, replacements);

                console.log('✅ priceTracing updated successfully:', result);

                // Check if any rows were affected/updated
                if (
                    !result ||
                    (typeof result.affectedRows === 'number' && result.affectedRows === 0) ||
                    (typeof result.rowCount === 'number' && result.rowCount === 0)
                ) {
                    return logResponseDetails(req, res, {
                        status: 404,
                        success: false,
                        message: `❌ No rows updated in ${cacheKey}. Invalid productId or no change.`,
                        result
                    }, cacheKey, 500);
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
     
            success:false,
            message:"Error in Update Student API", 
            error
        }, cacheKey, 500)
    }
}



export default {removePriceTracing, removeEstimateById, getPriceTracing ,addPriceTracing , deletePriceTracing , updatePriceTracing }