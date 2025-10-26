const redis = require('../config/redisClient');
const pg = require('../config/postgres');
const mysql = require('../config/db');

const TTL_SECONDS = 300; // 5 minutes

async function getCachedOrQuery(key, pgQuery, mysqlQuery, params = []) {

  try {
    const cached = await redis.get(key);
    if (cached) {
      console.log(`🔁 Redis HIT: ${key}`);
      return JSON.parse(cached);
    }

    console.log(`🚫 Redis MISS: ${key}`);
    let result = null;

    try {
      const res = await pg.query(pgQuery, params);

      if (res.rows.length) result = res.rows;
      
    } catch (err) {
      console.error('❌ Postgres error:', err.message);
    }

    if (!result) {
      try {
        const [rows] = await mysql.query(mysqlQuery, params);
        if (rows.length) result = rows;
      } catch (err) {
        console.error('❌ MySQL error:', err.message);
      }
    }

    if (result) {
      await redis.setex(key, TTL_SECONDS, JSON.stringify(result));
    }

    return result || null;
  } catch (err) {
    console.error('🔥 Cache handler error:', err);
    return null;
  }
}

module.exports = {
  getCachedOrQuery,
};
