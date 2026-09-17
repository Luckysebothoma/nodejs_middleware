#!/usr/bin/env bash
# patch-mysql-port-and-crash.sh
#
# Fixes:
#  1. config/db.js's MySQL poolConfig never reads MYSQL_PORT from keys.js,
#     so mysql2 silently defaults to port 3306. Your .env sets
#     MYSQL_PORT=3307, so every connection attempt hangs against a port
#     nothing is listening on until it times out (ETIMEDOUT).
#  2. That timeout fires as an unhandled 'error' event on the pool
#     connection, which crashes the whole Node process (cluster worker).
#     Adding mysqlPool.on('error', ...) lets the pool log and recover
#     instead of taking the process down.
#
# This does NOT touch the separate Postgres "token_access_logs does not
# exist" error - that's a missing table in the Postgres auth_token
# database (config/trackToken.js), which needs a CREATE TABLE migration,
# not a code change. Run that separately once you confirm the schema.
#
# Run this from the root of the nodejs_middleware repo.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f config/db.js ]; then
  echo "!! config/db.js not found (run this from the nodejs_middleware repo root)"
  exit 1
fi

echo "==> Backing up config/db.js..."
ts=$(date +%Y%m%d_%H%M%S)
cp config/db.js "config/db.js.pre_mysql_port_patch_${ts}.bak"

echo "==> Patching config/db.js..."
python3 - <<'PYEOF'
path = "config/db.js"
with open(path) as f:
    src = f.read()

old_import = "import { myHost, myUser, myPassword, myDatabase } from '../keys.js';"
new_import = "import { myHost, myUser, myPassword, myDatabase, myPort } from '../keys.js';"

old_pool = """const poolConfig = {
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

const mysqlPool = mysql.createPool(poolConfig);"""

new_pool = """const poolConfig = {
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
  console.error(`\u274c MySQL pool error: ${err.code || err.message}`);
});"""

if old_import not in src or old_pool not in src:
    print("!! Expected patterns not found - config/db.js may already differ from what this targets")
    raise SystemExit(1)

src = src.replace(old_import, new_import)
src = src.replace(old_pool, new_pool)

with open(path, "w") as f:
    f.write(src)
print("   OK: added port + connectTimeout to poolConfig, added pool error handler")
PYEOF

echo "==> Verifying config/db.js is valid JS..."
node --check config/db.js
echo "   OK"

echo ""
echo "==> Done. Backup saved as config/db.js.pre_mysql_port_patch_${ts}.bak"
echo ""
echo "Still open (needs a manual decision, not scripted):"
echo "  - Postgres 'relation \"token_access_logs\" does not exist': config/trackToken.js"
echo "    inserts into that table on every request/response, but it was never created"
echo "    in the 'auth_token' Postgres database. Needs a CREATE TABLE migration -"
echo "    confirm the columns you want (token_hash, user_id, request_path, ip_address"
echo "    at minimum, based on the INSERT statement) before I script that."
echo ""
echo "Next: rebuild and restart sweety-api:"
echo "    docker-compose build sweety-api && docker-compose up -d --force-recreate sweety-api"
