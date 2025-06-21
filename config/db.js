import { createPool } from 'mysql2/promise';
import { myHost, myUser, myPassword, myDatabase } from '../keys.js';
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
 
const poolConfig = {
  host: myHost.trim(),
  user: myUser.trim(),
  password: myPassword.trim(),
  database: myDatabase.trim(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

console.log('[DB CONFIG]', poolConfig);

const mysqlPool = createPool(poolConfig);

// Optional: check if connection is successful
try {
  const connection = await mysqlPool.getConnection();
  console.log(`[${getShortTime()}] ✅ Successfully connected to MySQL Database`);
  connection.release();
} catch (error) {
  console.error(`[${getShortTime()}] ❌ Failed to connect to ${myHost.trim()}`, error);
}

export default mysqlPool;
