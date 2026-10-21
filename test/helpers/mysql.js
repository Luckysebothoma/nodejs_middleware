// Scratch-database MySQL helper. Requires TEST_MYSQL_URL = mysql://user:pw@host:port (NO database name).
// It mimics the API's real pool options (bigNumberStrings etc.) so type surprises show up in tests.
import mysql from 'mysql2/promise';
import { randomBytes } from 'node:crypto';

export const TEST_MYSQL_URL = process.env.TEST_MYSQL_URL || '';

export function mysqlOptions(database) {
  const u = new URL(TEST_MYSQL_URL);
  return {
    host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
    database, supportBigNumbers: true, bigNumberStrings: true, timezone: '+02:00'
  };
}

export async function makeScratchMysql() {
  const admin = await mysql.createConnection(mysqlOptions(undefined));
  const db = `sweety_t_${randomBytes(4).toString('hex')}`;
  await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4`);
  const pool = mysql.createPool({ ...mysqlOptions(db), connectionLimit: 8 });
  return { pool, db, async drop() { await pool.end(); await admin.query(`DROP DATABASE \`${db}\``); await admin.end(); } };
}
