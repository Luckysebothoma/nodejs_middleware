#!/usr/bin/env python3
"""
apply_bulk_fix.py <path-to-bulkTransactionController.js>

Applies exact, idempotent text substitutions that fix:
  - ReferenceError: cacheKey is not defined (addNewCandy)
  - addCachedAndQuery() called with the old (key, query, replacements, conn)
    signature instead of (key, { mysqlQuery: { text, values } }), which is
    why every insert logged "Missing or invalid input(s): ... undefined"
  - addProductItemPricing() missing its `key` declaration entirely

Each fix is (label, old, new). For every fix:
  - if `old` is present exactly once -> replace it, report APPLIED
  - elif `new` is already present     -> report SKIPPED (already applied)
  - else                              -> report WARN (pattern not found;
                                          file may have diverged, needs a
                                          manual look)
Exits non-zero only if a fix could neither be applied nor confirmed already
applied.
"""
import sys
import pathlib

CALL_OLD_TMPL = "  const result = addCachedAndQuery(key,query, replacements, mySqlConnection);\n"
CALL_NEW_TMPL = "  const result = await addCachedAndQuery(key, { mysqlQuery: { text: query, values: replacements } });\n"

ROLLBACK_TAIL = (
    "  return result;\n"
    "  \n"
    "} catch (error) {\n"
    "\n"
    "  await mySqlConnection.rollback();\n"
    "  console.log(`\u274c Failed: Rolleback occured on key [${key}] \\n ${error}`);\n"
    "  throw `Exception on ${key} \\n ${error} `;\n"
    "  \n"
    "}\n"
)

FIXES = [
    (
        "addnewcandy_error_label",
        "  if (!res.headersSent) {\n"
        "   return logResponseDetails(req, res, {\n"
        "      status: 500,\n"
        "     success: false, message: errorMessage },cacheKey,500);\n"
        "  }",
        "  if (!res.headersSent) {\n"
        "   return logResponseDetails(req, res, {\n"
        "      status: 500,\n"
        "     success: false, message: errorMessage },\"addNewCandy\",500);\n"
        "  }",
    ),
    (
        "addnewcandy_success_label",
        "    return   logResponseDetails(req, res,  {\n"
        "        status: 200,\n"
        "      success: true,\n"
        "      message: `${getLongTime()}: Operation completed successfully`,\n"
        "    },cacheKey,500);",
        "    return   logResponseDetails(req, res,  {\n"
        "        status: 200,\n"
        "      success: true,\n"
        "      message: `${getLongTime()}: Operation completed successfully`,\n"
        "    },\"addNewCandy\",200);",
    ),
    (
        "addProductRecord_call",
        "try {\n"
        "\n"
        " \n"
        "  const result = addCachedAndQuery(key,query, replacements, mySqlConnection);\n"
        "   return result;\n"
        "  //const removedKey = removeData(key);\n"
        "  //const returnedAddCach = getCachedOrQuery()\n"
        "  \n"
        "} catch (error) { ",
        "try {\n"
        "\n"
        " \n"
        "  const result = await addCachedAndQuery(key, { mysqlQuery: { text: query, values: replacements } });\n"
        "   return result;\n"
        "  //const removedKey = removeData(key);\n"
        "  //const returnedAddCach = getCachedOrQuery()\n"
        "  \n"
        "} catch (error) { ",
    ),
    (
        "addYummyRecord_call",
        "try {\n\n" + CALL_OLD_TMPL + ROLLBACK_TAIL + "}\n\n// Reusable function to insert available items",
        "try {\n\n" + CALL_NEW_TMPL + ROLLBACK_TAIL + "}\n\n// Reusable function to insert available items",
    ),
    (
        "addAvailableItems_call",
        "try {\n\n" + CALL_OLD_TMPL + ROLLBACK_TAIL
        + "}\n\n// Reusable function to insert price tracing records\nasync function addPriceTrace",
        "try {\n\n" + CALL_NEW_TMPL + ROLLBACK_TAIL
        + "}\n\n// Reusable function to insert price tracing records\nasync function addPriceTrace",
    ),
    (
        "addPriceTrace_call",
        "  try {\n \n" + CALL_OLD_TMPL + ROLLBACK_TAIL
        + "}\n\n// Reusable function to insert price tracing records\nasync function addEstimates",
        "  try {\n \n" + CALL_NEW_TMPL + ROLLBACK_TAIL
        + "}\n\n// Reusable function to insert price tracing records\nasync function addEstimates",
    ),
    (
        "addEstimates_call",
        "  try {\n \n" + CALL_OLD_TMPL + ROLLBACK_TAIL
        + "}\n\n// Reusable function to insert price tracing records\nasync function addSodEod",
        "  try {\n \n" + CALL_NEW_TMPL + ROLLBACK_TAIL
        + "}\n\n// Reusable function to insert price tracing records\nasync function addSodEod",
    ),
    (
        "addSodEod_call",
        "  try {\n \n" + CALL_OLD_TMPL + ROLLBACK_TAIL + "}\nasync function addProductItemPricing",
        "  try {\n \n" + CALL_NEW_TMPL + ROLLBACK_TAIL + "}\nasync function addProductItemPricing",
    ),
    (
        "addProductItemPricing_key_decl",
        "async function addProductItemPricing(productItemPricing, mySqlConnection){\n"
        "\n"
        "  const query = `",
        "async function addProductItemPricing(productItemPricing, mySqlConnection){\n"
        "\n"
        "  const key = \"productItemPricing\";\n"
        "  const query = `",
    ),
    (
        "addProductItemPricing_call",
        "          try {\n \n" + CALL_OLD_TMPL + ROLLBACK_TAIL + "        \n\n}",
        "          try {\n \n" + CALL_NEW_TMPL + ROLLBACK_TAIL + "        \n\n}",
    ),
]


def main():
    if len(sys.argv) != 2:
        print("usage: apply_bulk_fix.py <path-to-bulkTransactionController.js>", file=sys.stderr)
        sys.exit(2)

    path = pathlib.Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")

    applied, skipped, warned = 0, 0, 0

    for label, old, new in FIXES:
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
