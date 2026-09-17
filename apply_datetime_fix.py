#!/usr/bin/env python3
"""
apply_datetime_fix.py <path-to-ControllerHandler.js>

Fixes: MySQL ER_DATA_TOO_LONG ("Data too long for column 'lastUpdated'"/'date')
on inserts/updates through addCachedAndQuery / updateCachedOrQuery /
removeCachedAndQuery / getCachedOrQuery.

Root cause: controllers pass req.body.lastUpdated / req.body.date straight
through as JS Date().toISOString() strings, e.g.
"2026-09-17T11:23:59.000Z" (24 chars). MySQL's binary/prepared-statement
protocol checks a bound string parameter's length against the DATETIME
column's reported max length (19 chars: "YYYY-MM-DD HH:MM:SS") BEFORE
attempting to parse its content, so the ISO extras (T / .sss / Z) push it
over and MySQL rejects it as "too long" rather than as a bad date.

Fix: add a normalizeMysqlValues() helper in ControllerHandler.js and apply
it to mysqlQuery.values right before every connection.query(...) call.

Idempotent / safe to re-run: each fix reports APPLIED, SKIPPED (already
applied), or WARN (pattern not found -> file has diverged, needs a manual
look). Exits non-zero only when something could not be confirmed either way.
"""
import sys
import pathlib

HELPER_ANCHOR_OLD = "// 📌 TTL for cache entries (seconds)\nconst TTL_SECONDS = 30000 * 10;"

HELPER_BLOCK = '''// 📌 TTL for cache entries (seconds)
const TTL_SECONDS = 30000 * 10;

// ---------------------------------------------------------------------------
// 🔧 MySQL DATETIME value normalization
// ---------------------------------------------------------------------------
// Controllers pass req.body.lastUpdated / req.body.date straight through to
// SQL as JS Date().toISOString() strings, e.g. "2026-09-17T11:23:59.000Z"
// (24 chars). MySQL's binary/prepared-statement protocol validates bound
// string parameters against the DATETIME column's reported max length
// (19 chars, "YYYY-MM-DD HH:MM:SS") BEFORE attempting to parse the content,
// so anything longer \u2014 including the "T"/".sss"/"Z" ISO extras \u2014 is rejected
// with ER_DATA_TOO_LONG ("Data too long for column ...") rather than a
// datetime-parsing error. Converting to MySQL's own format first avoids that.
const MYSQL_ISO_DATETIME_RE = /^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}/;

const toMysqlDatetime = (value) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (typeof value === 'string' && MYSQL_ISO_DATETIME_RE.test(value)) {
    return value.slice(0, 19).replace('T', ' ');
  }
  return value;
};

const normalizeMysqlValues = (values) =>
  Array.isArray(values) ? values.map(toMysqlDatetime) : values;'''

CALL_FIXES = [
    (
        "select_call",
        "const [rows] = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values);",
        "const [rows] = await connection.query(mysqlQuery.text ?? mysqlQuery, normalizeMysqlValues(mysqlQuery.values));",
    ),
    (
        "insert_call",
        "const [result] = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values ?? []);\n\n    console.log(`${getLongTime()}\u2705 [MySQL] INSERT successful on key ${key}`);",
        "const [result] = await connection.query(mysqlQuery.text ?? mysqlQuery, normalizeMysqlValues(mysqlQuery.values ?? []));\n\n    console.log(`${getLongTime()}\u2705 [MySQL] INSERT successful on key ${key}`);",
    ),
    (
        "update_call",
        "const [result] = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values ?? []);\n\n    if (result.affectedRows === 0) {",
        "const [result] = await connection.query(mysqlQuery.text ?? mysqlQuery, normalizeMysqlValues(mysqlQuery.values ?? []));\n\n    if (result.affectedRows === 0) {",
    ),
    (
        "delete_call",
        "console.log(`${getLongTime()}\U0001f5d1\ufe0f [MySQL] Deleting for key [${key}]`);\n    const [result] = await connection.query(mysqlQuery.text ?? mysqlQuery, mysqlQuery.values ?? []);",
        "console.log(`${getLongTime()}\U0001f5d1\ufe0f [MySQL] Deleting for key [${key}]`);\n    const [result] = await connection.query(mysqlQuery.text ?? mysqlQuery, normalizeMysqlValues(mysqlQuery.values ?? []));",
    ),
]


def main():
    if len(sys.argv) != 2:
        print("usage: apply_datetime_fix.py <path-to-ControllerHandler.js>", file=sys.stderr)
        sys.exit(2)

    path = pathlib.Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")

    applied, skipped, warned = 0, 0, 0

    # 1. Insert the helper block once.
    if HELPER_ANCHOR_OLD in text and text.count(HELPER_ANCHOR_OLD) == 1 and "normalizeMysqlValues" not in text:
        text = text.replace(HELPER_ANCHOR_OLD, HELPER_BLOCK, 1)
        print("  \u2705 datetime_helper: applied")
        applied += 1
    elif "const normalizeMysqlValues" in text:
        print("  \u23ed\ufe0f  datetime_helper: already applied, skipping")
        skipped += 1
    else:
        print("  \u26a0\ufe0f  datetime_helper: anchor not found - file may have diverged, check manually", file=sys.stderr)
        warned += 1

    # 2. Wrap each of the 4 connection.query(...) call sites.
    for label, old, new in CALL_FIXES:
        count = text.count(old)
        if count == 1:
            text = text.replace(old, new, 1)
            print(f"  \u2705 {label}: applied")
            applied += 1
        elif count > 1:
            print(f"  \u274c {label}: pattern found {count} times (expected 1) - skipping to avoid a bad edit", file=sys.stderr)
            warned += 1
        elif new in text:
            print(f"  \u23ed\ufe0f  {label}: already applied, skipping")
            skipped += 1
        else:
            print(f"  \u26a0\ufe0f  {label}: pattern not found - file may have diverged, check manually", file=sys.stderr)
            warned += 1

    path.write_text(text, encoding="utf-8")

    print(f"==> {applied} applied, {skipped} already applied, {warned} need manual review")
    if warned:
        sys.exit(1)


if __name__ == "__main__":
    main()
