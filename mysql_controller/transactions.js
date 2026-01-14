const dbSequelize = require("../config/db")
const QueryTypes = require("sequelize")

const getAvailableItems = async(req, res) =>{
    try {
        
        const [data] = await dbSequelize.query('SELECT * FROM availableItems')
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
				

                const data = await dbSequelize.query('DELETE FROM availableItesms WHERE lastUpdated = :lastUpdated', {
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

module.exports = {addAvailableItems, deleteAvailableItems, getAvailableItems, updateAvailableItems}