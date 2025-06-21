 
import ControllerHandler from "../utils/ControllerHandler.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

const {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery
} = ControllerHandler;
const cacheKey = 'productItemPricing'; // Key to store the list in Redis


const getProductItemPricingList = async(req, res) =>{
    try {

        // If not in cache, query the database
        console.log('Cache miss: Querying database');
        const [data] = await dbSequelize.query('SELECT * FROM productItemPricing')
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
            try {
                
                           // Cache the data in Redis (set it for 1 hour)

           // Send the filtered data to the client
           res.json(objectsOnly);

            } catch (error) {
                console.error(error);
            }
        } 


    } catch (error) {
        console.log(error)
        res.status(500).send({
            success:false,
            message:"Error in getting all",
            error
        })
    }


}

// Adding to Pricing Table
const addProductItemPricing = async(req, res) => {

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
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO productItemPricing (productId, productDescription,itemGroup,itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        // Parameterized query with replacements
        const replacements = [productId, productDescription,itemGroup,itemsRemainder, costOfRemainder, groupedQuantity, groupedProfit, groupedCommission];

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

const deleteProductItemPricing = async(req, res) =>{

    const productId  = req.params.id; // Extract student ID from the request URL
    console.log("removeEstimateById Request Params: ", req.params);
    console.log("removeEstimateById Product ID: ", productId);

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
                const pgQuery = `DELETE FROM ${cacheKey} WHERE productId= $1`;
                const replacements = [productId];

                await removeCachedAndQuery(cacheKey,mysqlQuery, pgQuery, replacements);


                res.status(200).send({
                    success: true,
                    message: "Successfully deleted " + replacements + " from " + cacheKey
                });

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

const updateProductItemPricing= async(req, res) => {


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
            })

            
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
    
                    // Construct the SQL UPDATE statement with replacements
                    const sql = `
                    UPDATE productItemPricing
                    SET 
                    productDescription = :productDescription, 
                    itemGroup = :itemGroup, 
                    itemsRemainder = :itemsRemainder, 
                    costOfRemainder = :costOfRemainder,
                    groupedQuantity = :groupedQuantity,
                    groupedProfit = :groupedProfit,
                    groupedCommission = :groupedCommission
                    WHERE 
                        productId = :productId `;
                
                    // Execute the UPDATE statement with replacements , ,,
                    const data = await dbSequelize.query(sql, {
                      replacements: {
                        productId,
                        productDescription,
                        itemGroup,
                        itemsRemainder,
                        costOfRemainder,
                        groupedQuantity,
                        groupedProfit,
                        groupedCommission
                      },
                      type: UPDATE
                    });
        

                } catch (error) {
                    console.log(error);
                    res.status(500).send({
                        success:false,
                        message:"Something wrong happened while updating the record \n _name" + _name + " _flavor" +_flavor + " _price" + _price + " _image_url" + _image_url, 
                        error
                    })
                }

            
       
     

            return res.status(200).send({
                success:true,
                message:"Successfully UPdated"
            })
            
        }







        
    }
        

export default {getProductItemPricingList, addProductItemPricing, deleteProductItemPricing, updateProductItemPricing }