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


const cacheKey = 'stockedItems'; // Key to store the list in Redis

const getStockList = async(req, res) =>{
    logRequestDetails(req, "getStockList");
 console.log(`${cacheKey} backend started...`);

  const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
  const _pgQuery = `SELECT * FROM ${cacheKey}`;
  console.log("Now Quering : Key[" + cacheKey + "] mysl:[" + _mysqlQuery + "] pgSql:" + _pgQuery + "]");

  try {

    const data = await getCachedOrQuery(cacheKey, _mysqlQuery, _pgQuery);
    res.status(200).send(data);

  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    res.status(500).send({
      success: false,
      message: `Error fetching ${cacheKey}`,
      error: error.message || error,
    });
  }

}

const deleteStock = async(req, res) =>{
    logRequestDetails(req, "deleteStock");
    try {

               const productId = req.body.id;
        if(!lastUpdated){
return logResponseDetails(req,res,{
                success:false,
                message:"PLease provide student Id => " + productId
            })
        }else{


try {
    const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
    const replacements = [productId];

    const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);

return logResponseDetails(req,res,{
            success: true,
            message: `ID [${productId}] deleted successfully`,
            result
        },cacheKey,200)

} catch (error) {
return logResponseDetails(req,res,{
        success: false,
        message: "Error occurred while trying to delete.",
        error,
    });
}

  
        
	 
			
        }
        
    } catch (error) {
        console.log(error)
        res.status(500).send({
            success:false,
            message: "Error in Deleting Student",
            error
        })
    }

}

const addStock = async(req, res) => {
 logRequestDetails(req, "addStock");
    try {
        const { productId, productName,productFlavor,productPrice, lastUpdated, productQuantity} = req.body;

        console.log("id =>" +productId);
        console.log("name => " + productName);
        console.log("flavor  => " + productFlavor);
        console.log("price => " + productPrice);
        console.log("lastUpdated=> " + lastUpdated);
        console.log("productQuantity => " + productQuantity);
       

        if(
            productId ==null || productName ==null || productFlavor ==null || productPrice ==null || lastUpdated ==null || productQuantity ==null
            || productId==undefined || productName==undefined || productFlavor==undefined || productPrice==undefined || lastUpdated==undefined || productQuantity ==undefined

        ){
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO stockItems (productId, productName, productFlavor, productPrice, lastUpdated, productQuantity)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            productName = VALUES(productName),
            productFlavor = VALUES(productFlavor),
            productPrice = VALUES(productPrice),
            lastUpdated = VALUES(lastUpdated),
            productQuantity = VALUES(productQuantity)
        `;

        // Parameterized query with replacements
        const replacements = [productId, productName,productFlavor,productPrice, lastUpdated, productQuantity];

        // Execute the query
                  
            addCachedAndQuery(cacheKey, query , replacements)
            
            

        
        
        }



    } catch (error) {
        console.log(error)
        res.status(404).send({
            success:false,
            message:"Error in create Student API ",
            error
        })
        
    }

}

const addStockedItems = async(req, res) => {
    logRequestDetails(req, "addStockedItems");
    const { productId, stockDate,stockId,stockPrice, stockQuantity} = req.body;


    try {

        console.log("id =>" +productId);
        console.log("stockDate => " + stockDate);
        console.log("stockId  => " + stockId);
        console.log("stockPrice => " + stockPrice);
        console.log("stockQuantity => " + stockQuantity);
       

        if(
            productId ==null || stockDate ==null || stockId ==null || stockPrice ==null || stockQuantity ==null
            || productId==undefined || stockDate==undefined || stockId==undefined || stockPrice==undefined || stockQuantity==undefined

        ){
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields",
                response:"There are missing fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO stockedItems (productId, stockDate, stockId, stockPrice, stockQuantity)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            stockDate = VALUES(stockDate),
            stockId = VALUES(stockId),
            stockPrice = VALUES(stockPrice),
            stockQuantity = VALUES(stockQuantity)
        `;

        // Parameterized query with replacements
        const replacements = [productId, stockDate,stockId,stockPrice, stockQuantity];

        
        const result = await addCachedAndQuery("stockedItems", query , replacements)

        res.status(200).send({
            success:true,
            message:"Stocked Item Added Successfully",
        })
        
        }



    } catch (error) {
        console.log(error)
        res.status(404).send({
            success:false,
            message:"Error in create Student API ",
            error
        })
        
    }

}

const removeStockedItems = async(req, res) =>{
logRequestDetails(req, "removeStockedItems");


    const productId  = req.params.id; // Extract student ID from the request URL

    try {

        console.log(formattedDate() + "ID Pricing to delte: " + productId);

        if(!productId){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + productId
            })
        }else{


try {
    const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
    const replacements = [productId];

    const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);

           return logResponseDetails(req,res,{
            success: true,
            message: `ID [${productId}] deleted successfully`,
        },cacheKey,200);

} catch (error) {
return logResponseDetails(req,res,{
        success: false,
        message: "Error occurred while trying to delete.",
        error,
    },cacheKey, 500);
}
  
        
	 
			
        }
        
    } catch (error) {
return logResponseDetails(req,res,{
            success:false,
            message: "Error in Deleting Student",
            error
        })
    }

}


export default {addStock, getStockList, deleteStock, addStockedItems, removeStockedItems};