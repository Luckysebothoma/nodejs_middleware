const redisClient = require('../config/redisClient');
//const { mysqlPool } = require('../config/db');
const { pgClient } = require('../config/postgres');
const mysql = require("mysql2/promise"); 
const keys = require("../keys")
const getShortTime = require("./Time")
const TTL_SECONDS = 30000 * 10; // 5 minutes x 10
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const mysqlPool = mysql.createPool({ 
  host: keys.myHost.trim(),
  user: keys.myUser.trim(),
  password: keys.myPassword.trim(),
  database: keys.myDatabase.trim(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});


const cacheKey = "productList"
/** Get from cache or fallback to DB query */

const getCachedOrQuery = async (key, mysqlQuery, pgQuery) => {

  try {

    const cached = await redisClient.get(key);
    if (cached) {
      console.log( `[CACHE HIT] ${key}`);
    console.log( `${key} : Done Reading on Redis:` + cached );

      //return JSON.parse(cached);
      return JSON.parse(cached);
    }

    console.log(`[CACHE MISS] ${key}. Querying MySQL...`);
    try {

      if (!mysqlPool){
         console.error( "mysqlPool is not defined or imported properly");
      return;
        }else{
          // create new instance
          
        }

      

      const [mysqlResult] = await mysqlPool.query(mysqlQuery);


      if (mysqlResult?.length) {
      console.log(`${key} : Done Reading on mysql:` + mysqlResult );

        await redisClient.set(key, JSON.stringify(mysqlResult), 'EX', TTL_SECONDS);
        return mysqlResult;
      }
      throw new Error('MySQL empty result');
    } catch (mysqlErr) {
      console.warn(`[MySQL Error]: ${mysqlErr.message}, Falling back to PostgreSQL`);

      const pgResult = await pgClient.query(pgQuery, { type: pgClient.QueryTypes.SELECT });
      if (pgResult?.length) {
        await redisClient.set(key, JSON.stringify(pgResult), "EX", TTL_SECONDS);
        return pgResult;
      }
      throw new Error('Postgres also empty');
    }
  } catch (err) {
    console.error( `getCachedOrQuery error:`, err.message);
    throw err;
  }
};

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Database table creation (run once)
async function createTable() {
  try {
    const pool = mysql.createConnection()
    const connection = await pool.getConnection();
    
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        mimetype VARCHAR(100) NOT NULL,
        size INT NOT NULL,
        buffer LONGBLOB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await connection.execute(createTableQuery);
    console.log('Images table created/verified');
    connection.release();
  } catch (error) {
    console.error('Error creating table:', error);
  }
}

/** Add to DB, cache result */
const addCachedAndQuery = async (key, mysqlInsertQuery, pgInsertQuery, values) => {
  try {
    let pgResult;
    let mysqlResult;

    const mysqlConnection = await mysqlPool.getConnection(); // `mysql2` style
    console.log("Mysql connected:" +  mysqlConnection)
    // For Sequelize, use transaction object; for node-postgres, use client.connect()
    // Assuming pgClient is Sequelize instance:
//    const pgTransaction = await pgClient.transaction();
//    console.log("PG connected:" +  pgTransaction)

    // Begin transactions on both databases
    await mysqlConnection.beginTransaction();
    // No need to run 'BEGIN' manually; Sequelize transaction handles it

    try {
      console.log("Now Adding New Key: " + key)

      

      // Execute both inserts
      await mysqlConnection.query(mysqlInsertQuery, values);
      console.log("✅ mySql insert success [" + key + "]");
      // await pgClient.query(pgInsertQuery, { transaction: pgTransaction, replacements: values });
      // console.log("✅ PostgreSQL insert success [" + key + "]");

      // Commit both transactions
      await mysqlConnection.commit();
      console.log("✅ mySql COMMITTED success [" + key + "]");

     // await pgTransaction.commit();
     //       console.log("✅ PG COMMITTED success [" + key + "]");

      console.log("🚀 Transaction COMMITTED for key [" + key + "]");
      
      try {
      await redisClient.set(key, JSON.stringify(mysqlResult), 'EX', TTL_SECONDS);
    } catch (error) {
      console.log("Failed to add Redis key: "+ key +" \n " + error)
      await redisClient.set(key, JSON.stringify(pgResult), 'EX', TTL_SECONDS);
      return "Successfully Added " + key +" on Postgres. Failed on mySql";
    }

    return "Successfully Added " + key;


    }catch(err){
        //      pgResult = await pgClient.query(pgInsertQuery, { type: pgClient.QueryTypes.INSERT });
//      console.log("Succefuly added to postgres key [" + key +"]")
      // Rollback both on error
      await mysqlConnection.rollback();
    //  await pgTransaction.rollback();
      console.error( "❌ Transaction FAILED and ROLLED BACK for key [" + key + "]:", err);

    }
    } finally {
      // Release DB connections
     // mysqlConnection.release();
      // No need to release pgTransaction, Sequelize handles it
    }
      
    }
    

/** Update in DB, refresh cache */
const updateCachedOrQuery = async (key, mysqlUpdateQuery, pgUpdateQuery, replacements = []) => {
  try {
    let mysqlResult = null;
    let pgResult = null;
    let result = null;

    let mysqlSuccess = false;
    let pgSuccess = true;

    console.log(`Updating MySQL and PostgreSQL for key: [${key}]`);

    // Database Updates
    try {

         // Begin transaction
      await mysqlPool.beginTransaction();
      console.log(`MySQL Transaction began for key: [${key}]`);

      // MySQL Update
      [mysqlResult] = await mysqlPool.query(mysqlUpdateQuery, replacements);
      mysqlSuccess = true;
      console.log(`✅ MySQL update successful for key: [${key}]`);
    // Optional: check affected rows
    if (result.affectedRows === 0) {
       console.log(`No record found to update for productId: ${productId}`);
    }
      // PostgreSQL Update
//      pgResult = await pgClient.query(pgUpdateQuery, replacements);  // assume replacements is an array
//      pgSuccess = true;
//      console.log(`✅ PostgreSQL update successful for key: [${key}]`);

    } catch (dbErr) {
      console.error(`❌ DB update error for key: [${key}]`, dbErr);

      if (!mysqlSuccess && !pgSuccess) {
        return `❌ Both MySQL and PostgreSQL update failed for key: [${key}]\n${dbErr}`;
      }
      if (!mysqlSuccess) {
        console.warn(`⚠️ MySQL update failed for key: [${key}], falling back to PG result.`);
        result = pgResult;
      } else if (!pgSuccess) {
        console.warn(`⚠️ PostgreSQL update failed for key: [${key}], falling back to MySQL result.`);
        result = mysqlResult;
      }
    }

    // If both DB operations succeeded, prefer MySQL result
    if (mysqlSuccess && pgSuccess) {
      result = mysqlResult;
    }

    // Redis Cache Update
    if (result) {
      console.log(`🔁 Caching result to Redis for key: [${key}]`);
      await redisClient.setEx(key, TTL_SECONDS, JSON.stringify(productId,
      itemsRemaining,
      lastUpdated));
    } else {
      console.warn(`⚠️ No result to cache for key: [${key}]`);
    }
    // Commit transaction
    await mysqlPool.commit();

    return res.status(200).send({
      success: true,
      message: "✅ Available item updated successfully",
      data: { productId, itemsRemaining, lastUpdated }
    });

  } catch (error) {
    await connection.rollback(); // Rollback transaction on error
    console.error("🔥 updateAvailableItems error:", error.message);
    return res.status(500).send({
      success: false,
      message: "❌ Failed to update available item",
      error: error.message
    });

  }
};


/** Remove from DB, delete from Redis */
const removeCachedAndQuery = async (key, mysqlDeleteQuery, pgDeleteQuery, replacements = []) => {
  try {
    let mysqlSuccess = false;
    let pgSuccess = true;
    console.log("Product Id to be deleted :" + replacements + "mysql query: " + mysqlDeleteQuery)
    // Try MySQL delete
    try {
      await mysqlPool.query(mysqlDeleteQuery, replacements);
      mysqlSuccess = true;
      console.log(`✅ MySQL delete successful for key:[${replacements}] from [${key}]`);
    } catch (mysqlErr) {
      console.warn(`⚠️ MySQL delete failed for key: [${key}], Failed: `, mysqlErr.message);
/*
      // Fallback to PostgreSQL delete
      try {
        await pgClient.query(pgDeleteQuery, replacements);
        pgSuccess = true;
        console.log(`✅ PostgreSQL delete successful for key: [${key}]`);
      } catch (pgErr) {
        console.error(`❌ Both MySQL and PostgreSQL delete failed for key: [${key}]`, pgErr.message);
        throw pgErr; // rethrow to outer catch
      } */
    }

    // Remove from Redis
    try {
      const redisResult = await redisClient.del(key);
      console.log(`🗑️ Redis key deleted: [${key}]`);
    } catch (redisErr) {
      console.warn(`⚠️ Failed to delete Redis key: [${key}]`, redisErr.message);
    }

    return {
      success: true,
      mysqlDeleted: mysqlSuccess,
      pgDeleted: pgSuccess,
    };

  } catch (err) {
    console.error(`🔥 removeCachedAndQuery error:`, err.message);
    throw err;
  }
};


module.exports = {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery,
  
};
