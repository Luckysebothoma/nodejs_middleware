export const pgUser = process.env.PGUSER;
export const pgHost = process.env.PGHOST;
export const pgDatabase = process.env.PGDATABASE;
export const pgPassword = process.env.PGPASSWORD;
export const pgPort = process.env.PGPORT;
export const myUser = process.env.MYSQL_USER;
export const myHost = process.env.MYSQL_HOST;
export const myDatabase = process.env.MYSQL_DATABASE;
export const myPassword = process.env.MYSQL_PASSWORD;
export const myPort = process.env.MYSQL_PORT;
export const redisUser = process.env.REDIS_USER;
export const redisHost = process.env.REDIS_HOST;
export const redisPort = process.env.REDIS_PORT;
export const redisPassword = process.env.REDIS_PASSWORD;

export const keys = {
  pgUser,
  pgHost,
  pgDatabase,
  pgPassword,
  pgPort,
  myUser,
  myHost,
  myDatabase,
  myPassword,
  myPort,
  redisUser,
  redisHost,
  redisPort,
};

export default keys;