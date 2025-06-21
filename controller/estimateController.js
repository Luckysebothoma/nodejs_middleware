
import TimeUtils from '../utils/Time.js';

import ControllerHandler from "../utils/ControllerHandler.js";
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
 
const cacheKey = 'estimates'; // Key to store the list in Redis


const removeEstimateById = async(req, res) =>{
    
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


const getEstimates = async(req, res) =>{
/*    try {


            const [data] = await dbSequelize.query('SELECT * FROM estimates')
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
const addEstimates = async(req, res) => {
    try {

        /*
                productId: number;
    estimatedSelling:number;
    actualSelling:number;
    lastUpdated:Date;
        */


        const { productId, estimatedSelling,actualSelling,lastUpdated} = req.body;

        console.log("id =>" +productId);
        console.log("estimatedSelling => " + estimatedSelling);
        console.log("actualSelling  => " + actualSelling);
        console.log("lastUpdated => " + lastUpdated);
       

        if(productId === undefined || productId === null ||
            estimatedSelling === undefined || estimatedSelling === null ||
            actualSelling === undefined || actualSelling === null ||
            lastUpdated === undefined || lastUpdated === null) {

            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO estimates (productId, estimatedSelling,actualSelling,lastUpdated)
            VALUES (?, ?, ?, ?)
        `;

        // Parameterized query with replacements
        const replacements = [productId, estimatedSelling,actualSelling,lastUpdated];

        // Execute the query
        addCachedAndQuery("estimates",query,query,replacements);
        
        
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
const deleteEstimates = async(req, res) =>{

    const productId  = req.params.id; // Extract student ID from the request URL
        console.log(formattedDate() + "ID Pricing to delte: " + productId);

    try {

        console.log("ID Pricing to delte");
        console.log(productId);

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

// UPdating 
const updateEstimates= async(req, res) => {
    const { productId, estimatedSelling,actualSelling,lastUpdated} = req.body;

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

            return res.status(404).send({
                success:false,
                message:"Invalid IR Or provide id => "+ productId
            })

        }else{

            try {
    
                // Construct the SQL UPDATE statement with replacements
                const sql = `
                UPDATE estimates
                SET 
                estimatedSelling = :estimatedSelling, 
                actualSelling = :actualSelling, 
                lastUpdated = :lastUpdated
                WHERE 
                    productId = :productId `;
            
                // Execute the UPDATE statement with replacements , ,,
                const data = await dbSequelize.query(sql, {
                  replacements: {
                    
                    estimatedSelling,
                    actualSelling,
                    lastUpdated, 
                    productId
                  },
                  type: UPDATE
                });
    
                if(!data){
                        res.status(500).send({
                        success:false,
                        message:"Error in Updateing", 
                        error: "Error in Updateing "
                        })
    
                }else{
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

export default {removeEstimateById, getEstimates,addEstimates, deleteEstimates, updateEstimates}