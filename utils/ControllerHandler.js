import redisConfig, { updateDataWithNoExpiry } from '../config_redis/redis_config.js';
const { removeData, setData, getData, keyExists,  setDataWithNoExpiry} = redisConfig;
// import mysqlPool  from '../config/db.js';
import { pgClient } from '../config/postgres.js';
import { createConnection } from "mysql2/promise"; 
const TTL_SECONDS = 30000 * 10; // 5 minutes x 10
import multer, { memoryStorage } from 'multer';
import { getConnection } from '../config/db.js';

import TimeUtils from './Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;

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

/** Get from cache or fallback to DB query */

const getCachedOrQuery = async (key, mysqlQuery, pgQuery) => {
  try {
    // 1. Check if data exists in Redis
    const cachedExists = await keyExists(key);

    if (cachedExists) {

      console.log(`${getLongTime()}[CACHE HIT] ${key}`);
      const cachedData = await getData(key);

      if (cachedData) {
        console.log(`${getLongTime()}[CACHE DATA] ${key} : ${cachedData.length}`);
        return cachedData;

      } else {
        console.log(`${getLongTime()}[CACHE HIT EMPTY] ${key}`);
        return null;
      }
    }

    // 2. Cache miss – Query MySQL first
    console.log(`${getLongTime()}[CACHE MISS] ${key}. Querying MySQL...`);
   const connection = await getConnection();
    if (!connection) {
      console.error(getLongTime() + " mysqlPool is not defined or imported properly");
      throw new Error("mysqlPool undefined");
    }

 
//    await connection.beginTransaction();
    console.log(`${getLongTime()}MySQL connected. Thread ID: ${connection.threadId}`);

    try {
      console.log(`${getLongTime()} Key[ ${key}] Executing mysql query:`, mysqlQuery)
      const [mysqlResult] = await connection.query(mysqlQuery);

      if (mysqlResult?.length) {
        console.log(`${getLongTime()}[MySQL SUCCESS] ${key} : ${mysqlResult.length}`);
        //await setData(key, JSON.stringify(mysqlResult), "EX", TTL_SECONDS);
        //await setDataWithNoExpiry(key)

        connection.release();
        return mysqlResult;


      } else {
        console.log(`${getLongTime()}[MySQL EMPTY RESULT] ${key}`);
        throw new Error("MySQL empty result");
      }
    } catch (mysqlErr) {
      connection.release();
      console.warn(`[MySQL ERROR] ${mysqlErr.message}`);
      throw mysqlErr;
    }finally {
      if(connection ){
        try{

          connection.release();
          console.log(getLongTime() + " Mysql Connection Realeased");
        }catch(err){
          console.error(getLongTime() + " Error releasing mySQL connection:", err)
        }
      }
    }

  } catch (mysqlOrCacheErr) {     




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
const addCachedAndQuery = async (key, mysqlInsertQuery, pgInsertQuery = null, values = [],mySqlConnection) => {

  if (!mySqlConnection) {
    throw new Error("❌ mysqlPool is not defined or improperly initialized");
  }

  if (!key || typeof key !== 'string') {
    throw new Error("❌ Invalid Redis key provided");
  }

  if (!mysqlInsertQuery || typeof mysqlInsertQuery !== 'string') {
    throw new Error("❌ Invalid MySQL insert query provided");
  }

  if (!Array.isArray(values)) {
    throw new Error("❌ Values must be an array");
  }

//  const mysqlConnection = await getConnection();
  let mysqlResult = null;
  let pgResult = null;

  if(!mySqlConnection){
    
  throw new Error("❌ mysqlConnection not connected...!");

  }

  try {
    console.log(`${getLongTime()}📦 Inserting new key: [${key}] \n mysqlInsertQuery ${mysqlInsertQuery} \n values: ${values} isArray: ${Array.isArray(values)}`);
    console.log(getLongTime() + " 🔌 mysqlConnection:", mySqlConnection?.constructor?.name);
    if (!mySqlConnection || typeof mySqlConnection.query !== 'function') {
      throw new Error("❌ mysqlConnection is not valid or not initialized properly");
    }

    // Start MySQL transaction
   // await mysqlConnection.beginTransaction();

    try {
      // MySQL insert
//      [mysqlResult] = await mysqlConnection.query(mysqlInsertQuery, values);
      const results = await insertWithIncrementRetry(mysqlInsertQuery,values, mySqlConnection)


      if(!results){
       throw `❌ MySQL insert Failed for key: [${key}]` 
      }
        console.log(`${getLongTime()}✅ MySQL insert successful for key: [${key}]`);

      // Commit MySQL
      //await mysqlConnection.commit();
      //console.log(`🔒 MySQL transaction committed for key: [${key}]`);

      // Redis caching
      try {
        const replacementsObj = Object.fromEntries(
          values.map((v, i) => [`param${i}`, v])
        );
        console.log(`${getLongTime()}Done prep data to insert to db, Key[${JSON.stringify(key)}] value[${values}]`);
        const redisCachStatus = await updateDataWithNoExpiry(key, replacementsObj);
        if(!redisCachStatus){

          console.log(getLongTime() + " ❌ AddCacheAndQuery: SOmething wrong happening while updating Data With No Expiry")
        }


        console.log(`${getLongTime()}🧠 Redis cache updated for key: [${key}]`

        );
      } catch (cacheErr) {
        console.warn(`⚠️ Redis cache update failed for key: [${key}]:`, cacheErr);
        return `✅ Inserted [${key}] but failed to update Redis`;
      }

      return `✅ Successfully added [${key}]`;

    } catch (insertErr) { 

      //await mysqlConnection.rollback();
      console.Error(`${getLongTime()} ❌ Key[${JSON.stringify(key)}] value[${values}] \n 
      DB insert failed and transaction rolled back for key: [${key}]:`, insertErr);

      // Optional fallback: Try PostgreSQL even if MySQL fails
/*      try {
        if (pgInsertQuery && pgClient) {
          pgResult = await pgClient.query(pgInsertQuery, values);
          console.log(`${getLongTime()}✅ Fallback PostgreSQL insert succeeded for key: [${key}]`);

          // Optional Redis update on fallback
          const fallbackObj = Object.fromEntries(
            values.map((v, i) => [`param${i}`, v])
          );
          await updateDataWithNoExpiry(key, fallbackObj);

          return `⚠️ MySQL failed but PostgreSQL insert succeeded for key: [${key}]`;
        }
      } catch (pgErr) {
        console.Error(`${getLongTime()} ❌ PostgreSQL fallback also failed for key: [${key}]`, pgErr);
      }*/

      
      console.log(`${getLongTime()}❌ Failed to insert [${key}] into both DBs`);

      throw insertErr;
    }

  } catch (mainErr) {
    console.Error(`${getLongTime()} 🔥 Critical error during addCachedAndQuery for key: [${key}]`, mainErr);
    throw mainErr;

  } 
};

/** Update in DB, refresh cache */
const updateCachedOrQuery = async (key, mysqlUpdateQuery, pgUpdateQuery = null, replacements = []) => {
  if (!key || typeof key !== 'string') {
    console.error(getLongTime() + " ❌ Invalid Redis key");
    return null;
  }

  if (!mysqlUpdateQuery || typeof mysqlUpdateQuery !== 'string') {
    console.error(getLongTime() + " ❌ Invalid MySQL query");
    return null;
  }

  if (!Array.isArray(replacements)) {
    console.error(getLongTime() + " ❌ Replacements must be an array");
    return null;
  }

  const connection = await getConnection();

  let mysqlResult = null;
  let pgResult = null;
  let result = null;
  let mysqlSuccess = false;
  let pgSuccess = true; // Default to true if pgUpdateQuery not provided

  console.log(`${getLongTime()}🛠️ Starting DB update and cache for key: [${key}]`);

  try {
    await connection.beginTransaction();
    console.log(`${getLongTime()}🔄 MySQL Transaction started for key: [${key}]`);

    // MySQL Update
    try {
      [mysqlResult] = await connection.query(mysqlUpdateQuery, replacements);
      mysqlSuccess = true;

      if (mysqlResult.affectedRows === 0) {
        console.warn(`⚠️ No record updated in MySQL for key: [${key}]`);
      } else {
        console.log(`${getLongTime()}✅ MySQL update succeeded for key: [${key}]`);
      }
    } catch (mysqlErr) {
      console.Error(`${getLongTime()} ❌ MySQL update failed for key: [${key}]`, mysqlErr);
    }

    // PostgreSQL Update (if provided)
    if (pgUpdateQuery) {
      try {
        pgResult = await pgClient.query(pgUpdateQuery, replacements);
        pgSuccess = true;
        console.log(`${getLongTime()}✅ PostgreSQL update succeeded for key: [${key}]`);
      } catch (pgErr) {
        pgSuccess = false;
        console.Error(`${getLongTime()} ❌ PostgreSQL update failed for key: [${key}]`, pgErr);
      }
    }

    // Determine fallback result
    if (mysqlSuccess && pgSuccess) {
      result = mysqlResult;
    } else if (mysqlSuccess) {
      console.warn(`⚠️ Using MySQL result only for key: [${key}]`);
      result = mysqlResult;
    } else if (pgSuccess) {
      console.warn(`⚠️ Using PostgreSQL result only for key: [${key}]`);
      result = pgResult;
    } else {
      throw new Error("Both MySQL and PostgreSQL updates failed");
    }

    // Redis Cache Update
    if (result) {
      console.log(`${getLongTime()}🧠 Updating Redis cache for key: [${key}]`);

      // You can adjust the logic here to build a consistent object from the result or `replacements`
      const cacheValue = Array.isArray(replacements)
        ? Object.fromEntries(replacements.map((val, idx) => [`param${idx}`, val]))
        : {};

      await updateDataWithNoExpiry(key, cacheValue); // Assumes this function handles JSON.stringify etc.
    } else {
      console.warn(`⚠️ No valid result for Redis cache on key: [${key}]`);
    }

    await connection.commit();
    console.log(`${getLongTime()}✅ Transaction committed successfully for key: [${key}]`);
    return `✅ [${key}] updated successfully`;

  } catch (err) {
    await connection.rollback();
    console.Error(`${getLongTime()} 🔥 Transaction rollback for key: [${key}] due to error:`, err.message);
    return `❌ Update failed for key: [${key}]`;

  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 Connection released for key: [${key}]`);
  }
};



/** Remove from DB, delete from Redis */
 const removeCachedAndQuery = async (key, mysqlDeleteQuery, pgDeleteQuery = null, replacements = []) => {
  
  const connect = await getConnection();

  if (!connect || typeof getConnection !== 'function') {
    throw new Error("❌ mysqlPool is not defined or initialized properly");
  }

  if (!key || typeof key !== 'string') {
    throw new Error("❌ Invalid Redis key");
  }

  if (!mysqlDeleteQuery || typeof mysqlDeleteQuery !== 'string') {
    throw new Error("❌ Invalid MySQL delete query");
  }

  if (!Array.isArray(replacements)) {
    throw new Error("❌ Replacements must be an array");
  }

  const connection = await getConnection();
  

  let mysqlSuccess = false;
  let pgSuccess = true;

  try {
    console.log(`${getLongTime()}🗑️ Deleting for key: [${key}], replacements: ${JSON.stringify(replacements)}`);

    // Try MySQL delete
    const query = `DELETE FROM ${key}  WHERE productId =${replacements}`
    try {
     // const [mysqlResult] = await connection.query(mysqlDeleteQuery, replacements);
      const [mysqlResult] = await connection.query(query);
     
     mysqlSuccess = true;
      console.log(`${getLongTime()}✅ MySQL delete successful for key: [${key}]`);
    } catch (mysqlErr) {
      console.warn(`⚠️ MySQL delete failed for key: [${key}] -> ${mysqlErr.message}`);

      // Optional PostgreSQL fallback
      if (pgDeleteQuery && pgClient) {
        try {
          await pgClient.query(pgDeleteQuery, replacements);
          pgSuccess = true;
          console.log(`${getLongTime()}✅ PostgreSQL fallback delete successful for key: [${key}]`);
        } catch (pgErr) {
          pgSuccess = false;
          console.Error(`${getLongTime()} ❌ PostgreSQL delete failed for key: [${key}] -> ${pgErr.message}`);
          throw new Error(`${getLongTime()} ❌ Delete failed in both MySQL and PostgreSQL`);
        }
      } else {
        pgSuccess = false;
        console.warn(`ℹ️ No PostgreSQL fallback attempted for key: [${key}]`);
      }
    }

    // Remove from Redis
    try {
      const redisDelResult = await removeData(key); // Should return number of keys deleted
      if (redisDelResult > 0) {
        console.log(`${getLongTime()}🧹 Redis key deleted: [${key}]`);
      } else {
        console.warn(`⚠️ Redis key [${key}] not found or already deleted`);
      }
    } catch (redisErr) {
      console.warn(`⚠️ Failed to delete Redis key: [${key}] -> ${redisErr.message}`);
    }

    return {
      success: mysqlSuccess || pgSuccess,
      mysqlDeleted: mysqlSuccess,
      pgDeleted: pgSuccess,
    };

  } catch (err) {
    console.Error(`${getLongTime()} 🔥 removeCachedAndQuery critical error: ${err.message}`);
    throw err;
  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 MySQL connection released for key: [${key}]`);
  }
};


const insertWithIncrementRetry = async (
  mysqlInsertQuery,
  replacements = [],
  mySqlConnection,
  conflictIndex = 0,           // Index of the primary key (e.g., priceTraceId)
  imageUrlIndex = null,        // Index of the image_url in the replacements array (optional)
  maxRetries = 5,
) => {

//  const connection = await getConnection();

  let retries = 0;
  console.log(getLongTime() + " 🛠️ mysqlInsertQuery Type:", typeof mysqlInsertQuery);
  console.log(getLongTime() + " 🛠️ Query:", mysqlInsertQuery);
  console.log(getLongTime() + " 🛠️ values:", replacements, "Array?", Array.isArray(replacements));
  console.log(getLongTime() + " 🔌 Connection Type:", mySqlConnection?.constructor?.name);

  if (!mysqlInsertQuery || typeof mysqlInsertQuery !== 'string') {
    throw new Error(`${getLongTime()} ❌ mysqlInsertQuery is invalid for key: ${key}`);
  }
  if (!Array.isArray(replacements)) {
    throw new Error(`${getLongTime()} ❌ values is not an array for key: ${key}`);
  }
  if (!mySqlConnection) {
    throw new Error(`${getLongTime()} ❌ mysqlConnection is invalid for key: ${key}`);
  }


  while (retries < maxRetries) {
    try {

      const [result] = await mySqlConnection.query(mysqlInsertQuery, replacements);

      // connection.release();
      console.log(`${getLongTime()}✅ Insert successful after ${retries} retries.`);
      return result;

    } catch (err) {
//      connection.release();

      if (err.code === 'ER_DUP_ENTRY' && err.sqlMessage.includes('Duplicate entry')) {
        // Increment primary key
        const currentId = parseInt(replacements[conflictIndex], 10);
        const newId = currentId + 1;
        replacements[conflictIndex] = newId;
        console.warn(`⚠️ Duplicate key ${currentId}. Retrying with ${newId}...`);

        // Increment image filename if applicable
        if (imageUrlIndex !== null && typeof replacements[imageUrlIndex] === 'string') {
          replacements[imageUrlIndex] = incrementImageUrl(replacements[imageUrlIndex]);
          console.warn(`🖼️ Image URL updated to: ${replacements[imageUrlIndex]}`);
        }

        retries += 1;
      } else {
        console.Error(`${getLongTime()} ❌ Insert failed: ${err.message}`);
        throw err;
      }

    console.log(`${getLongTime()}Inserting data after ${retries} due to Dup Keys`);
    //console.log(`📦 Inserting new key: [${key}]`);

 // const mysqlConnection = await getConnection();

    // Start MySQL transaction
//    await mysqlConnection.beginTransaction();

    try {
      // MySQL insert
      [mysqlResult] = await mySqlConnection.query(mysqlInsertQuery, replacements);
 //     const [data] = await mySqlConnection.query(`SELECT * FROM ` + key)
 
 //     updateDataWithNoExpiry(key, data);
      console.log(`${getLongTime()}${getLongTime()}✅ MySQL insert successful for Query: [${mysqlInsertQuery}]`);

/*      // PostgreSQL insert (optional)
      if (pgInsertQuery && pgClient) {
        pgResult = await pgClient.query(pgInsertQuery, values);
        console.log(`${getLongTime()}✅ PostgreSQL insert successful for key: [${key}]`);
      }
*/
      // Commit MySQL
  //    await mysqlConnection.commit();
      console.log(`${getLongTime()}🔒 MySQL transaction committed for key: [${key}]`);

      
 //     await updateDataWithNoExpiry(key, replacementsObj);

      console.log(`${getLongTime()}✅ Successfully added [${key}]`);

      return true;

    } catch (err) {

//      await mysqlConnection.rollback();
    console.Error(`${getLongTime()} ❌ DB insert failed and transaction rolled back for key: [${key}]:`);
    console.error(getLongTime() + " ❗ Error name:", err.name);
    console.error(getLongTime() + " ❗ Error message:", err.message);
    console.error(getLongTime() + " ❗ Error stack:", err.stack);
    throw err;
    }

    }
  }

  throw new Error(`${getLongTime()} ❌ Max retries (${maxRetries}) reached. Insert failed.`);
};


function incrementImageUrl(imageUrl) {
  // Example: "Product_20.jpg" -> "Product_21.jpg"
  const regex = /(\D*)(\d+)(\.\w+)$/; // Matches base text, number, and extension
  const match = imageUrl.match(regex);

  if (!match) return imageUrl;

  const base = match[1];       // "Product_"
  const number = parseInt(match[2], 10);  // 20
  const ext = match[3];        // ".jpg"

  return `${base}${number + 1}${ext}`;
}


/*
const insertWithIncrementRetry = async (
  mysqlInsertQuery,
  replacements = [],
  conflictIndex = 0, // Index in `replacements` array for the primary key
  maxRetries = 50
) => {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const connection = await getConnection();
      try {
        const [result] = await connection.query(mysqlInsertQuery, replacements);
        connection.release();
        console.log(`${getLongTime()}✅ Insert successful after ${retries} retries.`);
        return result;
      } catch (err) {
        connection.release();

        // Check for duplicate key
        if (
          err.code === 'ER_DUP_ENTRY' &&
          err.sqlMessage.includes('Duplicate entry')
        ) {
          const currentValue = parseInt(replacements[conflictIndex], 10);
          const newValue = currentValue + 1;
          console.warn(`⚠️ Duplicate key ${currentValue}. Retrying with ${newValue}...`);

          replacements[conflictIndex] = newValue;
          retries += 1;
        } else {
          // Unknown error
          console.Error(`${getLongTime()} ❌ Insert failed: ${err.message}`);
          throw err;
        }
      }
    } catch (outerErr) {
      console.Error(`${getLongTime()} 🔥 MySQL connection error: ${outerErr.message}`);
      throw outerErr;
    }
  }

  throw new Error(`${getLongTime()} ❌ Max retries (${maxRetries}) reached. Insert failed.`);
};
*/
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
