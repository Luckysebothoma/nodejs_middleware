 
import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';
 import { getConnection } from '../config/db.js';


const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
const cacheKey = 'productItemPricing'; // Key to store the list in Redis


const getProductItemPricingList = async(req, res) =>{
    logRequestDetails(req, "getProductItemPricingList");
  console.log(`${cacheKey} backend started...`);

  const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
  const _pgQuery = `SELECT * FROM ${cacheKey}`;
  console.log("Now Quering : Key[" + cacheKey + "] mysl:" + _mysqlQuery + "pgSql:" + _pgQuery);

  try {

    const data = await getCachedOrQuery(cacheKey, _mysqlQuery, _pgQuery);
    logResponseDetails(req, res, data, cacheKey,200);
    //res.status(200).send(data);
  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    res.status(500).send({
      success: false,
      message: `Error fetching ${cacheKey}`,
      error: error.message || error,
   }, cacheKey,500);
  }

}

// Adding to Pricing Table
const addProductItemPricing = async(req, res) => {
logRequestDetails(req, "addProductItemPricing");
    console.log("Now addProductItemPricing");

    try {
        const { productId, productDescription,itemGroup,itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission} = req.body;

        console.log("id =>" +productId);
        console.log("productDescription => " + productDescription);
        console.log("itemGroup  => " + itemGroup);
        console.log("itemsRemainder => " + itemsRemainder);
        console.log("costOfRemainder =>" +costOfRemainder);
        console.log("groupedQuantity => " + groupedQuantity);
        console.log("groupedProfit  => " + groupedProfit);
        console.log("groupedProfit  => " + groupedCommission);

       

        if(
            productId ==null || productDescription==null || itemGroup==null || itemsRemainder==null ||  costOfRemainder ==null ||  groupedQuantity==null ||  groupedProfit==null ||  groupedCommission==null 
            || productId==undefined || productDescription==undefined || itemGroup==undefined || itemsRemainder==undefined ||  costOfRemainder ==undefined ||  groupedQuantity==undefined ||  groupedProfit==undefined || groupedCommission==undefined 

        ){
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
           }, cacheKey,500)

        }else{

        // SQL INSERT statement with ON DUPLICATE KEY UPDATE
        const query_db = `
            INSERT INTO productItemPricing (productId, productDescription, itemGroup, itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                productDescription = VALUES(productDescription),
                itemGroup = VALUES(itemGroup),
                itemsRemainder = VALUES(itemsRemainder),
                costOfRemainder = VALUES(costOfRemainder),
                groupedQuantity = VALUES(groupedQuantity),
                groupedProfit = VALUES(groupedProfit),
                groupedCommission = VALUES(groupedCommission)
        `;

         const query = `
            INSERT INTO productItemPricing (productId, productDescription, itemGroup, itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        // Parameterized query with replacements
        const replacements = [productId, productDescription,itemGroup,itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission];
       const connection = await getConnection();
        // Execute the query
        const dbres = await addCachedAndQuery(cacheKey,  query , replacements, connection);
        logResponseDetails(req, res, dbres, cacheKey,200)
        
        
        }
    } catch (error) {
        
        logResponseDetails(req,res,{
            success:false,
            message:"Error in create Student API ",
            error
       }, cacheKey,500)
        
    }

}

const deleteProductItemPricing = async(req, res) =>{
logRequestDetails(req, "deleteProductItemPricing");
    const productId = req.body.id;
     console.log("removeEstimateById Request Params: ", req.params);
    console.log("removeEstimateById Product ID: ", productId);

                    console.log(formattedDate() + "ID Pricing to delte: " + productId);
        if(!productId){
            
                return logResponseDetails(req, res, {
                success:false,
                message:"PLease provide student Id => " + productId
           }, cacheKey,500)
        }

                    try {
                    const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
                    const replacements = [productId];

                    const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);




                return logResponseDetails(req, res, {
                            success: true,
                            message: `ID [${productId}] deleted successfully`,
                            result
                    }, cacheKey,200)

                } catch (error) {
                return logResponseDetails(req, res, {
                        success: false,
                        message: "Error occurred while trying to delete.",
                        error,
                }, cacheKey,404);
                }


}

// UPdating 

const updateProductItemPricing= async(req, res) => {
logRequestDetails(req, "updateProductItemPricing");

    //const productId  = req.params.id; // Extract student ID from the request URL


    const { productId, productDescription,itemGroup,itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission} = req.body;


    if(
        productId ==null || productDescription==null || itemGroup==null || itemsRemainder==null ||  costOfRemainder ==null ||  groupedQuantity==null ||  groupedProfit==null ||  groupedCommission==null 
        || productId==undefined || productDescription==undefined || itemGroup==undefined || itemsRemainder==undefined ||  costOfRemainder ==undefined ||  groupedQuantity==undefined ||  groupedProfit==undefined || groupedCommission==undefined 

    ){
            console.log ("ERROR ->> Error ");    
            console.log (" productId[" + productId + "]")
            console.log( " productDescription[" + productDescription + "]")
            console.log( " itemGroup[" + itemGroup + "]")
            console.log( " itemsRemainder[" + itemsRemainder + "]")
            console.log( " costOfRemainder[" + costOfRemainder + "]")
            console.log( " groupedQuantity[" + groupedQuantity + "]")
            console.log( " groupedProfit[" + groupedProfit + "]")
            console.log("groupedProfit  => " + groupedCommission);

            console.log( " **************************************************")
    
    
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
           }, cacheKey,500)

            
        }else{
            console.log ("SUCCESSFULLY READ");    
            console.log (" productId[" + productId + "]")
            console.log( " productDescription[" + productDescription + "]")
            console.log( " itemGroup[" + itemGroup + "]")
            console.log( " itemsRemainder[" + itemsRemainder + "]")
            console.log( " costOfRemainder[" + costOfRemainder + "]")
            console.log( " groupedQuantity[" + groupedQuantity + "]")
            console.log( " groupedProfit[" + groupedProfit + "]")
            console.log("groupedProfit  => " + groupedCommission);
            console.log( " **************************************************")
    
                /* Sql STatement to UPdate */

                try {
                    // Construct the SQL UPDATE statement with positional parameters
                    const query = `UPDATE productItemPricing SET productDescription = ?, itemGroup = ?, itemsRemainder = ?, costOfRemainder = ?, groupedQuantity = ?, groupedProfit = ?, groupedCommission = ? WHERE productId = ?`;

                    const replacements = [
                        productDescription,
                        itemGroup,
                        itemsRemainder,
                        costOfRemainder,
                        groupedQuantity,
                        groupedProfit,
                        groupedCommission,
                        productId
                    ];

                    const result = await updateCachedOrQuery(cacheKey, query, replacements);


                    
return logResponseDetails(req, res, {
            status: 200,
            success: true,
            message: "✅ Available items updated successfully",
            result
           }, cacheKey,200)


                } catch (error) {
                     return logResponseDetails(req, res, {
            status: 404,
            success: false,
            message: '❌ Error updating productItemPricing:', error,
           }, cacheKey,404);
                }

            
       
     

            return res.status(200).send({
                success:true,
                message:"Successfully UPdated"
           }, cacheKey,500)
            
        }







        
    }
        

export default {getProductItemPricingList, addProductItemPricing, deleteProductItemPricing, updateProductItemPricing }