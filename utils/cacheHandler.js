import { get, setex } from '../config/redisClient';
import { query } from '../config/postgres';
import { query as _query } from '../config/db';

const TTL_SECONDS = 300; // 5 minutes

async function getCachedOrQuery_removedREdis(key, pgQuery, mysqlQuery, params = []) {

  try {
    const cached = await get(key);
    if (cached) {
      console.log(`🔁 Redis HIT: ${key}`);
      return JSON.parse(cached);
    }

    console.log(`🚫 Redis MISS: ${key}`);
    let result = null;

    try {
      const res = await query(pgQuery, params);

      if (res.rows.length) result = res.rows;
      
    } catch (err) {
      console.error('❌ Postgres error:', err.message);
    }

    if (!result) {
      try {
        const [rows] = await _query(mysqlQuery, params);
        if (rows.length) result = rows;
      } catch (err) {
        console.error('❌ MySQL error:', err.message);
      }
    }

    if (result) {
      await setex(key, TTL_SECONDS, JSON.stringify(result));
    }

    return result || null;
  } catch (err) {
    console.error('🔥 Cache handler error:', err);
    return null;
  }
}

async function getCachedOrQuery(key, pgQuery, mysqlQuery, params = []) {

  try {
 
    let result = null;

    try {
      const res = await query(pgQuery, params);

      if (res.rows.length) result = res.rows;
      
    } catch (err) {
      console.error('❌ Postgres error:', err.message);
    }

    if (!result) {
      try {
        const [rows] = await _query(mysqlQuery, params);
        if (rows.length) result = rows;
      } catch (err) {
        console.error('❌ MySQL error:', err.message);
      }
    } 

    return result || null;
  } catch (err) {
    console.error('🔥 Cache handler error:', err);
    return null;
  }
}

export default {
  getCachedOrQuery,
};
