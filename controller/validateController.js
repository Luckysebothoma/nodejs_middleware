const dbSequelize = require("../config/db")
const QueryTypes = require("sequelize")

const loginValidate = async(req, res) => {

    try {
        const { username, password } = req.body;

        console.log("id =>" +username);
        console.log("name => " + password);

       

        if(!username || !password ){
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
        SELECT * FROM users WHERE username = ? AND password = ?
        `;

        // Parameterized query with replacements
        const replacements = [username, password];

        // Execute the query
        const data = await dbSequelize.query(query, {
            replacements,
            type: dbSequelize.QueryTypes.SELECT
        });            
            
            if(!data){
                res.status(404).send({
                    success:false,
                    message:"Error: CNNOT INSERT DATA TO CART DUE TO A ERROR",

                })
        }else if(data.length ===0){
            res.status(404).send({
                success:false,
                message:"Invalid username or password"
            })


        }
        else{
                res.status(201).send({
                    success:true, 
                    message:"NLogin successful",
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

module.exports = { loginValidate}