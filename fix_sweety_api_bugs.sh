#!/usr/bin/env bash
#
# fix_sweety_api_bugs.sh
#
# Pure shell/python fix — no git required (git workflow handled separately).
#
# Fixes the three bugs visible in the sweety-api container logs:
#
#   1. relation "token_tracking" does not exist        (Postgres)
#   2. relation "token_access_logs" does not exist      (Postgres)
#   3. ReferenceError: cacheKey is not defined          (bulkTransactionController.js:525)
#      + the underlying cause: addCachedAndQuery() was being called with the
#        old (key, query, replacements, connection) signature instead of the
#        current (key, { mysqlQuery: { text, values } }) signature, which is
#        why every addNewCandy sub-insert logged:
#        "Missing or invalid input(s): { key: 'productList', pgQuery: undefined, mysqlQuery: undefined }"
#
# Edits controller/bulkTransactionController.js in place via exact,
# idempotent text substitutions (safe to re-run; already-applied blocks are
# skipped). A timestamped .bak backup of the original file is kept.
#
# Usage:
#   REPO_DIR=/2026_db_server_hp/sweety-sweet/nodejs_middleware \
#   PGHOST=localhost PGPORT=5432 PGDATABASE=sweety PGUSER=sweety PGPASSWORD=*** \
#   ./fix_sweety_api_bugs.sh
#
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(pwd)}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="$SCRIPT_DIR/migration_token_tables.sql"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-sweety-api}"
TARGET="controller/bulkTransactionController.js"

echo "==> Repo dir: $REPO_DIR"
cd "$REPO_DIR"

if [ ! -f "$TARGET" ]; then
  echo "❌ $TARGET not found under $REPO_DIR. Set REPO_DIR to the nodejs_middleware checkout." >&2
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "❌ python3 is required but not found on PATH." >&2; exit 1; }

STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP="${TARGET}.pre_bugfix_${STAMP}.bak"
cp "$TARGET" "$BACKUP"
echo "==> Backed up original to $BACKUP"

echo "==> Applying code fixes to $TARGET"
python3 "$SCRIPT_DIR/apply_bulk_fix.py" "$TARGET"

echo "==> Verifying JS syntax"
if command -v node >/dev/null 2>&1; then
  node --check "$TARGET"
  echo "✅ Syntax OK"
else
  echo "⚠️  node not found on PATH, skipping syntax check." >&2
fi

echo "==> Applying Postgres migration (creates token_tracking / token_access_logs)"
if command -v psql >/dev/null 2>&1; then
  psql -v ON_ERROR_STOP=1 -f "$SQL_FILE"
  echo "✅ Tables created (or already existed)."
else
  echo "⚠️  psql not found on PATH. Run this manually against your Postgres instance:" >&2
  echo "      psql -f \"$SQL_FILE\"" >&2
fi

echo "==> Done."
echo "    Original file backed up to: $REPO_DIR/$BACKUP"
echo "    Restart the service, e.g.:"
echo "      docker compose restart $COMPOSE_SERVICE"
echo "    or if running outside docker:"
echo "      pm2 restart $COMPOSE_SERVICE   # or your process manager of choice"
