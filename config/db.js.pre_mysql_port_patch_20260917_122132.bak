import { myHost, myUser, myPassword, myDatabase } from '../keys.js';
import TimeUtils from '../utils/Time.js';
const { formattedDate, getShortTime, getMidTime, getLongTime } = TimeUtils;
import mysql from 'mysql2/promise';



// These should be defined in your environment or securely passed
//const myHost = process.env.MYSQL_HOST || 'localhost';/
//const myUser = process.env.MYSQL_USER || 'root';
//const myPassword = process.env.MYSQL_PASSWORD || '';
//const myDatabase = process.env.MYSQL_DATABASE || 'myapp';

const poolConfig = {
  host: myHost.trim(),
  user: myUser.trim(),
  password: myPassword.trim(),
  database: myDatabase.trim(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+02:00', // SAST — South Africa Standard Time
  supportBigNumbers: true,
  bigNumberStrings: true
};

const mysqlPool = mysql.createPool(poolConfig);

// Optional: Centralized getConnection for logging/debugging
const getConnection = async () => {
  const connection = await mysqlPool.getConnection();
  console.log(`[${getShortTime()}] 🔌 MySQL connection acquired from pool`);
  return connection;
};

export { mysqlPool, getConnection };
