import { createClient } from 'redis'; // Note: 'ioredis' has different API; if you use 'redis' npm, this is correct
import { redisHost, redisPort } from "../keys.js";
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime } = TimeUtils;


const redisClient = new createClient({
  socket: {
  host: redisHost,
      port: redisPort,
  },
//  password: 'system123',  // Add your Redis password here
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
    console.error('❌ Redis connection error:', err.message);
    return false;
  }
};

const apiResponse = (success, message, data) => ({ success, message, data });

const cacheSet = async (key, value, ttlSeconds = 300) => {

  const isConnected = await connectRedis();
  if (!isConnected) {
    console.error('❌ Redis connection error: could not (re)connect before cacheSet');
  }

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

//module.exports = { connectRedis, cacheSet, cacheGet, cacheDelete };
// NOTE: ../config/redisClient.js's cacheGet returns an apiResponse envelope
// shaped { success, message, data } (NOT { value }). `success: false` means
// either a genuine cache miss OR that the Redis call itself failed — either
// way that's a miss from this caller's point of view. Only `data` (already
// JSON.parsed by cacheGet) is the actual cached value. Getting this shape
// wrong previously meant every lookup — hit or miss — returned a truthy
// wrapper object and was treated as a hit, so reads never fell through to
// Postgres/MySQL at all.
const tryGetFromCache = async (key) => {
  try {
    const cached = await cacheGet(key);
    if (!cached || !cached.success) return null; // miss, or the Redis call itself failed

    const raw = cached.data;
    if (raw === undefined || raw === null) return null;

    // Defensive fallback only — cacheGet already JSON.parses, so `raw` should
    // already be the real value, not a JSON string. Kept in case the
    // underlying client implementation ever changes shape.
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }

    return raw;
  } catch (err) {
    console.warn(`${getLongTime()}⚠️ Cache read failed for key [${key}]:`, err.message);
    return null;
  }
};

// Cache-set that automatically shortens the TTL for empty results, so a
// false negative can't camp out in Redis for TTL_SECONDS.
// cacheSet/cacheDelete also return { success, message, data } and do NOT
// throw on Redis failures (they catch internally) — so a plain try/catch
// here would never notice a failed write. Check `.success` explicitly.
// 📌 TTL for cache entries (seconds) — real, non-empty results

// NEGATIVE_CACHE_TTL_SECONDS removed — empty results are no longer cached at all.

// Cache-set that skips writing to Redis entirely when the value is an empty
// result. There is deliberately no "negative cache" tier anymore: an empty
// `[]` from Postgres/MySQL just isn't written to Redis, so the next read
// always re-checks the database rather than trusting a cached "not found".
const safeCacheSet = async (key, value) => {
  const isEmpty = Array.isArray(value) && value.length === 0;
  if (isEmpty) {
    console.log(`${getLongTime()}⏭️  Skipping cache write for key [${key}] — empty result, not cached`);
    return;
  }
  try {
    const result = await cacheSet(key, value, TTL_SECONDS);
    if (!result?.success) {
      console.warn(`${getLongTime()}⚠️ Cache write failed for key [${key}]:`, result?.message);
    }
  } catch (err) {
    console.warn(`${getLongTime()}⚠️ Cache write failed for key [${key}]:`, err.message);
  }
};

// Invalidate (delete) a cache key. This is now the primary write-side sync
// mechanism — see the "CHANGES" note at the top of this file for why this
// replaced a plain TTL refresh.
const safeInvalidateKey = async (key) => {
  try {
    const result = await cacheDelete(key);
    if (!result?.success) {
      console.warn(`${getLongTime()}⚠️ Cache invalidation failed for key [${key}]:`, result?.message);
    }
  } catch (err) {
    console.warn(`${getLongTime()}⚠️ Cache invalidation failed for key [${key}]:`, err.message);
  }
};

// Sync a row set found in MySQL back into Postgres, in the background.
// `pgBackfillQuery` is caller-supplied because only the caller knows the
// target table/columns/conflict key: either a static { text, values } spec,
// or a function (rows) => { text, values } built from what MySQL returned.


export default {connectRedis, cacheSet, cacheGet, cacheDelete, cacheExists, refreshKey, safeInvalidateKey, safeCacheSet, tryGetFromCache};
