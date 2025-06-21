  import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';

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
    

    try {

        

        if(!productId){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + productId
            })
        }else{


            try {
				

                const data = await dbSequelize.query('DELETE FROM priceTracing WHERE productId = :productId', {
                    replacements: { productId }, // Pass the parameter explicitly
                    type: dbSequelize.QueryTypes.DELETE
                }); 

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

const removePriceTracing = async(req, res) =>{
    
    try {

        const productId = req.params.id;

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

const getPriceTracing = async(req, res) =>{
 /*   try {
           // If not in cache, query the database
            console.log('Cache miss: Querying database');
        
            const [data] = await dbSequelize.query('SELECT * FROM priceTracing ')


            if (!data) { 
                return res.status(404).send({
                    success: false,
                    message: "Resource not found"
                });
            } else if (data.length === 0) {
                return res.status(200).send({
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
        res.status(500).send({
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

// Adding to Pricing Table
const addPriceTracing  = async(req, res) => {
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
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO priceTracing  (productId, accAmount,date)
            VALUES (?, ?, ?);
        `;

        // Parameterized query with replacements
        const replacements = [productId, accAmount,lastUpdated];

        // Execute the query
        addCachedAndQuery("priceTracing",query, query, replacements)
        
        
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

//deletins

const deletePriceTracing = async (req, res) => {
    const productId = req.params.id;

    console.log(`[deletePriceTracing] Requested deletion for productId: ${productId}`);

    if (!productId || isNaN(productId)) {
        return res.status(400).json({
            success: false,
            message: `Invalid or missing productId: ${productId}`
        });
    }

    try {
        const mysqlQuery = `DELETE FROM ${cacheKey} WHERE productId = ?`;
        const pgQuery = `DELETE FROM ${cacheKey} WHERE productId = $1`;
        const replacements = [productId];

        await removeCachedAndQuery(cacheKey, mysqlQuery, pgQuery, replacements);

        return res.status(200).json({
            success: true,
            message: `Product ID [${productId}] deleted successfully.`
        });
    } catch (error) {
        console.error(`[deletePriceTracing] Error deleting productId ${productId}:`, error);
        return res.status(500).json({
            success: false,
            message: "An error occurred while attempting to delete the price tracing record.",
            error: error.message || error
        });
    }
};

// UPdating 

const updatePriceTracing = async(req, res) => {
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

            return res.status(404).send({
                success:false,
                message:"Invalid IR Or provide id => "+ productId
            })

        }else{

            try {
    
                // Construct the SQL UPDATE statement with replacements
                const sql = `
                UPDATE priceTracing 
                SET 
                accAmount = :accAmount, 
                date = :lastUpdated
                WHERE 
                    productId = :productId `;
            
                // Execute the UPDATE statement with replacements , ,,
                const data = await dbSequelize.query(sql, {
                  replacements: {
                    
                    accAmount,
                    lastUpdated, 
                    productId
                  },
                  type: UPDATE
                });
    
                if(!data){
                        res.status(500).send({
                        success:false,
                        message:"Error in Updateing"
                        
                        })

                        console.log()
    
                }else{
                    const [data] = await dbSequelize.query('SELECT * FROM priceTracing')
                    const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));

                    
                    res.status(200).send({
                        success:true,
                        message:"Successfully UPdated"
                    })
                }
            } catch (error) {
                console.log(error);
                res.status(500).send({
                    success:false,
                    message:"Something wrong happened while updating the record \n _name" + _name + " _flavor" +_flavor + " _price" + _price + " _image_url" + _image_url, 
                    error
                })
                console.log("Something wrong happened while updating the record \n _name" + _name + " _flavor" +_flavor + " _price" + _price + " _image_url" + _image_url, 
            )
            }
        }
        
    } catch (error) {
        
                    
        res.status(500).send({
            success:false,
            message:"Error in Update Student API", 
            error
        })
    }
}



export default {removePriceTracing, removeEstimateById, getPriceTracing ,addPriceTracing , deletePriceTracing , updatePriceTracing }