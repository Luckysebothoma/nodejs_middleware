const mysqlPool = require("../config/db")
const pgPool = require("../config/postgres")
const redis = require("../config/redisClient")
const QueryTypes = require("sequelize")
const cacheKey = 'availableItems'; // Key to store the list in Redis
let keyExist = false;
const {  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery} = require("../utils/ControllerHandler");
const { formattedDate } = require("../utils/Time");

const { key } = require("../external-redis-api/config")

const removeAvailableItemsById = async(req, res) =>{


            const productId = req.params.id;
    console.log("Attempting to remove available id[" + productId + "]")
    try {

        if(!productId){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + productId
            })
        }else{


            try {
				

                

                const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
                const pgQuery = `DELETE FROM ${cacheKey} WHERE productId= $1`;
                const replacements = [productId];

                await removeCachedAndQuery(cacheKey,mysqlQuery, pgQuery, replacements);


                res.status(200).send({
                    success:true,
                    message:"ID [" + productId +"] DELETED Successfully"
                })



            } catch (error) {
                console.log(error)
                res.status(500).send({
                    success:false,
                    message:"Something happening while trying to delete",
                    error
                })
                
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

const getAvailableItems = async (req, res) => {
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
    });
  }
};

const deleteAvailableItems = async(req, res) =>{
            const productId = req.params.id;
        console.log(formattedDate() + "ID Pricing to delte: " + productId);

    try {


        if(!productId){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + lastUpdated
            })
        }else{


            try {
				
const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
                const pgQuery = `DELETE FROM ${cacheKey} WHERE productId= $1`;
                const replacements = [productId];

                await removeCachedAndQuery(cacheKey,mysqlQuery, pgQuery, replacements);


                res.status(200).send({
                    success:true,
                    message:"ID [" + productId +"] DELETED Successfully"
                })



            } catch (error) {
                console.log(error)
                res.status(500).send({
                    success:false,
                    message:"Something happening while trying to delete",
                    error
                })
                
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

const updateAvailableItems = async(req, res) => {

    try {
        const { productId,  itemsRemaining , lastUpdated} = req.body;

        console.log("id =>" +productId);
        console.log("itemsRemaining => " + itemsRemaining);
        console.log("lastUpdated => " + lastUpdated);
       

        if(productId == null || productId == undefined || itemsRemaining==null 
            ||  itemsRemaining === undefined  || lastUpdated === null || lastUpdated === undefined ){
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            UPDATE availableItems SET itemsRemaining =? ,lastUpdated=? WHERE productId =?
        `;

        // Parameterized query with replacements
        const replacements = [itemsRemaining, lastUpdated, productId];

           // Call reusable function
        const result = await updateCachedOrQuery(key, mysqlUpdateQuery, pgUpdateQuery, replacements);
        
        // respond with result
        return res.status(200).send({
        success: true,
        message: "✅ Available items updated successfully",
        result
        });
        
    }



    } catch (error) {
        console.log(error)
        return res.status(500).send({
        success: false,
        message: "❌ Error while updating available items",
        error: error.message
        });
            
    }

}

const addAvailableItems = async(req, res) => {

    try {
        const { productId,  itemsRemaining , lastUpdated} = req.body;

        console.log("id =>" +productId);
        console.log("itemsRemaining => " + itemsRemaining);
        console.log("lastUpdated => " + lastUpdated);
       

        if(productId == null || productId == undefined || itemsRemaining==null 
            ||  itemsRemaining === undefined  || lastUpdated === null || lastUpdated === undefined ){
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO availableItems (productId, itemsRemaining,lastUpdated)
            VALUES (?, ?, ?)
        `;

        // Parameterized query with replacements
        const replacements = [productId, itemsRemaining, lastUpdated];

        addCachedAndQuery("availableItems", query, query, replacements);
        
        
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

module.exports = {removeAvailableItemsById, addAvailableItems, deleteAvailableItems, getAvailableItems, updateAvailableItems}