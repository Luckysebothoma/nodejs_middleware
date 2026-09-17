#!/usr/bin/env bash
# patch-cache-crud-sync.sh
#
# Fixes two bugs that break the Redis -> Postgres -> MySQL read/write cycle:
#
#  1. controller/productController.js calls getCachedOrQuery/addCachedAndQuery/
#     updateCachedOrQuery/removeCachedAndQuery using the OLD positional-args
#     signature (key, sqlString, params), but utils/ControllerHandler.js was
#     refactored to expect (key, { pgQuery, mysqlQuery }). Right now every
#     write (add/update/delete) and the getProductList read throw
#     "No MySQL fallback query provided" as soon as this container is rebuilt
#     with current source - it only "works" today because the running
#     container predates this refactor.
#
#  2. utils/ControllerHandler.js's MySQL write branches (insert/update/delete)
#     do `const result = await connection.query(...)` without destructuring.
#     mysql2 returns [ResultSetHeader, fields] for writes, so `result` is the
#     whole array and `result.affectedRows` is always undefined - meaning a
#     write that touches zero rows is reported back as a success.
#
# Also fixes: config/redisClient.js's cacheSet checks `if (!connectRedis())`,
# which tests the truthiness of a Promise (always true) instead of awaiting
# it, so a dropped Redis connection never triggers a reconnect attempt.
#
# Run this from the root of the nodejs_middleware repo.
set -euo pipefail
cd "$(dirname "$0")"

for f in controller/productController.js utils/ControllerHandler.js config/redisClient.js; do
  if [ ! -f "$f" ]; then
    echo "!! Expected file not found: $f (run this from the nodejs_middleware repo root)"
    exit 1
  fi
done

echo "==> Backing up files before patching..."
ts=$(date +%Y%m%d_%H%M%S)
for f in controller/productController.js utils/ControllerHandler.js config/redisClient.js; do
  cp "$f" "${f}.pre_cache_patch_${ts}.bak"
done

echo "==> Patching controller/productController.js call sites..."
python3 - <<'PYEOF'
path = "controller/productController.js"
with open(path) as f:
    src = f.read()

replacements = [
    (
        "const data = await getCachedOrQuery(cacheKey, _mysqlQuery, _pgQuery);",
        "const data = await getCachedOrQuery(cacheKey, {\n      mysqlQuery: { text: _mysqlQuery },\n      pgQuery: { text: _pgQuery },\n    });"
    ),
    (
        "const result = await updateCachedOrQuery(cacheKey, query, replacements);",
        "const result = await updateCachedOrQuery(cacheKey, {\n      mysqlQuery: { text: query, values: replacements },\n    });"
    ),
    (
        "const result = await removeCachedAndQuery(cacheKey, mysqlQuery, replacements);",
        "const result = await removeCachedAndQuery(cacheKey, {\n        mysqlQuery: { text: mysqlQuery, values: replacements },\n    });"
    ),
    (
        "const dbres = await addCachedAndQuery(cacheKey,  query , replacements, connection);",
        "const dbres = await addCachedAndQuery(cacheKey, {\n          mysqlQuery: { text: query, values: replacements },\n        });"
    ),
]

missing = []
for old, new in replacements:
    if old not in src:
        missing.append(old)
    else:
        src = src.replace(old, new)

if missing:
    print("!! Some expected lines were not found (file may already differ from what this script targets):")
    for m in missing:
        print("   -", m)
    raise SystemExit(1)

with open(path, "w") as f:
    f.write(src)
print("   OK: 4 call sites updated to the { pgQuery, mysqlQuery } shape")
PYEOF

echo "==> Patching utils/ControllerHandler.js (missing array-destructure on MySQL writes)..."
python3 - <<'PYEOF'
path = "utils/ControllerHandler.js"
with open(path) as f:
    src = f.read()

old = "    const result = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values ?? []);"
new = "    const [result] = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values ?? []);"

count = src.count(old)
if count == 0:
    print("!! Expected pattern not found in ControllerHandler.js - skipping")
    raise SystemExit(1)

src = src.replace(old, new)
with open(path, "w") as f:
    f.write(src)
print(f"   OK: fixed {count} MySQL write branch(es) (insert/update/delete)")
PYEOF

echo "==> Patching config/redisClient.js (async connectRedis check in cacheSet)..."
python3 - <<'PYEOF'
path = "config/redisClient.js"
with open(path) as f:
    src = f.read()

old = """  if(!connectRedis()){


        console.error('\u274c Redis connection error:', err.message);

  }
    console.log('\u2705 Redis connected');
"""
new = """  const isConnected = await connectRedis();
  if (!isConnected) {
    console.error('\u274c Redis connection error: could not (re)connect before cacheSet');
  }
"""

if old not in src:
    print("!! Expected pattern not found in redisClient.js - skipping this fix")
else:
    src = src.replace(old, new)
    with open(path, "w") as f:
        f.write(src)
    print("   OK: cacheSet now awaits connectRedis() before checking it")
PYEOF

echo "==> Verifying patched files are valid JS..."
for f in controller/productController.js utils/ControllerHandler.js config/redisClient.js; do
  node --check "$f"
  echo "   OK: $f"
done

echo ""
echo "==> Done. Backups saved as *.pre_cache_patch_${ts}.bak"
echo ""
echo "Still open (not auto-fixed, needs a decision):"
echo "  - Postgres tier is a no-op: ControllerHandler.js imports ../config/pgClient.js"
echo "    (getPgConnection()) which does not exist. config/postgres.js exists instead,"
echo "    wired to a different 'auth_token' database. Until pgClient.js exists for the"
echo "    product tables, every read/write silently skips Postgres and goes straight"
echo "    to MySQL."
echo "  - utils/redisMysqlDeleteHandler.js references an undefined 'mysqlPool' - dead"
echo "    code (nothing imports it), but will throw if anyone wires it up as-is."
echo ""
echo "Next: rebuild and restart sweety-api so this container picks up the fix:"
echo "    docker-compose build sweety-api && docker-compose up -d --force-recreate sweety-api"
