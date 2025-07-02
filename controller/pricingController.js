
import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';


const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;

const cacheKey = 'productPricing'; // Key to store the list in Redis

const getPricingList = async(req, res) =>{
    logRequestDetails(req, "getPricingList")
/*    try {

        // If not in cache, query the database
        console.log('Cache Missed: from '+  cacheKey);
        const [data] = await dbSequelize.query('SELECT * FROM productPricing')
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

                if(objectsOnly){
                    

                    // Send the filtered data to the client
                    res.json(objectsOnly);
                }else{

                    console.log("Something wrong with storing cache for ", cacheKey);
                }
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
    return logResponseDetails(req, res, {
        status: 200,
        success: true,
        data,
    });
  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    return logResponseDetails(req, res, {
      status: 500,
     
      success: false,
      message: `Error fetching ${cacheKey}`,
      error: error.message || error,
    });
  }


}

// Adding to Pricing Table
const add2Pricing = async(req, res) => {
    logRequestDetails(req, "add2Pricing")
    try {
        const { productId, costPerItem,sellingPrice,productCommission, productProfit, productQuantity, productSize} = req.body;

        console.log("id =>" +productId);
        console.log("costPerItem => " + costPerItem);
        console.log("sellingPrice  => " + sellingPrice);
        console.log("productCommission => " + productCommission);
        console.log("productProfit =>" +productProfit);
        console.log("productQuantity => " + productQuantity);
        console.log("productSize  => " + productSize);
       

        if(
            productId ==null || costPerItem==null || sellingPrice==null || productCommission==null ||  productProfit ==null ||  productQuantity==null ||  productSize==null 
            || productId==undefined || costPerItem==undefined || sellingPrice==undefined || productCommission==undefined ||  productProfit ==undefined ||  productQuantity==undefined ||  productSize==undefined 

        ){
         return logResponseDetails(req, res, {
      status: 500,
     
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO productPricing (productId, costPerItem,sellingPrice,productCommission, productProfit, productQuantity, productSize)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        // Parameterized query with replacements
        const replacements = [productId, costPerItem,sellingPrice,productCommission, productProfit, productQuantity, productSize];

        // Execute the query
        addCachedAndQuery(cacheKey, query, query, replacements);
        
        
        }
    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res, {
      status: 404,
     
            success:false,
            message:"Error in create Student API ",
            error
        })
        
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

const getYummyList = async(req, res) =>{
    logRequestDetails(req, "getYummyList")
/*    try {
        
        const [data] = 
        await dbSequelize.
        query('SELECT productList.productId, productList.productName AS column1_table1, productList.productFlavor AS column2_table1, productList.productPrice AS column1_table1, productPricing.costPerItem AS column1_table2, productPricing.sellingPrice AS column2_table2 , productPricing.productCommission AS column2_table2 , productPricing.productProfit AS column2_table2 , productPricing.productQuantity AS column2_table2 , productPricing.productSize AS column2_table2 FROM productList JOIN productPricing ON productList.productId = productPricing.productId')

        if(!data){
            return return logResponseDetails(req, res, {
      status: 404,
     
                success:false,
                message:"No Pricing Found"
            })
        }else{
            
            const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));

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

const yummyCacheKey = 'yummyList';
console.log(`${yummyCacheKey} backend started...`);

const _mysqlQuery = `
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
`;
const _pgQuery = _mysqlQuery;
console.log("Now Quering : Key[" + yummyCacheKey + "] mysl:[" + _mysqlQuery + "] pgSql:" + _pgQuery + "]");

try {
    const data = await getCachedOrQuery(yummyCacheKey, _mysqlQuery, _pgQuery);
    return logResponseDetails(req, res, {
      status: 200,
     
        success: true,
        data,
    });
} catch (error) {
    console.error(`getCachedOrQuery error for ${yummyCacheKey}:`, error);
    return logResponseDetails(req, res, {
      status: 500,
     
        success: false,
        message: `Error fetching ${yummyCacheKey}`,
        error: error.message || error,
    });
}

}

//deletins

const deletePricing = async(req, res) =>{
    logRequestDetails(req, "deletePricing");

    const productId  = req.params.id; // Extract student ID from the request URL

    try {

                console.log(formattedDate() + "ID Pricing to delte: " + productId);


        if(!productId){
         return logResponseDetails(req, res, {
      status: 404,
     
                success:false,
                message:"PLease provide student Id => " + productId
            })
        }else{


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
 
        
	 
			
        }
        
    } catch (error) {
        console.log(error)
        return logResponseDetails(req, res, {
      status: 500,
     
            success:false,
            message: "Error in Deleting Student",
            error
        })
    }

}

// UPdating 

const updateProductPricing= async(req, res) => {
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
        costPerItem,productCommission, productId, itemGrouping,
        productProfit, productQuantity, productSize, sellingPrice
    
        } = req.body;

        if(
            productId ==null || costPerItem==null || sellingPrice==null || productCommission==null ||  productProfit ==null ||  productQuantity==null ||  productSize==null 
            || productId==undefined || costPerItem==undefined || sellingPrice==undefined || productCommission==undefined ||  productProfit ==undefined ||  productQuantity==undefined ||  productSize==undefined 
        ){
            console.log ("ERROR ->> Error ");    
            console.log (" productId[" + productId + "]")
            console.log( " costPerItem[" + costPerItem + "]")
            console.log( " sellingPrice[" + sellingPrice + "]")
            console.log( " productCommission[" + productCommission + "]")
            console.log( " productProfit[" + productProfit + "]")
            console.log( " productQuantity[" + productQuantity + "]")
            console.log( " productSize[" + productSize + "]")
            console.log( " itemGrouping[" + itemGrouping + "]")

            console.log( " **************************************************")
    
    
         return logResponseDetails(req, res, {
      status: 500,
     
                success:false,
                message:"PLease Provide all fields"
            })

            
        }else{
            console.log ("SUCCESSFULLY READ");    
            console.log (" productId[" + productId + "]")
            console.log( " costPerItem[" + costPerItem + "]")
            console.log( " sellingPrice[" + sellingPrice + "]")
            console.log( " productCommission[" + productCommission + "]")
            console.log( " productProfit[" + productProfit + "]")
            console.log( " productQuantity[" + productQuantity + "]")
            console.log( " productSize[" + productSize + "]")
            console.log( " itemGrouping[" + itemGrouping + "]")

            console.log( " **************************************************")
    
                /* Sql STatement to UPdate */

                try {
    // Construct the SQL UPDATE statement with replacements
    const query = `UPDATE productPricing SET costPerItem = ?, sellingPrice = ?, productCommission = ?, productProfit = ?,productQuantity = ?,productSize = ?,itemGrouping = ? WHERE productId = ?`;
    const replacements = [
        costPerItem,
        sellingPrice,
        productCommission,
        productProfit,
        productQuantity,
        productSize,
        itemGrouping,
        productId
    ];

    console.log('Updating productPricing with replacements:', replacements);

    let result;
    try {
        result = await updateCachedOrQuery(cacheKey, query, replacements);
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
            });
        } else {
            return logResponseDetails(req, res, {
            status: 200,
            success: true,
            message: "✅ Available items updated successfully",
            result
            });
        } 

                } catch (error) {
                    console.log(error);
                    return logResponseDetails(req, res, {
      status: 500,
     
                        success:false,
                        message:"Something wrong happened while updating the record \n _name" + _name + " _flavor" +_flavor + " _price" + _price + " _image_url" + _image_url, 
                        error
                    })
                }

            
       
  
            
        }







        
    }

