const redisClient = require('../config/redisClient');
//const { mysqlPool } = require('../config/db');
const { pgClient } = require('../config/postgres');
const mysql = require("mysql2/promise"); 
const keys = require("../keys")
const getShortTime = require("./Time")
const TTL_SECONDS = 300 * 10; // 5 minutes x 10
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
const updateCachedOrQuery = async (key, mysqlUpdateQuery, pgUpdateQuery) => {
  try {
    let pgResult;
    let mysqlResult;
    let mysqlChecks = false;
    let pgChecks = false;
    let dbOperationsChecks = false;
    let redisOperationsChecks = false;

    try {
      console.log("Updating mySql and pg for key: [" +key+"]")
      [mysqlResult] = await mysqlPool.query(mysqlUpdateQuery);
      mysqlChecks = true;
      console.log("Updating mySql for key: [" +key+"]");

      pgResult = await pgClient.query(pgUpdateQuery, { type: pgClient.QueryTypes.UPDATE });
      pgChecks = true;
      if(pgChecks === true && mysqlChecks === true){
        dbOperationsChecks = true;
      }

    } catch (mysqlErr) {

      dbOperationsChecks = false;

      if(mysqlChecks ===true){
        console.log("Failed to add mysql for key: [" +key+"]")
      return "Failed to add to db for key [" + key +"] \n"+ mysqlErr

      }else if(pgChecks){
        console.log("Failed to add pg for key: [" +key+"]")
      return "Failed to add to db pg for key [" + key +"] \n"+ mysqlErr

      }else if(pgChecks === false && mysqlChecks === false){

        console.log("Failed to add mysql and pg for key: [" +key+"]")
      return "Failed to add to db for key [" + key +"] \n"+ mysqlErr

      }
    }

    if(dbOperationsChecks){
    
      // Check if the key exists in Redis
      const exists = await redisClient.exists(key);
      if (exists) {
        console.log("Updating existing Redis key : [" + key + "]");
        await redisClient.set(key, JSON.stringify(mysqlResult), 'EX', TTL_SECONDS);
      } else {
        console.log("Key not found in Redis, adding new key : [" + key + "]");
        await redisClient.set(key, JSON.stringify(mysqlResult), 'EX', TTL_SECONDS);
      }
    }else{
      if(mysqlChecks===false){
        console.log("mysql Failed");
         // Check if the key exists in Redis
      const exists = await redisClient.exists(key);
      if (exists) {
        console.log("mysql Failed: Updating existing Redis key : [" + key + "]");
        await redisClient.set(key, JSON.stringify(pgResult), 'EX', TTL_SECONDS);
        console.log("Updated with only mysql")

      } else {
        console.log("mysql Failed: Key not found in Redis, adding new key : [" + key + "]");
        await redisClient.set(key, JSON.stringify(pgResult), 'EX', TTL_SECONDS);
        console.log("Updated with only pgResult")
      }
      }

    }
    console.log("Now Updating Redis key : [" + key + "]" )
    await redisClient.setEx(key, TTL_SECONDS, JSON.stringify(result));


    return result;
  } catch (err) {
    console.error( `updateCachedOrQuery error:`, err.message);
    throw err;
  }
};

/** Remove from DB, delete from Redis */
const removeCachedAndQuery = async (key, mysqlDeleteQuery, pgDeleteQuery) => {
  try {
    try {
      await mysqlPool.query(de);
    } catch (mysqlErr) {
      await pgClient.query(pgDeleteQuery, { type: pgClient.QueryTypes.DELETE });
    }
    await redisClient.del(key);
    return { success: true };
  } catch (err) {
    console.error( `removeCachedAndQuery error:`, err.message);
    throw err;
  }
};

module.exports = {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery,
  
};
