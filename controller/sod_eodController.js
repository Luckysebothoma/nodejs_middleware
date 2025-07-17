 
import { query } from "express";
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
const cacheKey = 'sodEodItems'; // Key to store the list in Redis


const getSodEodList = async(req, res) =>{
logRequestDetails(req, "getSodEodList");
  console.log(`${cacheKey} backend started...`);

  const _mysqlQuery = `SELECT * FROM ${cacheKey}`;
  const _pgQuery = `SELECT * FROM ${cacheKey}`;
  console.log("Now Quering : Key[" + cacheKey + "] mysl:" + _mysqlQuery + "pgSql:" + _pgQuery);

  try {

    const data = await getCachedOrQuery(cacheKey, _mysqlQuery, _pgQuery);
    res.status(200).send(data);
  } catch (error) {
    console.error(`getCachedOrQuery error for ${cacheKey}:`, error);
    res.status(500).send({
      success: false,
      message: `Error fetching ${cacheKey}`,
      error: error.message || error,
   }, cacheKey,500);
  }
}

const addSodEodList = async(req, res) => {
logRequestDetails(req, "addSodEodList");

    const { productId, itemsTaken, itemsRemaining , lastUpdated, productName, availableItems, outOfStock} = req.body;

    //  displayedColumnsSodEod: string[] = ['productId', 'itemsTaken', 'itemsRemaining', 'date', 'productName', 'availableItems', 'outOfStock'


    console.log("id =>" +productId);
    console.log("itemsRemaining => " + itemsRemaining);
    console.log("lastUpdated => " + lastUpdated);
    console.log("productName =>" +productName);
    console.log("itemsTaken => " + itemsTaken);
    console.log("itemsTaken => " + availableItems);
    console.log("itemsTaken => " + outOfStock);



    if(productId === undefined || productId === null ||
        itemsRemaining === undefined || itemsRemaining === null ||
        itemsTaken === undefined || itemsTaken === null ||
        lastUpdated === undefined || lastUpdated === null ||
        productName === undefined || productName === null || 
        availableItems === undefined || availableItems === null||
        outOfStock === undefined || outOfStock === null) {


        console.log(error)
        let errorMessage = error.message || 'Unknown MySQL error';
        res.status(404).send({
            success:false,
            message:"Error in create addSodEodList API ",
            error: errorMessage
       }, cacheKey,500)
        

    }else{

        try {
            // SQL INSERT statement with ON DUPLICATE KEY UPDATE
            const query = `
                INSERT INTO sodEodItems (productName, itemsTaken, itemsRemaining, lastUpdated, productId, availableItems, outOfStock)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    productName = VALUES(productName),
                    itemsTaken = VALUES(itemsTaken),
                    itemsRemaining = VALUES(itemsRemaining),
                    lastUpdated = VALUES(lastUpdated),
                    availableItems = VALUES(availableItems),
                    outOfStock = VALUES(outOfStock)
            `;  
        // Parameterized query with replacements
        const replacements = [productName, itemsTaken,itemsRemaining, lastUpdated,productId, availableItems, outOfStock];
     
        // Execute the query
        await addCachedAndQuery(cacheKey,  query , replacements);
     
     
         } catch (error) {
             console.log(error)
             let errorMessage = error.message || 'Unknown MySQL error';
             res.status(404).send({
                 success:false,
                 message:"Error in create Student API ",
                 error: errorMessage
            }, cacheKey,500)
             
         }
     

    }

}

const getSodEodItems = async(req, res) =>{
logRequestDetails(req, "getSodEodItems");
    try {



        const query = `SELECT * FROM  ${cacheKey}`;
            // If not in cache, query the database
        //console.log('Cache miss: Querying database');
        const dbDataResult = await getCachedOrQuery(cacheKey,query, query);

        if (!dbDataResult) { 
            return res.status(404).send({
                success: false,
                message: "Resource not found"
           }, cacheKey,500);
        } else if (!dbDataResult.length || dbDataResult.length === 0) {
            return logResponseDetails(req,res,{
                success: true,
                data: [],
                message: "No data available"
           }, cacheKey,200);
        }else{
            
            //const objectsOnly = dbData.filter(item => typeof item === 'object' && !Array.isArray(item));
            // Cache the data in Redis (set it for 1 hour)
//            await setData(cacheKey, objectsOnly, 3600); // Cache for 1 hour
            //await setDataWithNoExpiry(cacheKey, dbDataResult);
         //   await setDataWithExpiry(cacheKey, dbDataResult);
            // Send the filtered data to the client
             return res.status(200).send(dbDataResult);
            
        }


    } catch (error) {
        console.log(error)
        res.status(500).send({
            success:false,
            message:"Error in getting all" + error,
            error
       }, cacheKey,500)
    }


}

