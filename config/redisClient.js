import { createClient } from 'redis'; // Note: 'ioredis' has different API; if you use 'redis' npm, this is correct
import { redisHost, redisPort } from "../keys.js";

const redisClient = new createClient({
  socket: {
  host: redisHost,
      port: redisPort,
  },
//  password: 'system123',  // Add your Redis password here
});


export const testRedis = async (timeoutMs = 3000) => {
  const client = new createClient({
  socket: {
  host: redisHost,
      port: redisPort,
  },
//  password: 'system123',  // Add your Redis password here
});


  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Redis connection timeout')), timeoutMs)
  );

  try {
    client.on('error', (err) => {
      console.error('❌ Redis client error:', err.message);
    });

    await Promise.race([
      client.connect(),
      timeout
    ]);

    const pong = await client.ping();

    if (pong !== 'PONG') {
      throw new Error(`Unexpected Redis response: ${pong}`);
    }

    console.log('✅ Redis pre-test successful (PING → PONG)');

    return {
      ok: true,
      message: 'Redis connection healthy'
    };

  } catch (err) {
    console.error('❌ Redis pre-test failed:', err.message);

    return {
      ok: false,
      error: err.message
    };

  } finally {
    if (client.isOpen) {
      await client.quit();
    }
  }
};





const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) await redisClient.connect();
    console.log('✅ Redis connected');
    return true;
  } catch (err) {
    console.error('❌ Redis connection error:', err.message);
    return false;
  }
};

const apiResponse = (success, message, data) => ({ success, message, data });

const cacheSet = async (key, value, ttlSeconds = 300) => {

  if(!connectRedis()){


        console.error('❌ Redis connection error:', err.message);

  }
    console.log('✅ Redis connected');

  try {
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    return apiResponse(true, 'Cached successfully', null);

  } catch (err) {
    return apiResponse(false, '❌ Cache set failed: ' + err.message, null);
  }
};

const refreshKey = async (key) => {

  if((await cacheExists(key)).success){
    cacheDelete(key);
  }
  

}
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
      message: '❌ EXISTS check failed: ' + err.message,
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
    return apiResponse(false, '❌ Cache get failed: ' + err.message, null);
  }
};

const cacheDelete = async (key) => {
  try {
    const result = await redisClient.del(key);
    return apiResponse(true, result > 0 ? 'Key deleted' : 'Key not found', null);
  } catch (err) {
    return apiResponse(false, '❌ Cache delete failed: ' + err.message, null);
  }
};

await testRedis();

//module.exports = { connectRedis, cacheSet, cacheGet, cacheDelete };

export default {connectRedis, cacheSet, cacheGet, cacheDelete, cacheExists, refreshKey,testRedis}
