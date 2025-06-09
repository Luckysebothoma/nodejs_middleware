const dbSequelize = require("../config/db")
const QueryTypes = require("sequelize")

const cacheKey = 'stockedItems'; // Key to store the list in Redis

const getStockList = async(req, res) =>{
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

const deleteStock = async(req, res) =>{
    try {

        const productId = req.params.id;

        if(!lastUpdated){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + productId
            })
        }else{


            try {
				

                const data = await dbSequelize.query('DELETE FROM stockItems WHERE productId = :productId', {
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

const addStock = async(req, res) => {

    try {
        const { productId, productName,productFlavor,productPrice, lastUpdated, productQuantity} = req.body;

        console.log("id =>" +productId);
        console.log("name => " + productName);
        console.log("flavor  => " + productFlavor);
        console.log("price => " + productPrice);
        console.log("lastUpdated=> " + lastUpdated);
        console.log("productQuantity => " + productQuantity);
       

        if(
            productId ==null || productName ==null || productFlavor ==null || productPrice ==null || lastUpdated ==null || productQuantity ==null
            || productId==undefined || productName==undefined || productFlavor==undefined || productPrice==undefined || lastUpdated==undefined || productQuantity ==undefined

        ){
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO stockItems (productId, productName,productFlavor,productPrice, lastUpdated, productQuantity)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        // Parameterized query with replacements
        const replacements = [productId, productName,productFlavor,productPrice, lastUpdated, productQuantity];

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

const addStockedItems = async(req, res) => {
    const { productId, stockDate,stockId,stockPrice, stockQuantity} = req.body;


    try {

        console.log("id =>" +productId);
        console.log("stockDate => " + stockDate);
        console.log("stockId  => " + stockId);
        console.log("stockPrice => " + stockPrice);
        console.log("stockQuantity => " + stockQuantity);
       

        if(
            productId ==null || stockDate ==null || stockId ==null || stockPrice ==null || stockQuantity ==null
            || productId==undefined || stockDate==undefined || stockId==undefined || stockPrice==undefined || stockQuantity==undefined

        ){
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields",
                response:"There are missing fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO stockedItems (productId, stockDate,stockId,stockPrice, stockQuantity)
            VALUES (?, ?, ?, ?, ?)
        `;

        // Parameterized query with replacements
        const replacements = [productId, stockDate,stockId,stockPrice, stockQuantity];

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
            const [data] = await dbSequelize.query('SELECT * FROM stockedItems')
            const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));
            
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

const removeStockedItems = async(req, res) =>{



    const productId  = req.params.id; // Extract student ID from the request URL

    try {

        const productId = req.params.id;
        console.log("ID Pricing to delte");
        console.log(productId);

        if(!productId){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + productId
            })
        }else{


            try {
				

                const data = await dbSequelize.query('DELETE FROM stockedItems WHERE productId = :productId', {
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


module.exports = {addStock, getStockList, deleteStock, addStockedItems, removeStockedItems}