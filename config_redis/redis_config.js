import { createClient } from 'redis';
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;



// Create Redis client instance
const redisClient = createClient({
  url: 'redis://redis-service:6379',
  socket: {
    connectTimeout: 10000, // Optional: wait longer on Redis startup
  },
});

// Connect to Redis
redisClient.connect()
  .then(() => console.log(getLongTime() + ' ✅ Redis: Connected successfully'))
  .catch(err => {
    console.error('❌ Redis: Connection failed:', err);
    process.exit(1); // Exit on failure if Redis is critical
  });

// -------- Redis Utility Functions --------

// Set data with optional expiry (default: 3600s)
const setData = async (key, value, expiry = 3600) => {
  try {
    const ttl = parseInt(expiry, 10);
    if (isNaN(ttl)) throw new Error(`Invalid expiry: ${expiry}`);
    
    await redisClient.set(key, JSON.stringify(value), {
      EX: ttl
    });

    console.log(`${getLongTime()} ${getLongTime()} ✅ Redis: Set key "${key}" with expiry ${ttl}s`);
  } catch (err) {
    console.error(`${getLongTime()} ❌ Redis: Error setting data for key "${key}":`, err);
  }
};

/*
// Set data with no expiry (for static or persistent cache)
const setDataWithNoExpiry = async (key) => {
  try {
//    await redisClient.set(key, JSON.stringify(value));

  setRedisDataWithNoExpiry(key);
    console.log(`${getLongTime()} ${getLongTime()} ✅ Redis: Set key "${key}" with no expiry`);
    return true;
  } catch (err) {
    console.error(`${getLongTime()} ❌ Redis: Error setting key "${key}" with no expiry:`, err);
  }
};
*/

