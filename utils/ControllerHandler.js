import redisConfig from '../config_redis/redis_config.js';
const { removeData, setData, getData, keyExists } = redisConfig;
import mysqlPool  from '../config/db.js';
import { pgClient } from '../config/postgres.js';
import { createConnection } from "mysql2/promise"; 
const TTL_SECONDS = 30000 * 10; // 5 minutes x 10
import multer, { memoryStorage } from 'multer';
/*
const mysqlPool = mysql.createPool({ 
  host: keys.myHost.trim(),
  user: keys.myUser.trim(),
  password: keys.myPassword.trim(),
  database: keys.myDatabase.trim(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
*/

const cacheKey = "productList"
/** Get from cache or fallback to DB query */

const getCachedOrQuery = async (key, mysqlQuery, pgQuery) => {
  try {
    // 1. Check if data exists in Redis
    const cachedExists = await keyExists(key);
    if (cachedExists) {
      console.log(`[CACHE HIT] ${key}`);
      const cachedData = await getData(key);
      if (cachedData) {
        console.log(`[CACHE DATA] ${key} : ${cachedData}`);
        return JSON.parse(cachedData);
      } else {
        console.log(`[CACHE HIT EMPTY] ${key}`);
        return null;
      }
    }

    // 2. Cache miss – Query MySQL first
    console.log(`[CACHE MISS] ${key}. Querying MySQL...`);

    if (!mysqlPool) {
      console.error("mysqlPool is not defined or imported properly");
      throw new Error("mysqlPool undefined");
    }

    const connection = await mysqlPool.getConnection();
    console.log(`MySQL connected. Thread ID: ${connection.threadId}`);

    try {
      const [mysqlResult] = await connection.query(mysqlQuery);
      connection.release();

      if (mysqlResult?.length) {
        console.log(`[MySQL SUCCESS] ${key} : ${JSON.stringify(mysqlResult)}`);
        await setData(key, JSON.stringify(mysqlResult), "EX", TTL_SECONDS);
        return mysqlResult;
      } else {
        console.log(`[MySQL EMPTY RESULT] ${key}`);
        throw new Error("MySQL empty result");
      }
    } catch (mysqlErr) {
      connection.release();
      console.warn(`[MySQL ERROR] ${mysqlErr.message}`);
      throw mysqlErr;
    }

  } catch (mysqlOrCacheErr) {
    // 3. Fallback to PostgreSQL
    console.log(`[POSTGRES FALLBACK] ${key}`);
    try {
      const pgResult = await pgClient.query(pgQuery, {
        type: pgClient.QueryTypes.SELECT,
      });

      if (pgResult?.length) {
        console.log(`[PostgreSQL SUCCESS] ${key} : ${JSON.stringify(pgResult)}`);
        await setData(key, JSON.stringify(pgResult), "EX", TTL_SECONDS);
        return pgResult;
      } else {
        console.warn(`[PostgreSQL EMPTY RESULT] ${key}`);
        throw new Error("Postgres also empty");
      }
    } catch (pgErr) {
      console.error(`[PostgreSQL ERROR] ${pgErr.message}`);
      throw pgErr;
    }
  }
};


// Configure multer for memory storage
const storage = memoryStorage();
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
    const pool = createConnection()
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

    const mysqlConnection = await getConnection(); // `mysql2` style
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
      await setData(key, JSON.stringify(mysqlResult), 'EX', TTL_SECONDS);
    } catch (error) {
      console.log("Failed to add Redis key: "+ key +" \n " + error)
      await setData(key, JSON.stringify(pgResult), 'EX', TTL_SECONDS);
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
      await beginTransaction();
      console.log(`MySQL Transaction began for key: [${key}]`);

      // MySQL Update
      [mysqlResult] = await query(mysqlUpdateQuery, replacements);
      mysqlSuccess = true;
      console.log(`✅ MySQL update successful for key: [${key}]`);
    // Optional: check affected rows
    if (mysqlResult.affectedRows === 0) {
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
    }else{
      console.warn(`⚠️ Only one DB operation succeeded for key: [${key}]. Using fallback result.`);
    }

    // Redis Cache Update
    if (result) {
      console.log(`🔁 Caching result to Redis for key: [${key}]`);
      await setEx(key, TTL_SECONDS, JSON.stringify(productId,
      itemsRemaining,
      lastUpdated));
    } else {
      console.warn(`⚠️ No result to cache for key: [${key}]`);
    }
    // Commit transaction
    await commit();

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
      await query(mysqlDeleteQuery, replacements);
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
      const redisResult = await del(key);
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

export default {
  removeData,
  setData,
  getData,
  keyExists,
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery,
};
