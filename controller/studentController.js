


// get all student list

const dbSequelize = require("../config/db")
const QueryTypes = require("sequelize")
let studentId ='';

const getStudents = async(req, res) =>{
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


// Get Student ut id

const getStudentByID = async(req,res) => {

    try {
        studentId = req.params.id;

        if(!studentId){
                return res.status(404).send({
                    success:false,
                    message:"INvalid or Provide Student ID"
                })
        }else{
                //const data = await dbSequelize.query('SELECT * FRO students WHERE id='+studentId);
                const data = await dbSequelize.query('SELECT * FROM products WHERE id = :studentId', {
                    replacements: { studentId }, // Pass the parameter explicitly
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
            message: "Error in Get Students by ID API, Passed ID=0"+ studentId,
            error
        })
    }

}


/*

    Adding Items into Product List Products
*/
//   Create Student
const createStudent = async(req, res) => {

    try {
        const { id, name,flavor,price , image_url } = req.body;
        console.log("id =>" +id);
        console.log("name => " + name);
        console.log("flavor  => " + flavor);
        console.log("studentClass => " + price);
        console.log("fees => " + image_url);
       

        if(!id || !name || ! flavor || !price || !image_url){
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO productList (id, name,flavor,price , image_url)
            VALUES (?, ?, ?, ?, ?)
        `;

        // Parameterized query with replacements
        const replacements = [id, name,flavor,price , image_url];

        // Execute the query
        const data = await dbSequelize.query(query, {
            replacements,
            type: dbSequelize.QueryTypes.INSERT
        });            
            
            
            
            if(!data){
                res.status(404).send({
                    success:false,
                    message:"Error: CNNOT INSERT DATA DUE TO A ERROR",

                })
        }else{
                res.status(201).send({
                    success:true, 
                    message:"New Recored Inserted Successfully",
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

/* 

Creating an API FOr adding Items into CArtLIst


_*/

const add2Cart = async(req, res) => {

    try {
        const { id, name,flavor,price} = req.body;

        console.log("id =>" +id);
        console.log("name => " + name);
        console.log("flavor  => " + flavor);
        console.log("studentClass => " + price);
       

        if(!id || !name || ! flavor || !price ){
            return res.status(500).send({
                success:false,
                message:"PLease Provide all fields"
            })

        }else{

        // SQL INSERT statement
        const query = `
            INSERT INTO cartList (id, name,flavor,price)
            VALUES (?, ?, ?, ?)
        `;

        // Parameterized query with replacements
        const replacements = [id, name,flavor,price];

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

// UPdate Student 
const updateStudent = async(req, res) => {
    try {

        const studentId  = req.params.id; // Extract student ID from the request URL


        if(!studentId){
            console.log("studentId Provided=> " + studentId)
            return res.status(404).send({
                success:false,
                message:"Invalid IR Or provide id => "+ studentId
            })

        }else{
            const { name, roll_no, studentClass, fees, medium } = req.body; // Extract updated values from the request body
    
            // Construct the SQL UPDATE statement with replacements
            const sql = `
              UPDATE products
              SET name = :name, roll_no = :roll_no, studentClass = :studentClass, fees = :fees, medium = :medium
              WHERE id = :studentId
            `;
        
            // Execute the UPDATE statement with replacements
            const data = await dbSequelize.query(sql, {
              replacements: {
                name,
                roll_no,
                studentClass,
                fees,
                medium,
                studentId
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
        }
        
    } catch (error) {
        
        console.log(error);
        res.status(500).send({
            success:false,
            message:"Error in Update Student API", 
            error
        })
    }
}



// Delete Student 

const deleteStudent = async(req, res) =>{
    try {

        const studentId = req.params.id;

        if(!studentId){
            return res.status(404).send({
                success:false,
                message:"PLease provide student Id => " + studentId
            })
        }else{


            try {


                const data = await dbSequelize.query('DELETE FROM products WHERE id = :studentId', {
                    replacements: { studentId }, // Pass the parameter explicitly
                    type: dbSequelize.QueryTypes.DELETE
                }); 

                res.status(200).send({
                    success:true,
                    message:"ID [" + studentId +"] DELETED Successfully"
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

module.exports = {getStudents,getStudentByID, createStudent, updateStudent, deleteStudent}
