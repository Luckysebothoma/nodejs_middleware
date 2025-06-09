const mysqlPool = require("../config/db")
const pgPool = require("../config/postgres")
const redis = require("../config/redisClient")
const QueryTypes = require("sequelize")
const cacheKey = 'availableItems'; // Key to store the list in Redis
let keyExist = false;
const { getCachedOrQuery,
  addCachedAndQuery,
updateCachedOrQuery, 
removeCachedAndQuery,
} = require  ("../utils/ControllerHandler")
const { key } = require("../external-redis-api/config")

const removeAvailableItemsById = async(req, res) =>{
 /*   
    try {

        const productId = req.params.id;

        if(!productId){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + productId
            })
        }else{


            try {
				

                const data = await dbSequelize.query('DELETE FROM availableItems WHERE productId = :productId', {
                    replacements: { productId }, // Pass the parameter explicitly
                    type: dbSequelize.QueryTypes.DELETE
                }); 

                res.status(200).send({
                    success:true,
                    message:"ID [" + lastUpdated +"] DELETED Successfully"
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
*/






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
    
    try {

        const lastUpdated = req.params.id;

        if(!lastUpdated){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + lastUpdated
            })
        }else{


            try {
				
                const data = await dbSequelize.query('DELETE FROM availableItems WHERE lastUpdated = :lastUpdated', {
                    replacements: { lastUpdated }, // Pass the parameter explicitly
                    type: dbSequelize.QueryTypes.DELETE
                }); 

                res.status(200).send({
                    success:true,
                    message:"ID [" + lastUpdated +"] DELETED Successfully"
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

        // Execute the query
        const data = await dbSequelize.query(query, {
            replacements
        });            
            
            
            
            if(!data){
                res.status(404).send({
                    success:false,
                    message:"Error: CNNOT INSERT DATA TO CART DUE TO A ERROR",

                })
        }else{
    
                    try {
                        const [data] = await dbSequelize.query('SELECT * FROM availableItems')
                        const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));

                        
                        res.status(201).send({
                        success:true, 
                        message:"New Recored Updated Available Items was Successfully and 'cacheKey deleted successfully!'" + cacheKey,
                        })

                    } catch (error) {
                        // We Failed to Update Table, Now Remove it, It will be updated on GetData
                        removeData(cacheKey);
                        console.log("Error on UpdateAvailItems \n " + error)
                    }

// 
        }
        
        
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

        // Execute the query
        const data = await dbSequelize.query(query, {
            replacements,
            type: dbSequelize.QueryTypes.INSERT
        });            
            
            
            
            if(!data){
                res.status(404).send({
                    success:false,
                    message:"Error: CNNOT INSERT DATA TO CART DUE TO A ERROR",

                })
        }else{

            const [data] = await dbSequelize.query('SELECT * FROM availableItems')
            const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));

            res.status(201).send({
                success:true, 
                message:"New Recored Inserted TO Available Items was Successfully and 'cacheKey deleted successfully!' "+ cacheKey,
            })

                
        }
        
        
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