// dbOperations.js

import { getConnection } from '../config/db.js';
import TimeUtils from './Time.js';
const { getLongTime } = TimeUtils;
import { logRequestDetails, logResponseDetails } from './requestLogger.js';
import redisClient from '../config/redisClient.js';

const  {connectRedis, cacheSet, cacheGet, cacheDelete, cacheExists, refreshKey} = redisClient;

// Correct way for default export
//import redisCache from '../config/redisClient.js';

//const { cacheGet, cacheSet, cacheDelete, connectRedis, cacheExists } = redisCache;

// 📌 TTL for future cache integration (optional)
const TTL_SECONDS = 30000 * 10;

// 🔧 Reusable: MySQL SELECT wrapper
const getCachedOrQuery = async (key, mysqlQuery) => {
  const connection = await getConnection();
  if (!connection) throw new Error("❌ MySQL connection failed");

  try {


    /*
    const keyExist = await cacheExists(key);

    if (keyExist.success) {
      console.log(`✅  Cache ${key} HIT ...!`);
      // You might return the cache here if you want to short-circuit
    } else {
      console.log(`❌ Cache ${key} Missed ...!`);
    }
*/

 
    console.log(`${getLongTime()}🔍 Executing SELECT for key [${key}]`);


    const [rows] = await connection.query(mysqlQuery); // ✅ FIXED
    cacheSet(key,[rows])

    if (!rows || rows.length === 0) {

      console.warn(`${getLongTime()}⚠️ Empty result for key: [${key}]`);
      //throw new Error(`No result found for key: ${key}`);
      return [];

    }

    console.log(`${getLongTime()}✅ SELECT success: ${rows.length} rows on key ${key}`);

    return rows; // ✅ return clean data

  } catch (err) {
    console.error(`${getLongTime()}❌ SELECT failed on key ${key}:`, err.message);
    
    throw new Error(`${getLongTime()}❌ SELECT failed on key ${key}:`, err.message);
    
  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 Connection released for key: [${key}]`);
  }
};


// 🔧 Reusable: INSERT with validation and optional retry logic
const addCachedAndQuery = async (key, mysqlInsertQuery, values = [], _connection) => {

    const connection = await getConnection();
  if (!connection) throw new Error("❌ MySQL connection failed");

  if (!key || !mysqlInsertQuery || !Array.isArray(values)) {

    // Show which input is missing or invalid
    console.log(`Missing or invalid input(s):`, {
      key,
      mysqlInsertQuery,
      values
    });

    throw new Error(`❌ Invalid input to addCachedAndQuery on key ${key}`);
  }

  if (!connection) throw new Error("❌ MySQL connection not provided");

  try {
      console.log(`${getLongTime()}📥 INSERTING key: [${key}]`, {
      key,
      mysqlInsertQuery,
      values
    });

    refreshKey();

    const result = await connection.query(mysqlInsertQuery, values);

    console.log(`${getLongTime()}✅ INSERT successful on key ${key}:`);
    cacheSet(key,[result])
    return result;
    
  } catch (err) {
    console.error(`${getLongTime()}❌ INSERT failed for key [${key}]:`, err.message);
     throw new Error(`${getLongTime()}❌ INSERT failed for key [${key}]:`, err.message);
    throw err;
  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 Connection released after insert: [${key}]`);
  }
};

