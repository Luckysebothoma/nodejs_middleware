// Child process used by the concurrency test: runs the real startup migration code against the DB
// named in the environment and prints the result as one JSON line.
import pg from 'pg';
import mysql from 'mysql2/promise';
import { runEngine } from '../../db/startupMigrations.js';

const quiet = { log() {}, warn() {}, error() {} };
const engine = process.env.ENGINE;
let pool;
if (engine === 'postgres') {
  pool = new pg.Pool({ connectionString: process.env.TEST_PG_URL, max: 2, options: `-c search_path=${process.env.PG_SCHEMA}` });
} else {
  const u = new URL(process.env.TEST_MYSQL_URL);
  pool = mysql.createPool({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password), database: process.env.MYSQL_DB, supportBigNumbers: true, bigNumberStrings: true, connectionLimit: 2 });
}
const r = await runEngine(engine, pool, quiet);
console.log(JSON.stringify({ applied: r.migration?.applied ?? null, skipped: r.migration?.skipped ?? null,
  failed: r.migration?.failed ?? null, error: r.error, verifyOk: r.verify?.ok ?? null }));
await (engine === 'postgres' ? pool.end() : pool.end());
