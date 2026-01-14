export const deleteRedisAndMySQL = async (productId, redisClient, redisKey, mysqlTable) => {
  const query = `DELETE FROM \`${mysqlTable}\` WHERE productId = ?`;
  const values = [productId];

  let conn;

  try {
    conn = await mysqlPool.getConnection();
    const [mysqlResult] = await conn.query(query, values);

    if (mysqlResult.affectedRows > 0) {
      const redisDelResult = await redisClient.del(redisKey);
      console.log(`🗑️ MySQL + Redis delete complete. Redis deleted: ${redisDelResult > 0}`);
    } else {
      console.warn(`⚠️ No record found in MySQL table "${mysqlTable}" for productId: ${productId}`);
    }

    return { success: true, message: 'Delete operation completed' };

  } catch (err) {
    console.error(`🔥 Error during deleteRedisAndMySQL: ${err.message}`);
    return { success: false, message: err.message };

  } finally {
    if (conn) conn.release();
    // Do NOT call redisClient.release() unless it's a pooled client (like ioredis cluster)
    // If redisClient is a regular Redis instance, just leave it open (or close it when app shuts down)
  }
};
