const mysql = require('mysql2/promise');
const keys = require('../keys');
const { key } = require('../external-redis-api/config');
const getShortTime = require('../utils/Time')

console.log({
  host: keys.myHost,
  user: keys.myUser,
  password: keys.myPassword,
  database: keys.myDatabase
});


const mysqlPool = mysql.createPool({
  host: keys.myHost.trim(),
  user: keys.myUser.trim(),
  password: keys.myPassword.trim(),
  database: keys.myDatabase.trim(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
if(mysqlPool){
  console.log("Successfully connected to mySQL Database")
}else {
    console.log(`Failed to connect to ${keys.myHost.trim()}`)
}

module.exports = mysqlPool;
