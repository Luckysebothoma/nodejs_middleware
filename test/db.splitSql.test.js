import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { splitSqlStatements } from '../db/splitSql.js';

test('splits plain statements and drops comment-only chunks', () => {
  const out = splitSqlStatements(`-- header; with semicolon\nCREATE TABLE a (id INT);\n\n-- note\nINSERT INTO a VALUES (1);\n`);
  assert.deepEqual(out, ['CREATE TABLE a (id INT)', 'INSERT INTO a VALUES (1)']);
});

test('keeps multi-line statements together', () => {
  const out = splitSqlStatements('CREATE TABLE a (\n  id INT,\n  name TEXT\n);\n');
  assert.equal(out.length, 1);
  assert.match(out[0], /name TEXT/);
});

test('understands DELIMITER blocks: trigger bodies with inner semicolons stay one statement', () => {
  const sql = `DELIMITER //\nDROP TRIGGER IF EXISTS t//\nCREATE TRIGGER t BEFORE INSERT ON a FOR EACH ROW\nBEGIN\n  SET NEW.x = 1;\n  SET NEW.y = 2;\nEND//\nDELIMITER ;\nSELECT 1;\n`;
  const out = splitSqlStatements(sql);
  assert.equal(out.length, 3);
  assert.equal(out[0], 'DROP TRIGGER IF EXISTS t');
  assert.match(out[1], /SET NEW\.x = 1;\n\s+SET NEW\.y = 2;\nEND$/);
  assert.equal(out[2], 'SELECT 1');
});

test('the real MySQL migrations split into the expected statement counts', async () => {
  const s1 = splitSqlStatements(await readFile(new URL('../db/migrations/mysql/001_core_schema.sql', import.meta.url), 'utf8'));
  const s2 = splitSqlStatements(await readFile(new URL('../db/migrations/mysql/002_automation.sql', import.meta.url), 'utf8'));
  assert.equal(s1.filter(s => /^CREATE TABLE/i.test(s)).length, 12);
  assert.equal(s1.filter(s => /^CREATE OR REPLACE VIEW/i.test(s)).length, 3);
  assert.equal(s2.filter(s => /^CREATE TRIGGER/i.test(s)).length, 10);
  assert.equal(s2.filter(s => /^CREATE PROCEDURE/i.test(s)).length, 1);
  assert.ok(s1.concat(s2).every(s => !s.includes('DELIMITER')), 'no DELIMITER leaks into statements');
});