const removeSodEodById = async(req, res) =>{

    logRequestDetails(req, "removeSodEodById");
    try {

        const productId = req.params.id;

        if(!productId){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + productId
           }, cacheKey,500)
        }else{


try {
    const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
    const replacements = [productId];

    const result = await removeCachedAndQuery(cacheKey, mysqlQuery, mysqlQuery, replacements);

    if (result && (result.affectedRows > 0 || result.rowCount > 0)) {
        logResponseDetails(req,res,{
            success: true,
            message: `ID [${productId}] deleted successfully`,
       }, cacheKey,200);
    } else {
        res.status(404).send({
            success: false,
            message: `ID [${productId}] not found in [${cacheKey}]`,
       }, cacheKey,500);
    }

} catch (error) {
    console.error(error);
    res.status(500).send({
        success: false,
        message: "Error occurred while trying to delete.",
        error,
   }, cacheKey,500);
}


	 
			
        }
        
    } catch (error) {
        console.log(error)
        res.status(500).send({
            success:false,
            message: "Error in Deleting Student",
            error
       }, cacheKey,500)
    }

}
const deleteSodEodItems = async(req, res) =>{
    logRequestDetails(req, "deleteSodEodItems");
    try {

        const productId = req.params.id;
        console.log(formattedDate() + "ID Pricing to delte: " + productId);

        if(!productId){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + productId
           }, cacheKey,500)
        }else{

try {
    const mysqlQuery = `DELETE FROM ?? WHERE productId = ?`;
    const replacements = [cacheKey, productId];

    const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);

    if (result.affectedRows > 0) {
        logResponseDetails(req,res,{
            success: true,
            message: `ID [${productId}] deleted successfully`,
       }, cacheKey,200);
    } else {
        res.status(404).send({
            success: false,
            message: `ID [${productId}] not found in [${cacheKey}]`,
       }, cacheKey,500);
    }

} catch (error) {
    console.error(error);
    res.status(500).send({
        success: false,
        message: "Error occurred while trying to delete.",
        error,
   }, cacheKey,500);
}
 
        
	 
			
        }
        
    } catch (error) {
        console.log(error)
        res.status(500).send({
            success:false,
            message: "Error in Deleting Student",
            error
       }, cacheKey,500)
    }

}

const updateSodEodItems = async(req, res) => {
logRequestDetails(req, "updateSodEodItems");
    try {
        const { productId, itemsTaken, itemsRemaining , date, productName} = req.body;

        console.log("id =>" +productId);
        console.log("itemsRemaining => " + itemsRemaining);
        console.log("lastUpdated => " + date);
        console.log("productName =>" +productName);
        console.log("itemsTaken => " + itemsTaken);

       

        if(productId === undefined || productId === null ||
            itemsRemaining === undefined || itemsRemaining === null ||
            itemsTaken === undefined || itemsTaken === null ||
            date === undefined || date === null ||
            productName === undefined || productName === null) {
                
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
           }, cacheKey,500)

        }else{
            try {
                // Construct the SQL UPDATE statement with replacements
                const query = `UPDATE sodEodItems SET productName = ?, itemsTaken = ?, itemsRemaining = ?, lastUpdated = ? WHERE productId = ?`;

                const replacements = [
                    productName,
                    itemsTaken,
                    itemsRemaining,
                    date,
                    productId
                ];

                console.log('Updating sodEodItems with replacements:', replacements);

                const result = await updateCachedOrQuery(cacheKey,  query , replacements);
                console.log('✅ sodEodItems updated successfully:', result);
            } catch (error) {
                console.error('❌ Error updating sodEodItems:', error);
            }  
            
            
        // respond with result
        // Check if result is valid and rows were affected
        if (!result || (typeof result.affectedRows === 'number' && result.affectedRows === 0) || (typeof result.rowCount === 'number' && result.rowCount === 0)) {
            return logResponseDetails(req, res, {
            status: 404,
            success: false,
            message: `❌ No rows updated in ${cacheKey}. Invalid productId or no change.`,
            result
           }, cacheKey,500);
        } else {
            return logResponseDetails(req, res, {
            status: 200,
            success: true,
            message: "✅ Available items updated successfully",
            result
           }, cacheKey,200);
        } 
        
        
        }



    } catch (error) {
        console.log(error)
        res.status(404).send({
            success:false,
            message:"Error in create Student API ",
            error
       }, cacheKey,500)
        
    }

}

const addSodEodItems = async(req, res) => {
logRequestDetails(req, "addSodEodItems");

    const { productId, itemsTaken, itemsRemaining , lastUpdated, productName} = req.body;

    console.log("id =>" +productId);
    console.log("itemsRemaining => " + itemsRemaining);
    console.log("lastUpdated => " + lastUpdated);
    console.log("productName =>" +productName);
    console.log("itemsTaken => " + itemsTaken);


    if(productId === undefined || productId === null ||
        itemsRemaining === undefined || itemsRemaining === null ||
        itemsTaken === undefined || itemsTaken === null ||
        lastUpdated === undefined || lastUpdated === null ||
        productName === undefined || productName === null) {


        console.log(error)
        let errorMessage = error.message || 'Unknown MySQL error';
        res.status(404).send({
            success:false,
            message:"Error in create Student API ",
            error: errorMessage
       }, cacheKey,500)
        

    }else{

        try {

        // SQL INSERT statement with ON DUPLICATE KEY UPDATE
        const query = `
        INSERT INTO sodEodItems (productName, itemsTaken, itemsRemaining, lastUpdated, productId)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            productName = VALUES(productName),
            itemsTaken = VALUES(itemsTaken),
            itemsRemaining = VALUES(itemsRemaining),
            lastUpdated = VALUES(lastUpdated)
    `;  
        // Parameterized query with replacements
        const replacements = [productName, itemsTaken,itemsRemaining, lastUpdated,productId];
     
        // Execute the query
        const data = await addCachedAndQuery(cacheKey,  query , replacements);

            
            
            
            if(!data){
                res.status(404).send({
                    success:false,
                    message:"Error: CNNOT INSERT DATA TO CART DUE TO A ERROR",
     
               }, cacheKey,500)
        }else{
                logResponseDetails(req,res,{
                    success:true, 
                    message:"Successfully Added New SodEod",
               }, cacheKey,200)
        }
     
     
         } catch (error) {

            logResponseDetails(req,res,{
                error,
                success:false,
                 message:"Error in create Student API ",
                 error: errorMessage
            },cacheKey,500)
         }
     

    }

}

export default {addSodEodList, getSodEodList, removeSodEodById, addSodEodItems, deleteSodEodItems, getSodEodItems, updateSodEodItems}