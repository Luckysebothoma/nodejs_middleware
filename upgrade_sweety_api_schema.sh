#!/usr/bin/env bash
# =============================================================================
# upgrade_sweety_api_schema.sh   (nodejs_middleware / sweety-api)
#
# Gives the API a self-migrating, clean database schema for BOTH MySQL and PostgreSQL:
# tables, indexes, foreign keys, constraints, generated columns, auto-populating triggers,
# reporting views and a daily financial ledger. The API creates everything it is missing at boot
# (in the cluster primary, before workers fork, under a database lock).
# Also fixes the boot race seen in the logs: "pg_type_typname_nsp_index" duplicate key.
#
# BUILDS ON upgrade_sweety_api_images.sh (apply that first): the baseline of every file this
# script edits is that upgrade's output, pinned by SHA-256 in the embedded payload.
# Nothing is committed, pushed or deployed and NO database is touched by this script: the API
# migrates its databases itself when YOU restart it.
#
# Modes:  --audit | --dry-run | --apply | --verify | --self-test | --restore [ID] | --help
# =============================================================================
set -Eeuo pipefail
umask 077

readonly SCRIPT_VERSION="1.0.0"
readonly UPGRADE_NAME="sweety-api-schema"
readonly EXPECTED_BASE_COMMIT="5be62f40c958fe9594317723a467fe438b68572c"
readonly PAYLOAD_SHA256="195b0f2dc904b6e16a86078882365e9032895300cb5d1bb615ed302e4bb3e5e3"

# exit codes
readonly E_OK=0 E_USAGE=1 E_PREREQ=2 E_NOREPO=3 E_CONFLICT=4 E_APPLY=5 E_RESTORE=6 E_VERIFY=7 E_LOCK=8

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
MODE=""; RESTORE_ID=""; REPO=""; RUN_TESTS=0; TEST_PG_URL=""; TEST_MYSQL_URL=""; BACKUP_ROOT=""
WORK="" ; LOG_FILE=""

