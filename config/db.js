import { myHost, myUser, myPassword, myDatabase, myPort } from '../keys.js';
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
  port: parseInt(myPort.trim(), 10),
  user: myUser.trim(),
  password: myPassword.trim(),
  database: myDatabase.trim(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
  timezone: '+02:00', // SAST — South Africa Standard Time
  supportBigNumbers: true,
  bigNumberStrings: true
};

const mysqlPool = mysql.createPool(poolConfig);

// Without this listener, a connection-level error (e.g. a timeout) is an
// unhandled 'error' event and crashes the whole Node process. Logging it
// here lets the pool recover and keeps serving other requests instead.
mysqlPool.on('error', (err) => {
  console.error(`❌ MySQL pool error: ${err.code || err.message}`);
});

// Optional: Centralized getConnection for logging/debugging
const getConnection = async () => {
  const connection = await mysqlPool.getConnection();
  console.log(`[${getShortTime()}] 🔌 MySQL connection acquired from pool`);
  return connection;
};

export { mysqlPool, getConnection };
