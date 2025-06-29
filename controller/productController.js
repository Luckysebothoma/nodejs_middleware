
import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

import redisConfig, { setDataWithExpiry, updateDataWithNoExpiry } from '../config_redis/redis_config.js';
const { removeData, setData, getData, keyExists,  setDataWithNoExpiry} = redisConfig;
import { getConnection } from '../config/db.js';

 
const { 
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
const cacheKey = 'productList';

const getProductList = async (req, res) => {
/*    try {

                // If not in cache, query the database
        const [data] = await dbSequelize.query('SELECT * FROM productList');
        
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
        }else {
            const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));

            
            // Return the filtered data
            res.json(objectsOnly);
        }

    } catch (error) {
        console.error(error);
        res.status(500).send({
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

// Function to get product by ID (not an HTTP handler)
const _getProductByID = async (productId) => {
    try {
        if (!productId) {
            return {
                success: false,
                message: "Invalid or missing product ID"
            };
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
        return {
            success: false,
            message: "Error in getProductByID function, Passed ID=" + productId,
            error
        };
    }
};

const getProductByID = async(req,res) => {

    try {
        productId = req.params.id;

        if(!productId){
                return res.status(404).send({
                    success:false,
                    message:"INvalid or Provide Student ID"
                })
        }else{
                //const data = await dbSequelize.query('SELECT * FRO students WHERE id='+productId);
                const data = await dbSequelize.query('SELECT * FROM productList WHERE id = :productId', {
                    replacements: { productId }, // Pass the parameter explicitly
                    type: dbSequelize.QueryTypes.SELECT
                }); 
                
                if(!data){
                    return res.status(404).send({
                        success:false,
                        message:"NO Recotdas found"
                    })

                }else{
                    res.status(200).send({
                        success:true, 
                        studentDetails:data
                    })
                }
        }

    } catch (error) {
        console.log(error)
        res.status(500).send({
            success:false,
            message: "Error in Get Students by ID API, Passed ID=0"+ productId,
            error
        })
    }

}

const updateProduct = async(req, res) => {
    //const productId  = req.params.id; // Extract student ID from the request URL
   
    let { productId, productName, productFlavor, productPrice, image_url} = req.body; // Extract updated values from the request body 
    
    //console.log("ProductList Obj ****** "+ productId + "_name " + productName + " _flavor " +productFlavor + " _price " + productPrice + " _image_url " + image_url); 

    if( productName ==null || productFlavor ==null || productPrice ==null || image_url==null
        || productName==undefined || productFlavor==undefined || productPrice==undefined || image_url == undefined
    
        ){

            
            return res.status(404).send({
                success:false,
                message:"ERROR ERROR ProductList Obj ****** "+ productId + "_name " + productName + " _flavor " +productFlavor + " _price " + productPrice + " _image_url " + image_url
            })


        }else{
            try {
    
                // Construct the SQL UPDATE statement with replacements
                const query = `
                UPDATE productList 
                SET 
                    productName = :productName, 
                    productFlavor = :productFlavor, 
                    productPrice = :productPrice, 
                    image_url = :image_url 
                WHERE 
                    productId = :productId `;
            
                // Execute the UPDATE statement with replacements , ,,
                const replacements= [
                    productId,
                    productName,
                    productFlavor,
                    productPrice,
                    image_url
                ];
                console.log('updating producrt List with replacements: ', replacements);
                const data = await updateCachedOrQuery(cacheKey, query, query, replacements);


            }catch(error ){

                console.log(error);
                res.status(500).send({
                    success:false,
                    message:"Something wrong happened while updating the record \n _name" + _name + " _flavor" +_flavor + " _price" + _price + " _image_url" + _image_url, 
                    error
                })

            }
            console.log("Success  ****** "+ productId + "_name " + productName + " _flavor " +productFlavor + " _price " + productPrice + " _image_url " + image_url); 
            
            const [data] = await dbSequelize.query('SELECT * FROM productList')
            const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));

            return res.status(200).send({
                success:true,
                message:"Successfully UPdated ProductList Obj ****** "+ productId + "_name " + productName + " _flavor " +productFlavor + " _price " + productPrice + " _image_url " + image_url
            })
           
        }




    /*
    try {



        if(!productId){
            console.log("productId Provided=> " + productId)
            return res.status(404).send({
                success:false,
                message:"Invalid IR Or provide id => "+ productId
            })

        }else{

            if( productName ==null || productFlavor ==null || productPrice ==null || image_url==null
                || productName==undefined || productFlavor==undefined || productPrice==undefined || image_url == undefined
            
                ){
                console.log("Values provided are not valid");
                let { prproductName, productFlavor, productPrice, image_url} = req.body; // Extract updated values from the request body 
                console.log("Values After re-entering the body para_ID "+ productId + "_name " + productName + " _flavor " +productFlavor + " _price " + productPrice + " _image_url " + image_url); 
        
            }else{
                try {
    
                    // Construct the SQL UPDATE statement with replacements
                    const sql = `
                    UPDATE productList 
                    SET 
                        productName = :productName, 
                        productFlavor = :productFlavor, 
                        productPrice = :productPrice, 
                        image_url = :image_url 
                    WHERE 
                        productId = :productId `;
                
                    // Execute the UPDATE statement with replacements , ,,
                    const data = await dbSequelize.query(sql, {
                      replacements: {
                        productId,
                        productName,
                        productFlavor,
                        productPrice,
                        image_url
                      },
                      type: QueryTypes.UPDATE
                    });
        
                    if(!data){
                            res.status(500).send({
                            success:false,
                            message:"Error in Updateing"
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
        }
        
    } catch (error) {
        
        console.log("Body Values para_ID "+ productId + "_name " + productName + " _flavor " +productFlavor + " _price " + productPrice + " _image_url " + image_url); 
                    
        res.status(500).send({
            success:false,
            message:"Error in Update Student API", 
            error
        })
    }

    */
}

const purgingProduct = async (req, res) => {
	        const productId = req.params.id;

	console.log("purgeProduct");
		console.log("ID: " + productId);

    try {

	
        if (!productId) {
            return res.status(404).send({
                success: false,
                message: "Please provide a product ID"
            });
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
            return res.status(404).send({
                success: false,
                message: "No product found with the provided ID"
            });
        }

        return res.status(200).send({
            success: true,
            message: "Product with ID " + productId + " deleted successfully from both tables"
        });
    } catch (error) {
        console.log(error);
        return res.status(500).send({
            success: false,
            message: "Error in deleting product",
            error: error.message // Send error message only
        });
    }
};

const deleteProduct = async(req, res) =>{
    try {

        const productId = req.params.id;

        console.log("Product Id: "+  productId);
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

const addProduct = async(req, res) => {


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
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO productList (productId, productName,productFlavor,productPrice, image_url)
            VALUES (?, ?, ?, ?, ?)
        `;

        // Parameterized query with replacements
        const replacements = [productId, productName,productFlavor,productPrice, image_url];

        // Execute the query
        addCachedAndQuery(cacheKey, query, query, replacements);
        
        
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

export default {getProductList, getProductByID, updateProduct, deleteProduct, addProduct, purgingProduct, _getProductByID}
