const dbSequelize = require("../config/db")
const QueryTypes = require("sequelize");
const {  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery} = require("../utils/ControllerHandler");
const { formattedDate } = require("../utils/Time");

const cacheKey = 'sodEodItems'; // Key to store the list in Redis


const getSodEodList = async(req, res) =>{
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

const addSodEodList = async(req, res) => {


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
        })
        

    }else{

        try {
            // SQL INSERT statement
            const query = `
            INSERT INTO sodEodItems (productName, itemsTaken,itemsRemaining, lastUpdated,productId, availableItems, outOfStock)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
     
        // Parameterized query with replacements
        const replacements = [productName, itemsTaken,itemsRemaining, lastUpdated,productId, availableItems, outOfStock];
     
        // Execute the query
        await addCachedAndQuery(cacheKey, query, query, replacements);
     
     
         } catch (error) {
             console.log(error)
             let errorMessage = error.message || 'Unknown MySQL error';
             res.status(404).send({
                 success:false,
                 message:"Error in create Student API ",
                 error: errorMessage
             })
             
         }
     

    }

}

const getSodEodItems = async(req, res) =>{
    try {

            // If not in cache, query the database
        console.log('Cache miss: Querying database');
        const [data] = await dbSequelize.query('SELECT * FROM  sodEodItems')
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
//            await setData(cacheKey, objectsOnly, 3600); // Cache for 1 hour

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

const removeSodEodById = async(req, res) =>{
    
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
const deleteSodEodItems = async(req, res) =>{
    
    try {

        const productId = req.params.id;
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

const updateSodEodItems = async(req, res) => {

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
            })

        }else{

                            // Construct the SQL UPDATE statement with replacements
                            const sql = `
                            UPDATE sodEodItems
                            SET 
                            productName = :productName, 
                            itemsTaken = :itemsTaken, 
                            itemsRemaining = :itemsRemaining, 
                            lastUpdated = :date
                            WHERE 
                                productId = :productId `;
                        
                            // Execute the UPDATE statement with replacements , ,,
                            const data = await dbSequelize.query(sql, {
                              replacements: {
                                
                                productName,
                                itemsTaken,
                                itemsRemaining,
                                date, 
                                productId
                              },
                              type: QueryTypes.UPDATE
                            });
            
            
            
            if(!data){
                res.status(404).send({
                    success:false,
                    message:"Error: CNNOT INSERT DATA TO CART DUE TO A ERROR",

                })
        }else{
            const [data] = await dbSequelize.query('SELECT * FROM sodEodItems')
            const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));
  //          await setData(cacheKey, objectsOnly, 3600); // Cache for 1 hour
            
                res.status(201).send({
                    success:true, 
                    message:"Successfully Updated SoEod",
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

const addSodEodItems = async(req, res) => {


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
        })
        

    }else{

        try {

        
            // SQL INSERT statement
            const query = `
            INSERT INTO sodEodItems (productName, itemsTaken,itemsRemaining, lastUpdated,productId )
            VALUES (?, ?, ?, ?, ?)
        `;
     
        // Parameterized query with replacements
        const replacements = [productName, itemsTaken,itemsRemaining, lastUpdated,productId];
     
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
            const [data] = await dbSequelize.query('SELECT * FROM sodEodItems')
            const objectsOnly = data.filter(item => typeof item === 'object' && !Array.isArray(item));
            //await setData(cacheKey, objectsOnly, 3600); // Cache for 1 hour
            
            
                res.status(201).send({
                    success:true, 
                    message:"Successfully Added New SodEod",
                })
        }
     
     
         } catch (error) {
             console.log(error)
             let errorMessage = error.message || 'Unknown MySQL error';
             res.status(404).send({
                 success:false,
                 message:"Error in create Student API ",
                 error: errorMessage
             })
             
         }
     

    }

}

module.exports = {addSodEodList, getSodEodList, removeSodEodById, addSodEodItems, deleteSodEodItems, getSodEodItems, updateSodEodItems}