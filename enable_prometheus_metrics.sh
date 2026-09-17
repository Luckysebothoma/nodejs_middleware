#!/usr/bin/env bash
#
# enable_prometheus_metrics.sh
#
# Wires up utils/prometheusMetrics.js into index.js:
#   1. Uncomments/replaces the dead prom-client import block and adds a real
#      import of utils/prometheusMetrics.js (this "defines" the metrics by
#      registering them on prom-client's default registry).
#   2. Fixes the /metrics route to actually serve client.register.metrics()
#      instead of always returning 503.
#   3. Wires prometheusMetrics.logQuery()/logError() into the /update-product
#      MySQL calls, so the metrics are actually "used", not just defined.
#
# Safety:
#   - index.js is backed up as index.js.backup_<timestamp> BEFORE any edit.
#   - The patch aborts (no changes written) if any of the 4 expected blocks
#     is not found exactly once in the current file, so it will not silently
#     mangle a file that has already drifted from what this script expects.
#   - After patching, `node --check` validates syntax; on failure the backup
#     is restored automatically and the script exits non-zero.
#
# Usage: run from the repo root (where index.js lives):
#   ./enable_prometheus_metrics.sh

set -euo pipefail

REPO_ROOT="$(pwd)"
TARGET="index.js"
METRICS_FILE="utils/prometheusMetrics.js"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP="${TARGET}.backup_${TIMESTAMP}"

echo "==> Repo root: ${REPO_ROOT}"

if [[ ! -f "${TARGET}" ]]; then
  echo "ERROR: ${TARGET} not found in $(pwd). Run this from the repo root." >&2
  exit 1
fi

if [[ ! -f "${METRICS_FILE}" ]]; then
  echo "ERROR: ${METRICS_FILE} not found. Nothing to wire up." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found on PATH." >&2
  exit 1
fi

echo "==> Backing up ${TARGET} -> ${BACKUP}"
cp -p "${TARGET}" "${BACKUP}"

if [[ ! -f "${BACKUP}" ]]; then
  echo "ERROR: backup was not created, aborting before touching ${TARGET}." >&2
  exit 1
fi

echo "==> Patching ${TARGET}"

# Node does the actual text surgery so we can verify each block is present
# exactly once before writing anything back out.
if ! node - "${TARGET}" <<'NODE_EOF'
const fs = require('fs');
const path = process.argv[2];
let src = fs.readFileSync(path, 'utf8');

function replaceOnce(label, pattern, replacement, isRegex) {
  let matches;
  if (isRegex) {
    matches = src.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'));
  } else {
    matches = src.split(pattern).length - 1;
    matches = matches > 0 ? new Array(matches) : null;
  }
  const count = matches ? matches.length : 0;
  if (count !== 1) {
    console.error(`ERROR: expected exactly 1 match for "${label}", found ${count}. Aborting without changes.`);
    process.exit(1);
  }
  src = isRegex ? src.replace(pattern, replacement) : src.replace(pattern, replacement);
}

// 1) Dead prom-client import block -> real imports + collectDefaultMetrics
replaceOnce(
  'commented-out prom-client import block',
  /\/\*\s*\nimport\s*\{\s*\n\s*Registry,[\s\S]*?\*\//,
  [
    'import client from "prom-client";',
    'import prometheusMetrics from "./utils/prometheusMetrics.js";',
    '',
    '// Collect default Node.js process metrics (CPU, memory, event loop, etc.)',
    '// alongside the custom MySQL metrics defined in utils/prometheusMetrics.js.',
    'client.collectDefaultMetrics();',
    '',
  ].join('\n'),
  true
);

// 2) Stale commented-out registry setup comment
replaceOnce(
  'stale "Prometheus metrics" comment block',
  '// Prometheus metrics\n//const register = new Registry();\n//collectDefaultMetrics({ register });',
  [
    '// Prometheus metrics: default + custom collectors are registered on',
    "// prom-client's default registry (client.register); see /metrics below",
    '// and utils/prometheusMetrics.js.',
  ].join('\n'),
  false
);

// 3) The /metrics route that always 503s
replaceOnce(
  '/metrics route stub',
  [
    "app.get('/metrics', async (req, res) => {",
    '  try {',
    '    logRequestDetails(req, "metrics");',
    '    // NOTE: the prom-client registry is not wired up (see the commented-out',
    '    // import near the top of this file). Fail loudly instead of hanging.',
    "    return res.status(503).json({ error: 'Metrics endpoint not configured' });",
    '  } catch (err) {',
    "    console.error('Error in /metrics:', err);",
    "    return res.status(500).json({ error: 'Internal server error' });",
    '  }',
    '});',
  ].join('\n'),
  [
    "app.get('/metrics', async (req, res) => {",
    '  try {',
    '    logRequestDetails(req, "metrics");',
    "    res.set('Content-Type', client.register.contentType);",
    '    return res.send(await client.register.metrics());',
    '  } catch (err) {',
    "    console.error('Error in /metrics:', err);",
    "    return res.status(500).json({ error: 'Internal server error' });",
    '  }',
    '});',
  ].join('\n'),
  false
);

// 4) Actually USE prometheusMetrics: instrument the /update-product MySQL calls
replaceOnce(
  '/update-product MySQL calls',
  [
    '      const [Redisresult] = await updateCachedOrQuery("product_backup:"+productListCacheKey, sql, oldValues);',
    '      const [mySqlresult] = await updateCachedOrQuery(productListCacheKey, sql, newValues);',
  ].join('\n'),
  [
    '      const _metricsStart = Date.now();',
    '      let Redisresult, mySqlresult;',
    '      try {',
    '        [Redisresult] = await updateCachedOrQuery("product_backup:"+productListCacheKey, sql, oldValues);',
    '        [mySqlresult] = await updateCachedOrQuery(productListCacheKey, sql, newValues);',
    "        prometheusMetrics.logQuery('update-product', _metricsStart);",
    '      } catch (metricsErr) {',
    "        prometheusMetrics.logError('update-product');",
    '        throw metricsErr;',
    '      }',
  ].join('\n'),
  false
);

fs.writeFileSync(path, src, 'utf8');
console.log('OK: all 4 blocks patched.');
NODE_EOF
then
  echo "==> Patch failed. ${TARGET} left untouched (or only partially in-memory, never written). Backup retained at ${BACKUP}." >&2
  exit 1
fi

echo "==> Verifying syntax with 'node --check'"
if ! node --check "${TARGET}"; then
  echo "==> Syntax check FAILED. Restoring ${TARGET} from ${BACKUP}." >&2
  cp -p "${BACKUP}" "${TARGET}"
  exit 1
fi

echo "==> Success."
echo "==> Backup kept at: ${BACKUP}"
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  echo "==> git diff --stat:"
  git diff --stat -- "${TARGET}" || true
fi

echo ""
echo "Next steps:"
echo "  1. Review the diff: git diff ${TARGET}   (or diff ${BACKUP} ${TARGET})"
echo "  2. Restart the service so the new /metrics wiring takes effect."
echo "  3. curl -sk https://localhost:8443/metrics | head   (or your configured port)"
