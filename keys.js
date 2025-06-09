// ✅ This is valid for a Node.js server environment (Express, etc.)
module.exports = {
  pgUser: process.env.PGUSER,
  pgHost: process.env.PGHOST,
  pgDatabase: process.env.PGDATABASE,
  pgPassword: process.env.PGPASSWORD,
  pgPort: process.env.PGPORT,

  myUser: process.env.MYSQL_USER,
  myHost: process.env.MYSQL_HOST,
  myDatabase: process.env.MYSQL_DATABASE,
  myPassword: process.env.MYSQL_PASSWORD,
  myPort: process.env.MYSQL_PORT,

  redisUser: process.env.REDIS_USER,
  redisHost: process.env.REDIS_HOST,
  redisPort: process.env.REDIS_PORT,
  redisPassword: process.env.REDIS_PASSWORD,
};
