const { createClient } = require('redis');

// Create a Redis client instance
const redisClient = createClient({
    url: 'redis://redis-service:6379',
    socket: {
        connectTimeout: 10000 // Optional: Increase timeout in case of slow Redis startup
    }
});

/*
// Using async/await to handle connection
(async () => {
    try {
        await redisClient.connect();
        console.log('Redis: Connected to Redis');
    } catch (err) {
        console.error('Redis: Redis connection error:', err);
    }
})();

*/
// Set a key with a value
const setDataWithNoExpiry = async (key, value, expiry = 3600) => {
    try {
        await redisClient.set(key, expiry,JSON.stringify(value)); // Store value as JSON
        console.log(`Redis: Data set successfully for key: ${key}`);
    } catch (err) {
        console.error('Redis: Error setting data:', err);
    }
};

// Get data for a key
const getData = async (key) => {
    try {
        
        
        const data = await redisClient.get(key); // Get the value (as string)
        if(!data){
            console.log("Cached found:" + key);
        }else{
            console.error("Redi Hit Missed: " + key)
        }
        return data ? JSON.parse(data) : null; // Parse if it's a JSON object

    } catch (err) {
        console.error('Redis: Error getting data:' + key, err);
    }
};

// Update or set data with an expiration time (in seconds)
const setData = async (key, value, expiry = 3600) => {
    try {
        await redisClient.set(key, expiry, JSON.stringify(value)); // Set with expiry
        console.log(`Data updated and set to expire in ${expiry} seconds for key: ${key}`);
    } catch (err) {
        console.error('Redis: Error setting data with expiry:' + key, err);
    }
};

// Remove a key from Redis
const removeData = async (key) => {
    try {
        await redisClient.del(key);
        console.log(`Key ${key} deleted from Redis.`);
    } catch (err) {
        console.error('Redis: Error deleting data:' + key, err);
    }
};

// Check if a key exists
const keyExists = async (key) => {
    try {
        const exists = await redisClient.exists(key);
        return exists === 1; // 1 means the key exists, 0 means it doesn't
    } catch (err) {
        console.error('Redis: Error checking if key exists:' + key, err);
    }
};

// Set a field in a hash
const setHashData = async (hashKey, field, value) => {
    try {
        await redisClient.hset(hashKey, field, JSON.stringify(value));
        console.log(`Field ${field} set in hash ${hashKey}`);
    } catch (err) {
        console.error('Redis: Error setting hash data:' + hashKey, err);
    }
};

// Get a field from a hash
const getHashData = async (hashKey, field) => {
    try {
        const data = await redisClient.hget(hashKey, field);
        return data ? JSON.parse(data) : null;
    } catch (err) {
        console.error('Redis: Error getting hash data:', err);
    }
};

// Add member to a set
const addToSet = async (setKey, member) => {
    try {
        await redisClient.sadd(setKey, member);
        console.log(`Member ${member} added to set ${setKey}`);
    } catch (err) {
        console.error('Redis: Error adding to set:', err);
    }
};

// Remove member from a set
const removeFromSet = async (setKey, member) => {
    try {
        await redisClient.srem(setKey, member);
        console.log(`Member ${member} removed from set ${setKey}`);
    } catch (err) {
        console.error('Redis: Error removing from set:', err);
    }
};


module.exports = { redisClient,removeData, setData, getData, keyExists };
