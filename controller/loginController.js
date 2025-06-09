const dbSequelize = require("../config/db")
const QueryTypes = require("sequelize")

const getProductList = async(req, res) =>{
    try {
        
        const [data] = await dbSequelize.query('SELECT * FROM productList')
        if(!data){
            return res.status(404).send({
                success:false,
                message:"No REcords Found"
            })
        }else{
            
            const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));

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


}



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

const updateProduct= async(req, res) => {
    const productId  = req.params.id; // Extract student ID from the request URL
    let { productName, productFlavor, productPrice, image_url} = req.body; // Extract updated values from the request body 
    console.log("Body Values para_ID "+ productId + "_name " + productName + " _flavor " +productFlavor + " _price " + productPrice + " _image_url " + image_url); 

    try {



        if(!productId){
            console.log("productId Provided=> " + productId)
            return res.status(404).send({
                success:false,
                message:"Invalid IR Or provide id => "+ productId
            })

        }else{

            if(!productName || !productFlavor || !productPrice || !image_url){
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

        if(!productId){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + productId
            })
        }else{


            try {
				

                const data = await dbSequelize.query('DELETE FROM productList WHERE productId = :productId', {
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

const addProduct = async(req, res) => {

    try {
        const { productId, productName,productFlavor,productPrice, image_url} = req.body;

        console.log("id =>" +productId);
        console.log("name => " + productName);
        console.log("flavor  => " + productFlavor);
        console.log("price => " + productPrice);
        console.log("image_url => " + image_url);
       

        if(!productId || !productName || ! productFlavor || !productPrice ||!image_url){
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
                res.status(201).send({
                    success:true, 
                    message:"New Recored Inserted TO CART Successfully",
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

module.exports = {getProductList, getProductByID, updateProduct, deleteProduct, addProduct, purgingProduct}