async function setDataWithNoExpiry(key, value) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🔍 Checking Redis for key: "${key}"`);
console.log(`🔎 Preparing to set Redis key "${key}" with value type:`, typeof value);

  try {
    const exists = await redisClient.exists(key);

    if (exists) {
      console.warn(`[${timestamp}] ⚠️ Redis key already exists: "${key}". Skipping insertion.`);
      return { status: 'exists', key };
    }

   const redisValue = typeof value === 'string' ? value : JSON.stringify(value);
    await redisClient.set(key, redisValue);

    console.log(`[${timestamp}] ✅ Redis key set successfully: "${key}"`);
    return { status: 'stored', key };
  } catch (err) {
    console.error(`[${timestamp}] ❌ Redis error while setting key "${key}":`, err);
    throw err;
  }
}


async function setDataWithExpiry(key, value, expirySeconds = 300) {
  const timestamp = new Date().toISOString();
  const prefix = 'temp:';
  const fullKey = `${prefix}${key}`;

  console.log(`[${timestamp}] 🕵️‍♂️ Validating input for key: "${fullKey}"`);

  // Validate key
  if (typeof key !== 'string' || key.trim() === '') {
    const msg = `[${timestamp}] ❌ Invalid key. Must be a non-empty string. Received: ${typeof key}`;
    console.error(msg);
    throw new TypeError(msg);
  }

  // Serialize value safely
  let redisValue;
  try {
    if (
      value instanceof Buffer ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      redisValue = value.toString();
    } else if (value instanceof Blob || value instanceof File) {
      console.warn(`[${timestamp}] ⚠️ Value is a Blob/File. Storing metadata instead.`);
      redisValue = JSON.stringify({
        type: value.constructor.name,
        size: value.size,
        lastModified: value.lastModified || null,
        name: value.name || 'unnamed',
      });
    } else if (value instanceof FormData) {
      console.warn(`[${timestamp}] ⚠️ Value is FormData. Converting to plain object.`);
      const plainObject = {};
      for (const [k, v] of value.entries()) {
        plainObject[k] = typeof v === 'string' ? v : '[Non-string FormData]';
      }
      redisValue = JSON.stringify(plainObject);
    } else {
      redisValue = JSON.stringify(value);
    }
  } catch (serializationError) {
    const msg = `[${timestamp}] ❌ Failed to serialize value for key "${fullKey}"`;
    console.error(msg, serializationError);
    throw new Error(msg);
  }

  // Proceed with Redis
  try {
    const exists = await redisClient.exists(fullKey);
    if (exists) {
      console.warn(`[${timestamp}] ⚠️ Key already exists: "${fullKey}"`);
      return { status: 'exists', key: fullKey };
    }

    await redisClient.setEx(fullKey, expirySeconds, redisValue);
    console.log(`[${timestamp}] ✅ Key "${fullKey}" set with TTL: ${expirySeconds}s`);
    return { status: 'stored', key: fullKey };
  } catch (err) {
    console.error(`[${timestamp}] ❌ Error setting key "${fullKey}" with expiry:`, err);
    throw err;
  }
}


async function updateDataWithNoExpiry_include_productId (key, newValue, productId){
  console.log(`${getLongTime()} ${getLongTime()} updateDataWithNoExpiry Started:`)
  try {
    // Step 1: Read old data
    const cached = await redisClient.get(key);
    let updatedData = [];

    if (cached) {

      try {
        updatedData = JSON.parse(cached); 

        if (!Array.isArray(updatedData)) {
          console.warn(`⚠️ Redis: Key "${key}" did not contain an array, reinitializing.`);
          updatedData = [];
        } else {
          console.log(`${getLongTime()} 📥 Redis: Existing data fetched for key "${key}":`, updatedData);
        }
      } catch (parseErr) {
        console.error(`${getLongTime()} ❌ Redis: Failed to parse data for key "${key}":`, parseErr);
        return false;
      }
    } else {
      console.log(`${getLongTime()} ℹ️ Redis: No existing data found for key "${key}", starting fresh.`);
    }

    // Step 2: Delete old key
    const deleteResult = await redisClient.del(key);
    console.log(`${getLongTime()} 🧹 Redis: Key "${key}" deleted:`, deleteResult === 1 ? "✅ Redis cleanup after deletion" : "✅  not found after deletion");
    const [ sourceOfTruth ] = router.get('/getProductBYId/:${productId}', getProductByID);

    console.log(`${getLongTime()} 📦 Redis key: [ ${key} ] New data after append:`, sourceOfTruth);

    // Step 4: Set key again with no expiry
    await redisClient.set(key, JSON.stringify(sourceOfTruth));
    console.log(`${getLongTime()} ✅ Redis: Key ["${key}"] updated with new data.`);

    return true;
  } catch (err) {

    const msg =`❌ Redis: Error during update process for key "${key}":, ${err}`
    console.error(msg);
    return false;
  }
};
const updateDataWithNoExpiry = async (key, newValue) => { 
  console.log(`${getLongTime()} ${getLongTime()} updateDataWithNoExpiry Started:`)
  try {
    // Step 1: Read old data
    const cached = await redisClient.get(key);
    let updatedData = [];

    if (cached) {

      try {
        updatedData = JSON.parse(cached); 

        if (!Array.isArray(updatedData)) {
          console.warn(`⚠️ Redis: Key "${key}" did not contain an array, reinitializing.`);
          updatedData = [];
        } else {
          console.log(`${getLongTime()} 📥 Redis: Existing data fetched for key "${key}":`, updatedData);
        }
      } catch (parseErr) {
        console.error(`${getLongTime()} ❌ Redis: Failed to parse data for key "${key}":`, parseErr);
        return false;
      }
    } else {
      console.log(`${getLongTime()} ℹ️ Redis: No existing data found for key "${key}", starting fresh.`);
    }

    // Step 2: Delete old key
    const deleteResult = await redisClient.del(key);
    console.log(`${getLongTime()} 🧹 Redis: Key "${key}" deleted:`, deleteResult === 1 ? "✅ Redis cleanup after deletion" : "✅  not found after deletion");
    const [ sourceOfTruth ] = 
    // Step 3: Append new value
    console.log(`${getLongTime()} 📦 Redis key: [ ${key} ] New data after append:`, updatedData);

    // Step 4: Set key again with no expiry
    await redisClient.set(key, JSON.stringify(newValue));
    console.log(`${getLongTime()} ✅ Redis: Key ["${key}"] updated with new data.`);

    return true;
  } catch (err) {
        setDataWithNoExpiry(key,newValue);

    const msg =`❌ Redis: Error during update process for key "${key}":, ${err}`
    console.error(msg);
    return false;
  }
};
import { getConnection } from '../config/db.js';

const setRedisDataWithNoExpiry = async(redisKey) =>{


  const sqlQuery = `SELECT * FROM ${redisKey}`;


  try {

    const connection = await mysqlPool.getConnection();

    const [rows] = await connection.execute(sqlQuery, connection);
    await connection.release();


    if(keyExists(redisKey)){

     // removeData(redisKey);

      connection = await getConnection();

      if(!connection){

        return null;
      }

      const [rows] = await connection.execute(sqlQuery);

      // Store in Redis
      await redisClient.set(redisKey, JSON.stringify(rows));

      console.log(`${getLongTime()} [✔] Stored ${rows.length} records under key "${redisKey}"`);
  

    }else{


      const [rows] = await connection.execute(sqlQueryy);

      // Store in Redis
      await redisClient.set(redisKey, JSON.stringify(rows));

      console.log(`${getLongTime()} [✔] Stored ${rows.length} records under key "${redisKey}"`);
  

    }

    // Optional: Stringify before storing
    await redisClient.set(redisKey, JSON.stringify(rows));

    console.log(`${getLongTime()} [✔] Stored ${rows.length} records under key "${redisKey}"`);

  }catch(error){
        console.error('[✖] Error in setDataWithNoExpiry:', error.message);

  }finally{
    
  }

}

// Get data by key
const getData = async (key) => {
  try {
    const data = await redisClient.get(key);
    if (data) {
      console.log(`${getLongTime()} ✅ Redis: Cache hit for key "${key}"`);
      return JSON.parse(data);
      
    } else {
      console.log(`${getLongTime()} 🔍 Redis: Cache miss for key "${key}"`);
      return null;
    }
  } catch (err) {
    console.error(`${getLongTime()} ❌ Redis: Error getting key "${key}":`, err);
    return null;
  }
};

// Delete a key
const removeData = async (key) => {
  try {
    await redisClient.del(key);
    console.log(`${getLongTime()} 🗑️ Redis: Deleted key "${key}"`);
  } catch (err) {
    console.error(`${getLongTime()} ❌ Redis: Error deleting key "${key}":`, err);
  }
};

// Check if a key exists
const keyExists = async (key) => {
  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    console.error(`${getLongTime()} ❌ Redis: Error checking existence for key "${key}":`, err);
    return false;
  }
};

// Set field in a hash
const setHashData = async (hashKey, field, value) => {
  try {
    await redisClient.hSet(hashKey, field, JSON.stringify(value));
    console.log(`${getLongTime()} ✅ Redis: Hash field "${field}" set in "${hashKey}"`);
  } catch (err) {
    console.error(`${getLongTime()} ❌ Redis: Error setting hash field "${field}":`, err);
  }
};

// Get field from a hash
const getHashData = async (hashKey, field) => {
  try {
    const data = await redisClient.hGet(hashKey, field);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`${getLongTime()} ❌ Redis: Error getting hash field "${field}":`, err);
    return null;
  }
};

// Add a member to a set
const addToSet = async (setKey, member) => {
  try {
    await redisClient.sAdd(setKey, member);
    console.log(`${getLongTime()} ✅ Redis: Member "${member}" added to set "${setKey}"`);
  } catch (err) {
    console.error(`${getLongTime()} ❌ Redis: Error adding member "${member}" to set:`, err);
  }
};

// Remove a member from a set
const removeFromSet = async (setKey, member) => {
  try {
    await redisClient.sRem(setKey, member);
    console.log(`${getLongTime()} 🧹 Redis: Member "${member}" removed from set "${setKey}"`);
  } catch (err) {
    console.error(`${getLongTime()} ❌ Redis: Error removing member "${member}" from set:`, err);
  }
};

// Export
export {
  redisClient,
  setData,
  setDataWithNoExpiry,
  updateDataWithNoExpiry,
  getData,
  removeData,
  keyExists,
  setHashData,
  getHashData,
  addToSet,
  removeFromSet,
  setDataWithExpiry,
  setRedisDataWithNoExpiry
};

// Optionally group default
export default {
  redisClient,
  setData,
  setDataWithNoExpiry,
  updateDataWithNoExpiry,
  getData,
  removeData,
  keyExists,
  setHashData,
  getHashData,
  addToSet,
  removeFromSet,
  setDataWithExpiry,
  setRedisDataWithNoExpiry,
  updateDataWithNoExpiry_include_productId
};