usage() {
  cat <<'EOF'
Usage: ./upgrade_sweety_api_schema.sh <mode> [options]        (run from the nodejs_middleware repo)

Apply upgrade_sweety_api_images.sh FIRST. This script edits files that upgrade created.

Modes (exactly one):
  --audit            Read-only report: prerequisites, git state, per-file status.
  --dry-run          Show what --apply would back up, patch and create. Writes nothing.
  --apply            Back up originals, apply the change set, verify result hashes.
                     Safe to re-run: reports "already applied" and does nothing.
  --verify           Check the repo matches the upgrade, syntax-check every changed JS file
                     and, with --test, run the test suite.
  --restore [ID]     Undo THIS upgrade only (default: newest applied/interrupted run). Files
                     changed by you after --apply are reported as conflicts and left untouched.
  --self-test        Proves apply/idempotency/verify/conflict-detection/restore on a throw-away
                     clone that mirrors your current files. Never touches your working tree.
  --help             This text.

Options:
  --repo PATH        Repo root (default: auto-detected: script dir, its parent, or the current dir).
  --backup-root DIR  Where backups/manifests/logs go (default: <repo>.upgrade-backups next to the
                     repo; must be outside the repo). Env: SWEETY_BACKUP_ROOT.
  --test             (--verify) run `npm test` (Node 22+). 23 database-free tests always run.
  --test-pg URL      (--verify) also run the Postgres tests against a SCRATCH server
                     (postgres://user:pw@host:5432/scratch_db). They create/drop their own schemas.
  --test-mysql URL   (--verify) also run the MySQL tests (mysql://user:pw@host:3306, NO database
                     name; the user needs CREATE/DROP DATABASE). Never point either at real data.

What changes (2 files edited, 18 created):
  EDIT index.js                            the cluster PRIMARY migrates the databases once, THEN forks workers
       controller/productImageController.js  table creation now takes a Postgres advisory lock (the boot race)
  NEW  db/migrate.js, db/splitSql.js, db/expectedSchema.js, db/startupMigrations.js   the runner
       db/migrations/mysql/001_core_schema.sql, 002_automation.sql
       db/migrations/postgres/001_core_schema.sql, 002_automation.sql, 003_auth_and_images.sql
       test/*  (57 more tests: schema, formulas, ledger, constraints, concurrency, failure handling)

How to get the clean databases (nothing is dropped by anything here):
  1. create EMPTY databases (e.g. sweety_clean in MySQL and in Postgres) with a user that can create
     tables (and triggers/procedures in MySQL)
  2. point MYSQL_DATABASE / PGDATABASE at them (env or docker-compose) and restart the API
  3. the API creates every table, index, constraint, trigger and view; look for "[db-migrate]" in the logs
  Old data is not copied. The old databases stay untouched, so switching back is just the env change.

What the schema does automatically (rules, never overwriting what the API sends):
  productPricing: costPerItem = price/qty, sellingPrice = cost x (1+markup 30%), productProfit = qty x selling,
                  productCommission = profit - cost x qty (only when the API leaves them 0/blank)
  generated:      unitMargin, marginPct, packCost, variance, sellThroughPct, itemsSold, isOutOfStock
  names/image_url blank values are filled from productList ("Name Flavor.webp")
  daily_financials  one ledger row per product per day, written by every sodEodItems save:
                  sold, revenue, cost, profit, commissionAmount (70%), shopShare (30%); survives product deletion
  views:          v_product_financials, v_stock_status, v_daily_summary
  app_settings:   markup_rate, shop_commission_rate, low_stock_threshold (change them with plain UPDATEs)

Environment: DB_AUTO_MIGRATE=0 (off) | DB_SCHEMA_STRICT=1 (exit if unhealthy) | DB_MIGRATE_TIMEOUT_MS (60000)
             TOKEN_LOG_RETENTION_DAYS (90; 0 = keep) | IMAGE_AUTO_MIGRATE=0

Exit codes: 0 ok | 1 usage | 2 prerequisite missing | 3 not a git repo | 4 conflict / partial
            state | 5 apply failed (auto-rolled back) | 6 restore conflict | 7 verify failed | 8 locked
EOF
}

# ---------- logging ----------------------------------------------------------
ts() { date +"%Y-%m-%dT%H:%M:%S%z"; }
log() { local m="[$(ts)] $*"; echo "$m"; [[ -n "$LOG_FILE" ]] && echo "$m" >>"$LOG_FILE" || true; }
die() { local code="$1"; shift; log "ERROR: $*"; exit "$code"; }

cleanup() { [[ -n "${WORK:-}" && -d "$WORK" ]] && rm -rf "$WORK"; return 0; }
trap cleanup EXIT

# ---------- argument parsing -------------------------------------------------
[[ $# -eq 0 ]] && { usage; exit $E_USAGE; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --audit|--dry-run|--apply|--verify|--self-test|--help)
      [[ -n "$MODE" ]] && { echo "Only one mode allowed" >&2; exit $E_USAGE; }
      MODE="${1#--}" ;;
    --restore)
      [[ -n "$MODE" ]] && { echo "Only one mode allowed" >&2; exit $E_USAGE; }
      MODE="restore"
      if [[ $# -gt 1 && "$2" != --* ]]; then RESTORE_ID="$2"; shift; fi ;;
    --repo) REPO="${2:?--repo needs a path}"; shift ;;
    --backup-root) BACKUP_ROOT="${2:?--backup-root needs a path}"; shift ;;
    --test) RUN_TESTS=1 ;;
    --test-pg|--test-db) TEST_PG_URL="${2:?$1 needs a postgres:// URL}"; RUN_TESTS=1; shift ;;
    --test-mysql) TEST_MYSQL_URL="${2:?--test-mysql needs a mysql:// URL}"; RUN_TESTS=1; shift ;;
    -h) MODE="help" ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit $E_USAGE ;;
  esac
  shift
done
[[ "$MODE" == "help" ]] && { usage; exit $E_OK; }
[[ -z "$MODE" ]] && { usage; exit $E_USAGE; }

# ---------- prerequisites ----------------------------------------------------
die_early() { echo "ERROR: $*" >&2; exit 2; }
need() { command -v "$1" >/dev/null 2>&1 || die $E_PREREQ "Required tool not found: $1"; }
for t in git sha256sum tar base64 sed awk cp stat mkdir date readlink; do need "$t"; done

if [[ -z "$REPO" ]]; then
  for cand in "$(dirname "$SCRIPT_PATH")" "$(dirname "$SCRIPT_PATH")/.." "$PWD"; do
    if [[ -f "$cand/index.js" && -f "$cand/package.json" && -f "$cand/routes/studentsRoutes.js" ]]; then REPO="$(cd "$cand" && pwd)"; break; fi
  done
  [[ -z "$REPO" ]] && die_early "Could not find the nodejs_middleware repo (index.js, package.json, routes/studentsRoutes.js). Use --repo PATH."
fi
REPO="$(readlink -f "$REPO")"
git -C "$REPO" rev-parse --show-toplevel >/dev/null 2>&1 || die $E_NOREPO "Not a git repository: $REPO"
TOP="$(readlink -f "$(git -C "$REPO" rev-parse --show-toplevel)")"
[[ "$TOP" == "$REPO" ]] || die $E_NOREPO "--repo must be the repository root ($TOP)"
[[ -f "$REPO/index.js" && -f "$REPO/routes/studentsRoutes.js" && -d "$REPO/controller" ]] || die $E_PREREQ "Does not look like the Sweety Sweet API repo (index.js / routes/studentsRoutes.js / controller/ missing)"

[[ -z "$BACKUP_ROOT" ]] && BACKUP_ROOT="${SWEETY_BACKUP_ROOT:-$(dirname "$REPO")/$(basename "$REPO").upgrade-backups}"
mkdir -p "$BACKUP_ROOT"; BACKUP_ROOT="$(readlink -f "$BACKUP_ROOT")"
case "$BACKUP_ROOT/" in "$REPO"/*) die $E_PREREQ "Backup root must be OUTSIDE the repo (your git auto-push would commit it): $BACKUP_ROOT";; esac
mkdir -p "$BACKUP_ROOT/logs"
LOG_FILE="$BACKUP_ROOT/logs/${UPGRADE_NAME}_$(date +%Y%m%d_%H%M%S)_${MODE}.log"
: >"$LOG_FILE"
log "$UPGRADE_NAME v$SCRIPT_VERSION  mode=$MODE  repo=$REPO"

# ---------- payload ----------------------------------------------------------
WORK="$(mktemp -d)"
extract_payload() {
  sed -n '/^__PAYLOAD_BELOW__$/,$p' "$SCRIPT_PATH" | tail -n +2 >"$WORK/payload.b64"
  local got; got="$(sha256sum "$WORK/payload.b64" | awk '{print $1}')"
  [[ "$got" == "$PAYLOAD_SHA256" ]] || die $E_PREREQ "Embedded payload is corrupt or edited (sha256 $got != $PAYLOAD_SHA256)"
  mkdir -p "$WORK/p"; base64 -d "$WORK/payload.b64" | tar -xz -C "$WORK/p"
  [[ -f "$WORK/p/changes.patch" && -f "$WORK/p/files.tsv" && -f "$WORK/p/expected.sha256" && -f "$WORK/p/base.sha256" ]] || die $E_PREREQ "Payload is incomplete"
}
extract_payload
PATCH="$WORK/p/changes.patch"; FILES="$WORK/p/files.tsv"; EXPECT="$WORK/p/expected.sha256"; BASE="$WORK/p/base.sha256"

sha_of()   { sha256sum "$1" | awk '{print $1}'; }
mode_of()  { stat -c '%a' "$1"; }
expected_sha() { awk -v f="$1" '$2==f {print $1}' "$EXPECT"; }
base_sha() { awk -v f="$1" '$2==f {print $1}' "$BASE"; }   # expected content BEFORE this upgrade (the images upgrade's output)

# classify one file: pristine | upgraded | modified | missing | exists-other
classify() { # $1 kind (M|N)  $2 relpath
  local kind="$1" rel="$2" abs="$REPO/$2" exp cur base
  exp="$(expected_sha "$rel")"
  if [[ ! -e "$abs" ]]; then echo "missing"; return; fi
  cur="$(sha_of "$abs")"
  [[ "$cur" == "$exp" ]] && { echo "upgraded"; return; }
  if [[ "$kind" == "M" ]]; then
    base="$(base_sha "$rel")"
    [[ "$cur" == "$base" ]] && echo "pristine" || echo "modified"
  else
    echo "exists-other"
  fi
}

SUMMARY_PRISTINE=0; SUMMARY_UPGRADED=0; SUMMARY_BAD=0; TOTAL=0
survey() { # prints table, fills counters
  SUMMARY_PRISTINE=0; SUMMARY_UPGRADED=0; SUMMARY_BAD=0; TOTAL=0
  while IFS=$'\t' read -r kind rel; do
    [[ -z "$kind" ]] && continue
    local st; st="$(classify "$kind" "$rel")"; TOTAL=$((TOTAL+1))
    case "$kind:$st" in
      M:pristine|N:missing) SUMMARY_PRISTINE=$((SUMMARY_PRISTINE+1)); log "  [$kind] $st  $rel" ;;
      *:upgraded)           SUMMARY_UPGRADED=$((SUMMARY_UPGRADED+1)); log "  [$kind] already-upgraded  $rel" ;;
      *)                    SUMMARY_BAD=$((SUMMARY_BAD+1)); log "  [$kind] $st  $rel   <-- differs from what the upgrade expects" ;;
    esac
  done <"$FILES"
}

acquire_lock() {
  LOCKDIR="$BACKUP_ROOT/.lock"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    local oldpid; oldpid="$(cat "$LOCKDIR/pid" 2>/dev/null || true)"
    if [[ -n "$oldpid" ]] && ! kill -0 "$oldpid" 2>/dev/null; then
      log "Removing stale lock from dead process $oldpid"
      rm -rf "$LOCKDIR"; mkdir "$LOCKDIR" 2>/dev/null || die $E_LOCK "Could not take lock $LOCKDIR"
    else
      die $E_LOCK "Another run (pid ${oldpid:-unknown}) holds $LOCKDIR"
    fi
  fi
  echo "$$" >"$LOCKDIR/pid"
  trap 'rm -rf "$LOCKDIR" 2>/dev/null || true; cleanup' EXIT
}

# Interrupt safety: if Ctrl-C / SIGTERM arrives while applying, roll back this run.
IN_APPLY=0; CURRENT_MAN=""
on_signal() {
  log "Interrupted by signal."
  if [[ $IN_APPLY -eq 1 && -n "$CURRENT_MAN" ]]; then
    log "Rolling back the partial apply from backup..."
    restore_from_manifest "$CURRENT_MAN" "auto-rollback" || true
  fi
  exit 130
}
trap on_signal INT TERM HUP

# ---------- modes ------------------------------------------------------------
do_audit() {
  log "Repo HEAD: $(git -C "$REPO" rev-parse HEAD)  (upgrade built against $EXPECTED_BASE_COMMIT)"
  [[ "$(git -C "$REPO" rev-parse HEAD)" == "$EXPECTED_BASE_COMMIT" ]] || log "NOTE: HEAD differs from the audited commit; per-file hash checks below are what actually gate --apply."
  log "Branch: $(git -C "$REPO" rev-parse --abbrev-ref HEAD)"
  local dirty; dirty="$(git -C "$REPO" status --porcelain | wc -l)"
  log "Working tree: $dirty changed/untracked path(s) (these are never touched unless listed below)"
  git -C "$REPO" status --porcelain | sed 's/^/    /' | tee -a "$LOG_FILE" | head -40 || true
  log "Files in this upgrade ($(wc -l <"$FILES")):"
  survey
  log "Summary: pristine/new=$SUMMARY_PRISTINE  already-upgraded=$SUMMARY_UPGRADED  conflicting=$SUMMARY_BAD  total=$TOTAL"
  if   [[ $SUMMARY_BAD -gt 0 ]];      then log "RESULT: conflicts present; --apply would refuse."; return $E_CONFLICT
  elif [[ $SUMMARY_UPGRADED -eq $TOTAL ]]; then log "RESULT: upgrade already applied."
  elif [[ $SUMMARY_UPGRADED -gt 0 ]]; then log "RESULT: PARTIAL state (some files upgraded, some not); --apply would refuse."; return $E_CONFLICT
  else log "RESULT: ready to apply."; fi
  [[ -d "$REPO/node_modules" ]] && log "node_modules: present" || log "node_modules: absent (only needed for --verify --test; run 'npm ci')"
  return 0
}

check_patch_applies() { git -C "$REPO" apply --check --whitespace=nowarn "$PATCH"; }

do_dry_run() {
  survey
  [[ $SUMMARY_BAD -gt 0 ]] && die $E_CONFLICT "Conflicts: files differ from what the upgrade expects (see above). Nothing would be changed."
  if [[ $SUMMARY_UPGRADED -eq $TOTAL ]]; then log "DRY-RUN: already applied; --apply would do nothing."; return 0; fi
  [[ $SUMMARY_UPGRADED -gt 0 ]] && die $E_CONFLICT "Partial state detected; refusing."
  check_patch_applies || die $E_CONFLICT "git apply --check failed; patch does not apply cleanly."
  log "DRY-RUN: would back up to: $BACKUP_ROOT/<timestamp>_$UPGRADE_NAME/"
  while IFS=$'\t' read -r kind rel; do
    [[ "$kind" == "M" ]] && log "  would back up + modify  $rel" || log "  would create            $rel"
  done <"$FILES"
  log "DRY-RUN OK: nothing was written to the repo."
}

do_apply() {
  acquire_lock
  survey
  if [[ $SUMMARY_BAD -gt 0 ]]; then
    log "Hint: files marked 'modified' differ from the output of upgrade_sweety_api_images.sh. Apply that script first (./upgrade_sweety_api_images.sh --audit shows its state)."
    log "      Otherwise inspect with  git -C '$REPO' diff -- <file>  and send me the current file."
    die $E_CONFLICT "Refusing: your copy of some files differs from the audited baseline (nothing changed)."
  fi
  if [[ $SUMMARY_UPGRADED -eq $TOTAL ]]; then log "Already applied; nothing to do."; return 0; fi
  [[ $SUMMARY_UPGRADED -gt 0 ]] && die $E_CONFLICT "Partial state detected (some files already upgraded). Use --restore first, or inspect manually."
  check_patch_applies || die $E_CONFLICT "git apply --check failed; nothing changed."

  local id; id="$(date +%Y%m%d_%H%M%S)-$$_$UPGRADE_NAME"
  local bdir="$BACKUP_ROOT/$id"; mkdir -p "$bdir/files"
  local man="$bdir/manifest.tsv"
  CURRENT_MAN="$man"; IN_APPLY=1
  {
    echo -e "#meta\tupgrade\t$UPGRADE_NAME\tversion\t$SCRIPT_VERSION"
    echo -e "#meta\trepo\t$REPO"
    echo -e "#meta\tbase_head\t$(git -C "$REPO" rev-parse HEAD)"
    echo -e "#meta\tcreated\t$(ts)"
    echo -e "#meta\tstatus\tINCOMPLETE"
    echo -e "#cols\tkind\trelpath\torig_sha256\torig_mode\texpected_new_sha256"
  } >"$man"
  log "Backup dir: $bdir"

  # 1) back up every file we will modify (preserving mode/timestamps), record hashes
  while IFS=$'\t' read -r kind rel; do
    [[ "$kind" == "M" ]] || continue
    mkdir -p "$bdir/files/$(dirname "$rel")"
    cp -p "$REPO/$rel" "$bdir/files/$rel"
    local osha; osha="$(sha_of "$REPO/$rel")"
    [[ "$(sha_of "$bdir/files/$rel")" == "$osha" ]] || die $E_APPLY "Backup verification failed for $rel"
    echo -e "M\t$rel\t$osha\t$(mode_of "$REPO/$rel")\t$(expected_sha "$rel")" >>"$man"
  done <"$FILES"
  # record new files (and directories we will create) BEFORE creating them
  while IFS=$'\t' read -r kind rel; do
    [[ "$kind" == "N" ]] || continue
    local d; d="$(dirname "$rel")"
    while [[ "$d" != "." && "$d" != "/" && ! -d "$REPO/$d" ]]; do echo -e "D\t$d" >>"$man"; d="$(dirname "$d")"; done
    echo -e "N\t$rel\t-\t-\t$(expected_sha "$rel")" >>"$man"
  done <"$FILES"
  log "Manifest written: $man"

  # 2) apply (tracked-file edits via git apply -> working tree only, index untouched)
  rollback_now() {
    log "Rolling back this run's changes from backup..."
    restore_from_manifest "$man" "auto-rollback" || true
  }
  if ! git -C "$REPO" apply --whitespace=nowarn "$PATCH"; then
    rollback_now; die $E_APPLY "git apply failed; rolled back."
  fi
  # 3) create new files
  while IFS=$'\t' read -r kind rel; do
    [[ "$kind" == "N" ]] || continue
    mkdir -p "$REPO/$(dirname "$rel")"
    cp "$WORK/p/new/$rel" "$REPO/$rel"
    chmod 644 "$REPO/$rel"
  done <"$FILES"
  # 4) verify results are byte-identical to the tested change set
  local bad=0
  while IFS=$'\t' read -r kind rel; do
    [[ -z "$kind" ]] && continue
    if [[ "$(sha_of "$REPO/$rel")" != "$(expected_sha "$rel")" ]]; then log "HASH MISMATCH after apply: $rel"; bad=1; fi
  done <"$FILES"
  if [[ $bad -ne 0 ]]; then rollback_now; die $E_APPLY "Post-apply verification failed; rolled back."; fi
  sed -i 's/^#meta\tstatus\tINCOMPLETE$/#meta\tstatus\tAPPLIED/' "$man"
  IN_APPLY=0
  log "APPLIED OK: $(grep -c '^M' "$man") file(s) modified, $(grep -c '^N' "$man") created."
  log "Next: $SCRIPT_PATH --verify --test   (undo any time with: --restore $id)"
  log "Reminder: your 4-hourly git auto-push will commit these changes at its next run."
  log "NOT deployed and NO database touched. To go live:"
  log "  1) create EMPTY MySQL and Postgres databases, point MYSQL_DATABASE / PGDATABASE at them"
  log "  2) rebuild + redeploy sweety-api (your usual process); the PRIMARY process migrates, then workers start"
  log "  3) check the logs for '[db-migrate] mysql: applied [001, 002]' and '[db-migrate] postgres: applied [001, 002, 003]'"
  log "  Optional: set DB_SCHEMA_STRICT=1 once healthy, so a wrong database stops the API instead of limping on."
}

manifest_status() { awk -F'\t' '$1=="#meta" && $2=="status" {print $3}' "$1" 2>/dev/null; }
latest_applied() {
  local m st
  for m in $(ls -1d "$BACKUP_ROOT"/*_"$UPGRADE_NAME" 2>/dev/null | sort -r); do
    st="$(manifest_status "$m/manifest.tsv")"
    [[ "$st" == "APPLIED" || "$st" == "INCOMPLETE" ]] && { basename "$m"; return; }
  done
}

# restore_from_manifest <manifest> <label> ; returns E_RESTORE if any conflict
restore_from_manifest() {
  local man="$1" label="$2" conflicts=0 restored=0 bdir; bdir="$(dirname "$man")"
  local -a dirs=()
  while IFS=$'\t' read -r kind rel osha omode esha; do
    case "$kind" in
      M)
        local cur_abs="$REPO/$rel" cur; cur="-"
        [[ -e "$cur_abs" ]] && cur="$(sha_of "$cur_abs")"
        if [[ "$cur" == "$osha" ]]; then log "  [$label] unchanged-from-original  $rel"; continue; fi
        if [[ "$cur" != "$esha" && "$label" != "auto-rollback" ]]; then
          log "  CONFLICT: $rel was changed after the upgrade (not restoring; your edits are kept)"; conflicts=$((conflicts+1)); continue
        fi
        if [[ "$(sha_of "$bdir/files/$rel")" != "$osha" ]]; then
          log "  CONFLICT: backup of $rel failed hash verification; refusing to restore it"; conflicts=$((conflicts+1)); continue
        fi
        cp -p "$bdir/files/$rel" "$cur_abs"; chmod "$omode" "$cur_abs"
        log "  [$label] restored $rel"; restored=$((restored+1)) ;;
      N)
        local n_abs="$REPO/$rel"
        if [[ ! -e "$n_abs" ]]; then log "  [$label] already absent $rel"; continue; fi
        if [[ "$(sha_of "$n_abs")" == "$esha" || "$label" == "auto-rollback" ]]; then
          rm -f -- "$n_abs"; log "  [$label] removed created file $rel"; restored=$((restored+1))
        else
          log "  CONFLICT: created file $rel was edited after the upgrade (kept)"; conflicts=$((conflicts+1))
        fi ;;
      D) dirs+=("$rel") ;;
    esac
  done < <(grep -v '^#' "$man")
  # remove only directories this run created, and only if now empty
  local d
  if [[ ${#dirs[@]} -gt 0 ]]; then
    while read -r d; do
      if [[ -n "$d" && -d "$REPO/$d" ]] && rmdir "$REPO/$d" 2>/dev/null; then log "  removed empty created dir $d"; fi
    done < <(printf '%s\n' "${dirs[@]}" | sort -u | awk '{ print gsub("/","/") " " $0 }' | sort -rn | cut -d' ' -f2-)
  fi
  log "Restore summary: restored=$restored conflicts=$conflicts"
  [[ $conflicts -eq 0 ]] || return $E_RESTORE
}

do_restore() {
  acquire_lock
  local id="$RESTORE_ID"
  [[ -z "$id" ]] && id="$(latest_applied)"
  [[ -z "$id" ]] && die $E_RESTORE "No applied run found in $BACKUP_ROOT"
  local man="$BACKUP_ROOT/$id/manifest.tsv"
  [[ -f "$man" ]] || die $E_RESTORE "Manifest not found: $man"
  grep -q "^#meta"$'\t'"upgrade"$'\t'"$UPGRADE_NAME" "$man" || die $E_RESTORE "Manifest belongs to a different upgrade"
  local st label="restore"; st="$(manifest_status "$man")"
  [[ "$st" == "RESTORED" ]] && { log "Run $id is already restored."; return 0; }
  [[ "$st" == "INCOMPLETE" ]] && { label="auto-rollback"; log "Run $id was interrupted (INCOMPLETE): rolling back from its backup."; }
  log "Restoring run $id"
  if restore_from_manifest "$man" "$label"; then
    sed -i 's/^#meta\tstatus\t\(APPLIED\|INCOMPLETE\)$/#meta\tstatus\tRESTORED/' "$man"
    log "RESTORE OK."
  else
    log "RESTORE INCOMPLETE: conflicts above were left untouched; manifest stays APPLIED so you can re-run after resolving."
    return $E_RESTORE
  fi
}

do_verify() {
  local bad=0
  log "Hash check against the tested change set:"
  while IFS=$'\t' read -r kind rel; do
    [[ -z "$kind" ]] && continue
    if [[ -e "$REPO/$rel" && "$(sha_of "$REPO/$rel")" == "$(expected_sha "$rel")" ]]; then log "  ok   $rel"
    else log "  FAIL $rel"; bad=1; fi
  done <"$FILES"
  [[ $bad -eq 0 ]] || die $E_VERIFY "Repo does not match the upgrade (not applied, or edited since)."
  log "Hash check passed."

  need node
  log "Syntax check (node --check) on every changed JavaScript file:"
  while IFS=$'\t' read -r kind rel; do
    case "$rel" in
      *.js|*.mjs) if node --check "$REPO/$rel" >>"$LOG_FILE" 2>&1; then log "  ok   $rel"; else log "  FAIL $rel"; bad=1; fi ;;
    esac
  done <"$FILES"
  [[ $bad -eq 0 ]] || die $E_VERIFY "Syntax errors found (see $LOG_FILE)"
  log "Syntax check passed."

  if [[ $RUN_TESTS -eq 1 ]]; then
    need npm
    [[ -d "$REPO/node_modules" ]] || die $E_PREREQ "--test needs node_modules (run 'npm ci' first)"
    local node_major; node_major="$(node -p 'process.versions.node.split(".")[0]')"
    [[ "$node_major" -ge 22 ]] || die $E_PREREQ "--test needs Node 22+ (found $(node -v))"
    local pgs="no (add --test-pg URL)" mys="no (add --test-mysql URL)"
    [[ -n "$TEST_PG_URL" ]] && pgs="yes"; [[ -n "$TEST_MYSQL_URL" ]] && mys="yes"
    log "Tests: database-free always; Postgres tests: $pgs; MySQL tests: $mys"
    ( cd "$REPO" && TEST_PG_URL="$TEST_PG_URL" TEST_MYSQL_URL="$TEST_MYSQL_URL" npm test --silent ) >"$WORK/test.out" 2>&1 || true
    cat "$WORK/test.out" >>"$LOG_FILE"
    local t p f sk
    t="$(grep -E '^# tests ' "$WORK/test.out" | awk '{print $3}')"; p="$(grep -E '^# pass ' "$WORK/test.out" | awk '{print $3}')"
    f="$(grep -E '^# fail ' "$WORK/test.out" | awk '{print $3}')"; sk="$(grep -E '^# skipped ' "$WORK/test.out" | awk '{print $3}')"
    log "  tests=${t:-?} pass=${p:-?} fail=${f:-?} skipped=${sk:-?}"
    [[ -n "$t" && "${f:-1}" == "0" && "${t:-0}" -gt 0 ]] || die $E_VERIFY "tests failed or did not run (see $LOG_FILE)"
  fi
  log "VERIFY OK."
}

do_self_test() {
  local tmp="$WORK/selftest" fails=0 S BR rc
  mkdir -p "$tmp"
  git clone -q --local "$REPO" "$tmp/repo" || die $E_PREREQ "Could not clone $REPO for the self-test"
  mkdir -p "$tmp/repo/scripts"; cp "$SCRIPT_PATH" "$tmp/repo/scripts/u.sh"
  # The baseline of this upgrade is your CURRENT files (the images upgrade may not be committed yet):
  # mirror them into the clone so the test exercises your real starting point.
  while IFS=$'\t' read -r kind rel; do
    if [[ "$kind" == "M" && -f "$REPO/$rel" ]]; then mkdir -p "$tmp/repo/$(dirname "$rel")"; cp "$REPO/$rel" "$tmp/repo/$rel"; fi
  done <"$FILES"
  S="$tmp/repo/scripts/u.sh"; BR="$tmp/bk"
  local R="$tmp/repo"
  run() { bash "$S" --repo "$R" --backup-root "$BR" "$@" >"$tmp/out.txt" 2>&1; rc=$?; cat "$tmp/out.txt" >>"$LOG_FILE"; return $rc; }
  check() { # name, expected rc, args...
    local name="$1" want="$2"; shift 2; rc=0; run "$@" || rc=$?
    if [[ $rc -eq $want ]]; then log "  PASS  $name (exit $rc)"; else log "  FAIL  $name (exit $rc, wanted $want)"; fails=$((fails+1)); fi
  }
  ok() { if eval "$2"; then log "  PASS  $1"; else log "  FAIL  $1"; fails=$((fails+1)); fi; }

  log "Self-test on a disposable clone that mirrors your current files (your working tree is not touched):"
  check "audit reports ready"                 0 --audit
  if [[ $fails -ne 0 ]]; then
    tail -12 "$tmp/out.txt" | sed -E 's/^\[[^]]*\] //' >&2
    die $E_PREREQ "The starting point does not match. Apply upgrade_sweety_api_images.sh first (this upgrade builds on it), then re-run --self-test."
  fi
  check "dry-run"                             0 --dry-run
  ok    "dry-run wrote nothing"               '[[ ! -e "$R/db/migrate.js" ]]'
  check "apply"                               0 --apply
  check "apply again is a no-op"              0 --apply
  ok    "second apply said already applied"   'grep -q "Already applied" "$tmp/out.txt"'
  check "verify (hashes + syntax)" 0 --verify
  # simulate the user's own work after the upgrade
  local conflict_file="db/splitSql.js" f
  echo "# unrelated user note" >>"$R/README.md"; echo "mine" >"$R/unrelated_user_file.txt"
  cp "$R/$conflict_file" "$tmp/conflict.bak"; printf '\n// user edit\n' >>"$R/$conflict_file"
  check "restore detects the post-upgrade user edit" $E_RESTORE --restore
  ok    "user's edited file was kept"         'grep -q "user edit" "$R/$conflict_file"'
  ok    "unrelated edits preserved"           'grep -q "unrelated user note" "$R/README.md" && [[ -f "$R/unrelated_user_file.txt" ]]'
  cp "$tmp/conflict.bak" "$R/$conflict_file"
  check "restore completes after conflict resolved" 0 --restore
  local bad=0
  while IFS=$'\t' read -r kind rel; do
    [[ "$kind" == "M" && "$(sha_of "$R/$rel")" != "$(base_sha "$rel")" ]] && bad=$((bad+1))
    [[ "$kind" == "N" && -e "$R/$rel" ]] && bad=$((bad+1))
  done <"$FILES"
  ok    "every touched file is back to its baseline; created files removed" '[[ $bad -eq 0 ]]'
  ok    "unrelated edits still preserved"     'grep -q "unrelated user note" "$R/README.md" && [[ -f "$R/unrelated_user_file.txt" ]]'
  # interrupted-run recovery
  check "re-apply after restore"              0 --apply
  local lastm; lastm="$(ls -1d "$BR"/*_"$UPGRADE_NAME" | sort | tail -1)/manifest.tsv"
  sed -i 's/^#meta\tstatus\tAPPLIED$/#meta\tstatus\tINCOMPLETE/' "$lastm"
  check "restore recovers an INCOMPLETE run"  0 --restore
  if [[ $fails -eq 0 ]]; then log "SELF-TEST PASSED: apply, idempotency, conflict detection, restore and recovery all work."
  else die $E_VERIFY "SELF-TEST FAILED ($fails check(s)); do NOT use --apply. See $LOG_FILE"; fi
}

case "$MODE" in
  self-test) do_self_test ;;
  audit)   do_audit ;;
  dry-run) do_dry_run ;;
  apply)   do_apply ;;
  verify)  do_verify ;;
  restore) do_restore ;;
esac
exit $?

__PAYLOAD_BELOW__
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
