import { createClient } from 'redis';

// Create Redis client instance
const redisClient = createClient({
  url: 'redis://redis-service:6379',
  socket: {
    connectTimeout: 10000, // Optional: wait longer on Redis startup
  },
});

// Connect to Redis
redisClient.connect()
  .then(() => console.log('✅ Redis: Connected successfully'))
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

    console.log(`✅ Redis: Set key "${key}" with expiry ${ttl}s`);
  } catch (err) {
    console.error(`❌ Redis: Error setting data for key "${key}":`, err);
  }
};


// Set data with no expiry (for static or persistent cache)
const setDataWithNoExpiry = async (key, value) => {
  try {
    await redisClient.set(key, JSON.stringify(value));
    console.log(`✅ Redis: Set key "${key}" with no expiry`);
    return true;
  } catch (err) {
    console.error(`❌ Redis: Error setting key "${key}" with no expiry:`, err);
  }
};

const updateDataWithNoExpiry = async (key, newValue) => {
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
          console.log(`📥 Redis: Existing data fetched for key "${key}":`, updatedData);
        }
      } catch (parseErr) {
        console.error(`❌ Redis: Failed to parse data for key "${key}":`, parseErr);
        return false;
      }
    } else {
      console.log(`ℹ️ Redis: No existing data found for key "${key}", starting fresh.`);
    }

    // Step 2: Delete old key
    const deleteResult = await redisClient.del(key);
    console.log(`🧹 Redis: Key "${key}" deleted:`, deleteResult === 1 ? "✅" : "❌ or not found");

    // Step 3: Append new value
    updatedData.push(newValue);
    console.log(`📦 Redis: New data after append:`, updatedData);

    // Step 4: Set key again with no expiry
    await redisClient.set(key, JSON.stringify(updatedData));
    console.log(`✅ Redis: Key "${key}" updated with new data.`);

    return true;
  } catch (err) {
    console.error(`❌ Redis: Error during update process for key "${key}":`, err);
    return false;
  }
};


// Get data by key
const getData = async (key) => {
  try {
    const data = await redisClient.get(key);
    if (data) {
      console.log(`✅ Redis: Cache hit for key "${key}"`);
      return JSON.parse(data);
      
    } else {
      console.log(`🔍 Redis: Cache miss for key "${key}"`);
      return null;
    }
  } catch (err) {
    console.error(`❌ Redis: Error getting key "${key}":`, err);
    return null;
  }
};

// Delete a key
const removeData = async (key) => {
  try {
    await redisClient.del(key);
    console.log(`🗑️ Redis: Deleted key "${key}"`);
  } catch (err) {
    console.error(`❌ Redis: Error deleting key "${key}":`, err);
  }
};

// Check if a key exists
const keyExists = async (key) => {
  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    console.error(`❌ Redis: Error checking existence for key "${key}":`, err);
    return false;
  }
};

// Set field in a hash
const setHashData = async (hashKey, field, value) => {
  try {
    await redisClient.hSet(hashKey, field, JSON.stringify(value));
    console.log(`✅ Redis: Hash field "${field}" set in "${hashKey}"`);
  } catch (err) {
    console.error(`❌ Redis: Error setting hash field "${field}":`, err);
  }
};

// Get field from a hash
const getHashData = async (hashKey, field) => {
  try {
    const data = await redisClient.hGet(hashKey, field);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`❌ Redis: Error getting hash field "${field}":`, err);
    return null;
  }
};

// Add a member to a set
const addToSet = async (setKey, member) => {
  try {
    await redisClient.sAdd(setKey, member);
    console.log(`✅ Redis: Member "${member}" added to set "${setKey}"`);
  } catch (err) {
    console.error(`❌ Redis: Error adding member "${member}" to set:`, err);
  }
};

// Remove a member from a set
const removeFromSet = async (setKey, member) => {
  try {
    await redisClient.sRem(setKey, member);
    console.log(`🧹 Redis: Member "${member}" removed from set "${setKey}"`);
  } catch (err) {
    console.error(`❌ Redis: Error removing member "${member}" from set:`, err);
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
  removeFromSet
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
  removeFromSet
};
