import { createClient } from 'redis';
import { redisHost, redisPort } from "../keys.js";
import TimeUtils from '../utils/Time.js';
const { getLongTime } = TimeUtils;

const TTL_SECONDS = 86400; // 24 hours

// ─────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────
const redisClient = createClient({
  socket: {
    host: redisHost,
    port: redisPort,
    // Keep retrying forever, backing off up to 3s between attempts
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
  // password: process.env.REDIS_PASSWORD,
});

redisClient.on('error', (err) => console.error('❌ Redis error:', err.message));
redisClient.on('ready', () => console.log('✅ Redis ready'));
redisClient.on('reconnecting', () => console.warn('⚠️ Redis reconnecting...'));

// ─────────────────────────────────────────────────────────────
// Connection handling
// ─────────────────────────────────────────────────────────────
let connectPromise = null;

/**
 * Idempotent and safe to call concurrently. Every cache operation goes
 * through this (via withRedis), so it no longer matters which one runs first.
 */
const connectRedis = async () => {
  if (redisClient.isReady) return true;

  // If the client is already open it is mid-connect or mid-reconnect;
  // node-redis handles that itself, so we must not call connect() again.
  if (redisClient.isOpen) return true;

  try {
    if (!connectPromise) {
      connectPromise = redisClient.connect().finally(() => {
        connectPromise = null;
      });
    }
    await connectPromise;
    return true;
  } catch (err) {
    console.error('❌ Redis connection error:', err.message);
    return false;
  }
};

const apiResponse = (success, message, data) => ({ success, message, data });

/**
 * Wraps every Redis operation with the same connect + error handling.
 * Never throws; always resolves to { success, message, data }.
 */
const withRedis = async (label, fn, failValue = null) => {
  if (!(await connectRedis())) {
    return apiResponse(false, `❌ ${label} failed: Redis unavailable`, failValue);
  }
  try {
    return await fn();
  } catch (err) {
    return apiResponse(false, `❌ ${label} failed: ${err.message}`, failValue);
  }
};

// ─────────────────────────────────────────────────────────────
// Core operations
// ─────────────────────────────────────────────────────────────
const cacheSet = (key, value, ttlSeconds = TTL_SECONDS) =>
  withRedis('Cache set', async () => {
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    return apiResponse(true, 'Cached successfully', null);
  });

const cacheGet = (key) =>
  withRedis('Cache get', async () => {
    const raw = await redisClient.get(key);
    if (raw === null) return apiResponse(false, 'Cache miss', null);
    return apiResponse(true, 'Cache hit', JSON.parse(raw));
  });

const cacheDelete = (key) =>
  withRedis('Cache delete', async () => {
    const count = await redisClient.del(key);
    return apiResponse(true, count > 0 ? 'Key deleted' : 'Key not found', null);
  });

export const cacheExists = (key) =>
  withRedis('EXISTS check', async () => {
    const count = await redisClient.exists(key); // 1 or 0
    return apiResponse(true, count === 1 ? 'Key exists' : 'Key does not exist', count === 1);
  }, false);

// DEL on a missing key is a harmless no-op, so no exists() check is needed.
const refreshKey = (key) => cacheDelete(key);

// ─────────────────────────────────────────────────────────────
// Caller-friendly helpers
// ─────────────────────────────────────────────────────────────

// cacheGet returns an envelope { success, message, data } (NOT { value }).
// success:false means either a genuine miss or that Redis itself failed;
// both are a miss from the caller's point of view, so fall through to the DB.
const tryGetFromCache = async (key) => {
  try {
    const cached = await cacheGet(key);
    if (!cached?.success) return null;

    const value = cached.data;
    if (value === undefined || value === null) return null;
    return value;
  } catch (err) {
    console.warn(`${getLongTime()}⚠️ Cache read failed for key [${key}]:`, err.message);
    return null;
  }
};

// Empty arrays are never cached (no negative caching), so the next read
// always re-checks the database instead of trusting a cached "not found".
const safeCacheSet = async (key, value) => {
  if (Array.isArray(value) && value.length === 0) {
    console.log(`${getLongTime()}⏭️  Skipping cache write for key [${key}] — empty result, not cached`);
    return;
  }
  const result = await cacheSet(key, value, TTL_SECONDS);
  if (!result.success) {
    console.warn(`${getLongTime()}⚠️ Cache write failed for key [${key}]:`, result.message);
  }
};

// Primary write-side sync mechanism: delete the key so the next read
// repopulates it from the database.
const safeInvalidateKey = async (key) => {
  const result = await cacheDelete(key);
  if (!result.success) {
    console.warn(`${getLongTime()}⚠️ Cache invalidation failed for key [${key}]:`, result.message);
  }
};

export default {
  connectRedis,
  cacheSet,
  cacheGet,
  cacheDelete,
  cacheExists,
  refreshKey,
  safeInvalidateKey,
  safeCacheSet,
  tryGetFromCache,
};