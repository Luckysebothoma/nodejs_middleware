import createClient from 'ioredis';
import { redisHost, redisPort } from "../keys.js";

const redisClient = new createClient({
  host: redisHost,
  port: redisPort,
});


redisClient.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) await redisClient.connect();
    console.log('✅ Redis connected');
    return true;
  } catch (err) {
    console.error('Redis connection error:', err.message);
    return false;
  }
};

const apiResponse = (success, message, data) => ({ success, message, data });

const cacheSet = async (key, value, ttlSeconds = 300) => {
  try {
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    return apiResponse(true, 'Cached successfully', null);
  } catch (err) {
    return apiResponse(false, 'Cache set failed: ' + err.message, null);
  }
};

export const cacheExists = async (key) => {
  try {
    const result = await redisClient.exists(key); // returns 1 or 0
    return {
      success: true,
      message: result === 1 ? 'Key exists' : 'Key does not exist',
      data: result === 1,
    };
  } catch (err) {
    return {
      success: false,
      message: 'EXISTS check failed: ' + err.message,
      data: false,
    };
  }
};


const cacheGet = async (key) => {
  try {
    const raw = await redisClient.get(key);
    if (!raw) return apiResponse(false, 'Cache miss', null);
    return apiResponse(true, 'Cache hit', JSON.parse(raw));
  } catch (err) {
    return apiResponse(false, 'Cache get failed: ' + err.message, null);
  }
};

const cacheDelete = async (key) => {
  try {
    const result = await redisClient.del(key);
    return apiResponse(true, result > 0 ? 'Key deleted' : 'Key not found', null);
  } catch (err) {
    return apiResponse(false, 'Cache delete failed: ' + err.message, null);
  }
};

//module.exports = { connectRedis, cacheSet, cacheGet, cacheDelete };

export default {connectRedis, cacheSet, cacheGet, cacheDelete, cacheExists}
