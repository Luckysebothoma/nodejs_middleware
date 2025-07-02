
const cacheKey = "cartList";
import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
import { logRequestDetails, logResponseDetails } from '../utils/requestLogger.js';


const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
const getCartList = async(req, res) =>{
    logRequestDetails(req, "getCartList");
/*
    try {
        // If not in cache, query the database
        console.log('Cache miss: Querying database');
        const [data] = await dbSequelize.query('SELECT * FROM cartList')
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
    res.status(200).send(data);
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

const add2Cart = async(req, res) => {
    logRequestDetails(req, "add2Cart");

    try {
        const { productId, productName,productFlavor,productPrice} = req.body;

        console.log("id =>" +productId);
        console.log("name => " + productName);
        console.log("flavor  => " + productFlavor);
        console.log("price => " + productPrice);
       

        if(productId === null||  productName=== null || productFlavor=== null || productPrice=== null 
            || productId===undefined ||  productName===undefined || productFlavor===undefined || productPrice ===undefined
            ){
            return logResponseDetails(req, res, {
      status: 500,
     
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO cartList (productId, productName,productFlavor,productPrice)
            VALUES (?, ?, ?, ?)
        `;

        // Parameterized query with replacements
        const replacements = [productId, productName,productFlavor,productPrice];

        // Execute the query
        results = await addCachedAndQuery(cacheKey,query, query, replacements);

        return logResponseDetails(req, res, {
      status: 200,
     

            success: true,
            message: `cartList added`
        })
        
        }



    } catch (error) {
        //console.log(error)
        return logResponseDetails(req, res, {
      status: 404,
     
            success:false,
            message:"Error in create Student API ",
            error
        })
        
    }

}

const deleteCart= async(req, res) =>{
    logRequestDetails(req, "deleteCart");
    try {

        const productId = req.params.id;
        console.log(formattedDate() + "ID Pricing to delte: " + productId);

        if(!productId){
            return logResponseDetails(req, res, {
      status: 404,
     
                success:false,
                message:"PLease provide student Id => " + productId
            })
        }else{


            try {


                const query= 'DELETE FROM cartList WHERE productId = :productId';
                const replacements = { productId };

                const data = await removeCachedAndQuery(cacheKey, query, query)

                return logResponseDetails(req, res, {
      status: 200,
     
                    success:true,
                    message:"ID [" + productId +"] DELETED Successfully"
                })

            } catch (error) {
                console.log(error)
                return logResponseDetails(req, res, {
      status: 500,
     
                    success:false,
                    message:"Something happening while trying to delete",
                    error
                })
                
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

export default {add2Cart, getCartList, deleteCart}