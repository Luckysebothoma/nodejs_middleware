
import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
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

/*    try {

                // If not in cache, query the database
        const [data] = await dbSequelize.query('SELECT * FROM productList');
        
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
        }else {
            const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));

            
            // Return the filtered data
            res.json(objectsOnly);
        }

    } catch (error) {
        console.error(error);
        return logResponseDetails(req, res, {
      status: 500,
            success: false,
            message: "Error in fetching product list",
            error
        });
    }
*/

 console.log(`${cacheKey} backend started...`);

  const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
  const _pgQuery = `SELECT * FROM ${cacheKey}`;
  console.log("Now Quering : Key[" + cacheKey + "] mysl:[" + _mysqlQuery + "] pgSql:" + _pgQuery + "]");

  try {

    const data = await getCachedOrQuery(cacheKey, _mysqlQuery, _pgQuery);
    
//    return logResponseDetails(req, res, {
//        status: 200,
//        success: true,
//        data,
//        message: '🛒 Product list retrieved successfully',
//    });
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
const _getProductByID = async (productId) => {

    try {
        if (!productId) {

            return logResponseDetails(req, res, {
      status: 400,
                success: false,
                message: "Invalid or missing product ID"
           }, cacheKey, 500);
        } else {
            const query = 'SELECT * FROM productList WHERE productId = :productId'
                const replacements= [productId]

  console.log(`${getLongTime()} 🛠️ Starting DB update and cache for productId: [${productId}]`);

  try {
    const connection = getConnection();
    await connection.beginTransaction();
    console.log(`${getLongTime()} 🔄 MySQL Transaction started for productId: [${productId}]`);

    // MySQL Update
    try {
      [mysqlResult] = await connection.query(query, replacements);
 
      if (mysqlResult.affectedRows === 0) {
        console.warn(`⚠️ No record updated in MySQL for productId: [${productId}]`);

      } else {
        console.log(`${getLongTime()}✅ MySQL update succeeded for productId: [${productId}]`);

        return JSON.parse[mysqlResult];
      }
    } catch (mysqlErr) {
      console.Error(`${getLongTime()} ❌ MySQL update failed for productId: [${productId}]`, mysqlErr);
    }


    // Determine fallback result
    if (mysqlResult) {
    
    } else if (mysqlSuccess) {
      console.log(`✅ MUsing MySQL result only for key: [${key}]`);
 
    } else {
      throw new Error("❌  MySQL updates failed");
    }
 
    console.Error(`${getLongTime()} 🔥 Transaction rollback for key: [${key}] due to error:`, err.message);
    return `❌ Update failed for key: [${key}]`;

  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 Connection released for key: [${key}]`);
  }


        }
    } catch (error) {
        console.log(error);
        return logResponseDetails(req, res, {
      status: 400,
            success: false,
            message: "Error in getProductByID function, Passed ID=" + productId,
            error
       }, cacheKey, 500);
    }
};

const getProductByID = async(req,res) => {
    logRequestDetails(req, "getProductByID");

    try {
        productId = req.params.id;

        if(!productId){
             return logResponseDetails(req, res, {
      status: 404,
                    success:false,
                    message:"INvalid or Provide Student ID"
               }, cacheKey, 500)
        }else{
                //const data = await dbSequelize.query('SELECT * FRO students WHERE id='+productId);
                const data = await dbSequelize.query('SELECT * FROM productList WHERE id = :productId', {
                    replacements: { productId }, // Pass the parameter explicitly
                    type: dbSequelize.QueryTypes.SELECT
                }); 
                
                if(!data){
                 return logResponseDetails(req, res, {
      status: 404,
                        success:false,
                        message:"NO Recotdas found"
                   }, cacheKey, 500)

                }else{
                    return logResponseDetails(req, res, {
      status: 200,
                        success:true, 
                        studentDetails:data
                   }, cacheKey, 200)
                }
        }

    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res, {
      status: 500,
            success:false,
            message: "Error in Get Students by ID API, Passed ID=0"+ productId,
            error
       }, cacheKey, 500)
    }

}

const updateProduct = async (req, res) => {
  logRequestDetails(req, "updateProduct");

  const { productId, productName, productFlavor, productPrice, image_url } = req.body;

  // Basic validation
  if (!productId || !productName || !productFlavor || !productPrice || !image_url) {
    return logResponseDetails(req, res, {
      status: 400,
      success: false,
      message: `❌ Invalid input: ${JSON.stringify(req.body)}`
   }, cacheKey, 500);
  }

  // Use positional parameters (?)
  const query = `
    UPDATE ${cacheKey} 
    SET productName = ?, productFlavor = ?, productPrice = ?, image_url = ? 
    WHERE productId = ?
  `;

  const replacements = [productName, productFlavor, productPrice, image_url, productId];

  try {
    const result = await updateCachedOrQuery(cacheKey, query, replacements);

    console.log(`✅ ${cacheKey} updated successfully:`, result);

    if (!result || (result.affectedRows === 0 || result.rowCount === 0)) {
      return logResponseDetails(req, res, {
        status: 404,
        success: false,
        message: `❌ No rows updated in ${cacheKey}. Invalid productId or no changes.`,
        result
     }, cacheKey, 500);
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
         return logResponseDetails(req, res, {
      status: 404,
                success: false,
                message: "Please provide a product ID"
           }, cacheKey, 500);
        }

        const deletePromises = [
            dbSequelize.query('DELETE FROM productPricing WHERE productId = :productId', {
                replacements: { productId }, // Pass the parameter explicitly
                type: dbSequelize.QueryTypes.DELETE
            }),
            dbSequelize.query('DELETE FROM productList WHERE productId = :productId', {
                replacements: { productId }, // Pass the parameter explicitly
                type: dbSequelize.QueryTypes.DELETE
            })
        ];

        const [pricingDeleteResult, productListDeleteResult] = await Promise.all(deletePromises);

        // Check if both queries were successful
        if (pricingDeleteResult[0].affectedRows === 0 || productListDeleteResult[0].affectedRows === 0) {
         return logResponseDetails(req, res, {
      status: 404,
                success: false,
                message: "No product found with the provided ID"
           }, cacheKey, 500);
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

            const productId = req.params.id;
        console.log("Product Id: "+  productId);
        if(!productId){
         return logResponseDetails(req, res, {
      status: 404,
                success:false,
                message:"PLease provide student Id => " + productId
           }, cacheKey,500)
        }else{


try {
    const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
    const replacements = [productId];

    const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);

    if (result.affectedRows > 0) {
        return logResponseDetails(req,res,{
            success: true,
            message: `ID [${productId}] deleted successfully`,
       }, cacheKey,200);
    } else {
       return logResponseDetails(req,res,{
            success: false,
            message: `ID [${productId}] not found in [${cacheKey}]`,
       }, cacheKey,500);
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

        const connection = await getConnection();
        // Execute the query
        const dbres = await addCachedAndQuery(cacheKey,  query , replacements, connection);
        
        return logResponseDetails(req, res, dbres, cacheKey, 200)
        }



    } catch (error) {
         return logResponseDetails(req, res, error , cacheKey,500)
        
    }



}

export default {getProductList, getProductByID, updateProduct, deleteProduct, addProduct, purgingProduct, _getProductByID}