const updatePricingList= async(req, res) => {
    logRequestDetails(req, "updatePricingList");

    const {productId, costPerItem,sellingPrice,productCommission, 
            productProfit, productQuantity, productSize} = req.body;



    try {



        if(!productId){
            console.log("productId Provided=> " + productId)
         return logResponseDetails(req, res, {
      status: 404,
     
                success:false,
                message:"** Invalid IR Or provide id ** "
                + " productId[" + productId + "]"
                + " costPerItem[" + costPerItem + "]"
                + " sellingPrice[" + sellingPrice + "]"
                + " productCommission[" + productCommission + "]"
                + " productProfit[" + productProfit + "]"
                + " productQuantity[" + productQuantity + "]"
                + " productSize[" + productSize + "]"
                + " **************************************************"


            })

        }else{


            console.log("id =>" +productId);
            console.log("costPerItem => " + costPerItem);
            console.log("sellingPrice  => " + sellingPrice);
            console.log("productCommission => " + productCommission);
            console.log("productProfit =>" +productProfit);
            console.log("productQuantity => " + productQuantity);
            console.log("productSize  => " + productSize);// Extract updated values from the request body 
        
            if(  
                productId ==null || costPerItem==null || sellingPrice==null || productCommission==null ||  productProfit ==null ||  productQuantity==null ||  productSize==null 
                || productId==undefined || costPerItem==undefined || sellingPrice==undefined || productCommission==undefined ||  productProfit ==undefined ||  productQuantity==undefined ||  productSize==undefined 
    
            ){
                console.log("Values provided are not valid");
    

            try {
                // Prepare SQL queries for both MySQL and PostgreSQL
                const mysqlQuery = `UPDATE ${cacheKey} SET costPerItem = ?, sellingPrice = ?, productCommission = ?, productProfit = ?, productQuantity = ?, productSize = ? WHERE productId = ?`;
                const pgQuery = `UPDATE ${cacheKey} SET costPerItem = $1, sellingPrice = $2, productCommission = $3, productProfit = $4, productQuantity = $5, productSize = $6 WHERE productId = $7`;
                const replacements = [
                    costPerItem,
                    sellingPrice,
                    productCommission,
                    productProfit,
                    productQuantity,
                    productSize,
                    productId
                ];

                const result = await updateCachedOrQuery(cacheKey, mysqlQuery, pgQuery, replacements);

                console.log('✅ productPricing updated successfully:', result);

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
                    });
                } else {
                    return logResponseDetails(req, res, {
                        status: 200,
                        success: true,
                        message: "✅ productPricing updated successfully",
                        result
                    });
                }
            } catch (error) {
                console.error('❌ Error updating productPricing:', error);
                return logResponseDetails(req, res, {
                    status: 500,
                    success: false,
                    message: "Something went wrong while updating the record.",
                    error
                });
            }
            }
        }
        
    } catch (error) {
        
                    
        return logResponseDetails(req, res, {
      status: 500,
     
            success:false,
            message:"Error in Update Student API", 
            error
        })
    }
}


export default {deletePricing,getPricingList, add2Pricing, getYummyList, updateProductPricing, updatePricingList}