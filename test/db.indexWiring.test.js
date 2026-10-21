// Guards the wiring in index.js (it cannot be booted in tests: it needs TLS certs, MySQL, Redis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const src = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('index.js imports the migration hook', () => {
  assert.match(src, /import startupMigrations from "\.\/db\/startupMigrations\.js";/);
});

test('workers are forked only AFTER the migration settles (primary process only)', () => {
  const primary = src.slice(src.indexOf('if (cluster.isPrimary) {'), src.indexOf('} else {', src.indexOf('if (cluster.isPrimary) {')));
  const iMig = primary.indexOf('startupMigrations()');
  const iFinally = primary.indexOf('.finally(');
  const iFork = primary.indexOf('cluster.fork()');
  assert.ok(iMig > -1 && iFinally > iMig && iFork > iFinally, 'fork must be inside .finally() of startupMigrations()');
  assert.equal((primary.match(/cluster\.fork\(\)/g) || []).length, 2, 'initial forks + the restart-on-exit fork only');
  assert.ok(primary.indexOf('cluster.on("exit"') > -1, 'worker restart handler kept');
});

test('the worker branch does not run migrations', () => {
  const worker = src.slice(src.indexOf('} else {', src.indexOf('if (cluster.isPrimary) {')), src.indexOf('// 🛡️ Optional: error handling middleware'));
  assert.ok(!worker.includes('startupMigrations'));
});