// 🔧 Reusable: UPDATE
const updateCachedOrQuery = async (key, mysqlUpdateQuery, values = []) => {
  const connection = await getConnection();
  if (!connection) throw new Error("❌ MySQL connection failed");

  try {

      console.log(`${getLongTime()}📥 Updating key: [${key}]`, {
      key,
      mysqlUpdateQuery,
      values
    });
 
    await connection.beginTransaction();

    const result = await connection.query(mysqlUpdateQuery, values);
    /*
    connection.query(query, replacements, (err, results) => {
  if (err) {
    console.error("Insert error:", err);
    return res.status(500).json({ success: false, message: "Database insert failed" });
  }

  return res.status(200).json({ success: true, message: "Estimate added successfully", data: results });
});
    */

    if (result.affectedRows === 0) {
      console.warn(`${getLongTime()}⚠️ No rows updated for key: [${key}]`);
    } else {
      console.log(`${getLongTime()}✅ Updated ${result.affectedRows} rows on key ${key}`);

      refreshKey();

      cacheSet(key,[result])

    }

    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    console.error(`${getLongTime()}❌ Update failed for key [${key}]:`, err.message);
    
   throw new Error(`${getLongTime()}❌ Delete failed for [${key}]:`, err.message);

  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 Connection released after update: [${key}]`);
  }
};

// 🔧 Reusable: DELETE
const removeCachedAndQuery = async (key, mysqlDeleteQury, value) => {
  const connection = await getConnection();
  if (!connection) throw new Error("❌ MySQL connection failed");

  try {
    //const query = `DELETE FROM ${tableName} WHERE ${whereField} = ?`;

    console.log(`${getLongTime()}🗑️ Deleting from [${key}] where ${value} = ${value}`);

    const result = await connection.query(mysqlDeleteQury, value);

    connection.commit();
    refreshKey();

    console.log(`${getLongTime()}✅ Delete result: on key ${key} `, result);
    return result;
  } catch (err) {
    connection.rollback();

    console.error(`${getLongTime()}❌ Delete failed for [${key}]:`, err.message);
    throw new Error(`${getLongTime()}❌ Delete failed for [${key}]:`, err.message);
  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 Connection released after delete: [${key}]`);
  }
};

const removeCachedAndQueryById = async (key, productId) => {
  const connection = await getConnection();
  if (!connection) throw new Error("❌ MySQL connection failed");

  try {
    //const query = `DELETE FROM ${tableName} WHERE ${whereField} = ?`;

    const mysqlDeleteQury = `DELETE FROM ${key} WHERE productId=${productId}`;
    console.log(`${getLongTime()}🗑️ ${mysqlDeleteQury}`);

    const result = await connection.query(mysqlDeleteQury);
    connection.commit()
    refreshKey();
    
    console.log(`${getLongTime()}✅ Delete result: on key ${key} `, result);
    return result;
  } catch (err) {
    connection.rollback();

    console.error(`${getLongTime()}❌ Delete failed for [${key}]:`, err.message);
    throw new Error(`${getLongTime()}❌ Delete failed for [${key}]:`, err.message);
  } finally {
    connection.release();
    console.log(`${getLongTime()}🔚 Connection released after delete: [${key}]`);
  }
};

// 🔁 Retry logic for primary key collision
const insertWithIncrementRetry = async (
  mysqlInsertQuery,
  values = [],
  connection,
  conflictIndex = 0,
  imageUrlIndex = null,
  maxRetries = 5
) => {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const result = await connection.query(mysqlInsertQuery, values);
      console.log(`${getLongTime()}✅ Insert successful after ${retries} retries`);
      return result;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        const currentId = parseInt(values[conflictIndex], 10);
        values[conflictIndex] = currentId + 1;
        if (imageUrlIndex !== null) {
          values[imageUrlIndex] = incrementImageUrl(values[imageUrlIndex]);
        }
        console.warn(`⚠️ Duplicate key. Retrying with new ID: ${values[conflictIndex]}`);
        retries++;
      } else {
        throw err;
      }
    }
  }

  throw new Error(`${getLongTime()} ❌ Max retries (${maxRetries}) reached. Insert failed.`);
};

// 🧠 Helper
function incrementImageUrl(url) {
  const match = url.match(/(\D*)(\d+)(\.\w+)$/);
  if (!match) return url;
  const base = match[1], number = parseInt(match[2]), ext = match[3];
  return `${base}${number + 1}${ext}`;
}

// 🧱 Export the module
export default {
  getCachedOrQuery,
  addCachedAndQuery,
  updateCachedOrQuery,
  removeCachedAndQuery,
  insertWithIncrementRetry,removeCachedAndQueryById
};
