#!/usr/bin/env bash
# fix-time-bug.sh — centralize MySQL datetime formatting and patch every
# LIVE (non-commented) call site that inserts an unformatted lastUpdated
# value into MySQL. Verified against the actual repo content — dead code
# inside /* ... */ blocks (old updateProducts_Batch duplicates, lines
# ~78-319 of bulkTransactionController.js) is intentionally skipped.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SRC_DIR}"

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="backups/${TS}"
mkdir -p "${BACKUP_DIR}"

changed=()

backup() {
  local f="$1"
  mkdir -p "${BACKUP_DIR}/$(dirname "$f")"
  cp "$f" "${BACKUP_DIR}/$f"
}

# ---- 1. shared utility -----------------------------------------------------
mkdir -p utils
cat > utils/formatForMySQL.js <<'EOF'
/**
 * Normalize a JS Date / ISO string / MySQL datetime string into
 * MySQL DATETIME format: 'YYYY-MM-DD HH:MM:SS' (UTC).
 */
const MYSQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export const formatForMySQL = (dateInput) => {
    const toUTC = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

    if (dateInput == null || dateInput === '') return toUTC(new Date());

    if (typeof dateInput === 'string' && MYSQL_DATETIME_RE.test(dateInput.trim())) {
        return dateInput.trim();
    }

    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    return isNaN(date.getTime()) ? toUTC(new Date()) : toUTC(date);
};
EOF
echo "wrote utils/formatForMySQL.js"

# ---- 2. availableItemsController.js: dedupe local copy, import shared one --
f="controller/availableItemsController.js"
if [ -f "$f" ]; then
  backup "$f"
  python3 - "$f" <<'PYEOF'
import re, sys
path = sys.argv[1]
src = open(path, encoding="utf-8").read()

if "from '../utils/formatForMySQL.js'" not in src:
    src = "import { formatForMySQL } from '../utils/formatForMySQL.js';\n" + src

pattern = re.compile(
    r"const formatForMySQL = \(dateInput\) => \{.*?\n\};\n",
    re.DOTALL
)
new_src, n = pattern.subn("", src)
if n == 1:
    src = new_src
    print(f"  {path}: removed local formatForMySQL definition")
elif n == 0:
    print(f"  {path}: WARNING local definition not found by pattern, left as-is")
else:
    print(f"  {path}: WARNING pattern matched {n} times, no changes made to definition")

open(path, "w", encoding="utf-8").write(src)
PYEOF
  changed+=("$f")
fi

# ---- 3. bulkTransactionController.js: patch the LIVE call sites only -------
f="controller/bulkTransactionController.js"
if [ -f "$f" ]; then
  backup "$f"
  python3 - "$f" <<'PYEOF'
import sys
path = sys.argv[1]
src = open(path, encoding="utf-8").read()

if "from '../utils/formatForMySQL.js'" not in src:
    src = "import { formatForMySQL } from '../utils/formatForMySQL.js';\n" + src

# Verified live (non-commented) substrings only.
replacements = [
    # line 371 — updateProducts_Batch, live INSERT..ON DUPLICATE KEY for availableItems
    ("[availableItems.productId, availableItems.itemsRemaining, availableItems.lastUpdated || new Date()]",
     "[availableItems.productId, availableItems.itemsRemaining, formatForMySQL(availableItems.lastUpdated)]"),
    # line 848 — addAvailableItems(), the function that actually fires per the logs
    ("    addAvailableItemsRequest.lastUpdated\n  ];",
     "    formatForMySQL(addAvailableItemsRequest.lastUpdated)\n  ];"),
    # line 880 — addPriceTrace() writes to priceTracing.date but sources it from .lastUpdated
    ("    addPriceTracing.lastUpdated\n  ];",
     "    formatForMySQL(addPriceTracing.lastUpdated)\n  ];"),
    # line 912 — addEstimates()
    ("    estimatesList.lastUpdated, \n  ];",
     "    formatForMySQL(estimatesList.lastUpdated), \n  ];"),
    # line 943 — addSodEod()
    ("    sodEodList.lastUpdated,\n   ];",
     "    formatForMySQL(sodEodList.lastUpdated),\n   ];"),
]

applied, missing, ambiguous = [], [], []
for old, new in replacements:
    count = src.count(old)
    if count == 0:
        missing.append(old)
    elif count > 1:
        ambiguous.append((old, count))
    else:
        src = src.replace(old, new, 1)
        applied.append(old)

open(path, "w", encoding="utf-8").write(src)

for a in applied:
    print(f"  applied fix near: {a[:60].strip()}...")
for m in missing:
    print(f"  WARNING not found (skipped): {m[:60].strip()}...")
for old, c in ambiguous:
    print(f"  WARNING appears {c} times, ambiguous — skipped: {old[:60].strip()}...")
PYEOF
  changed+=("$f")
fi

echo
echo "== changed files (backed up to ${BACKUP_DIR}) =="
printf '  %s\n' "${changed[@]}"

echo
echo "== diff =="
for f in "${changed[@]}"; do
  echo "--- $f ---"
  diff -u "${BACKUP_DIR}/$f" "$f" || true
done

echo
echo "== syntax check =="
for f in "${changed[@]}"; do
  node --check "$f" && echo "  OK: $f" || echo "  FAILED: $f"
done

echo
echo "== NOT touched (dead code inside /* */ blocks, lines ~78-319 of"
echo "   bulkTransactionController.js — old duplicate updateProducts_Batch" 
echo "   definitions, never executed, safe to leave or delete separately) =="
