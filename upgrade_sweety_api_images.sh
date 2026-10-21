#!/usr/bin/env bash
# =============================================================================
# upgrade_sweety_api_images.sh   (nodejs_middleware / sweety-api)
#
# Stores product images in PostgreSQL and removes the need for the separate image
# server:  new /api/v1/student/productImage endpoints, a migration tool for existing
# images, and fixes for the confirmed API defects (see --help).
# Self-contained: the exact, tested change set is embedded at the end of this file
# and pinned by SHA-256 (PAYLOAD_SHA256). Nothing is committed, pushed, deployed, and
# NO database is touched by this script (the API creates its table itself on first use,
# or you run sql/001_product_images.sql).
#
# Modes:  --audit | --dry-run | --apply | --verify | --self-test | --restore [ID] | --help
# Safety: backups live OUTSIDE the repo; manifest records paths/hashes/modes;
#         never runs git reset/clean/checkout/commit/push.
# =============================================================================
set -Eeuo pipefail
umask 077

readonly SCRIPT_VERSION="1.0.0"
readonly UPGRADE_NAME="sweety-api-images"
readonly EXPECTED_BASE_COMMIT="5be62f40c958fe9594317723a467fe438b68572c"
readonly PAYLOAD_SHA256="c27863af6ac026a4ef4583e9dc887dbe29b211caa031c24fd2400579f4df4430"

# exit codes
readonly E_OK=0 E_USAGE=1 E_PREREQ=2 E_NOREPO=3 E_CONFLICT=4 E_APPLY=5 E_RESTORE=6 E_VERIFY=7 E_LOCK=8

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
MODE=""; RESTORE_ID=""; REPO=""; RUN_TESTS=0; TEST_DB_URL=""; BACKUP_ROOT=""
WORK="" ; LOG_FILE=""

usage() {
  cat <<'EOF'
Usage: ./upgrade_sweety_api_images.sh <mode> [options]        (run from the nodejs_middleware repo)

Modes (exactly one):
  --audit            Read-only report: prerequisites, git state, per-file status
                     (pristine / already-upgraded / user-modified / missing).
  --dry-run          Show what --apply would back up, patch and create. Writes nothing.
  --apply            Back up originals, apply the change set, verify result hashes.
                     Safe to re-run: reports "already applied" and does nothing.
  --verify           Check the repo matches the upgrade, syntax-check every changed JS file
                     (node --check) and, with --test, run the test suite.
  --restore [ID]     Undo THIS upgrade only (default: newest applied/interrupted run). Files
                     changed by you after --apply are reported as conflicts and left untouched.
  --self-test        Proves apply/idempotency/verify/conflict-detection/restore on a throw-away
                     clone of HEAD. Never touches your working tree. Run this first.
  --help             This text.

Options:
  --repo PATH        Repo root (default: auto-detected: script dir, its parent, or the current dir).
  --backup-root DIR  Where backups/manifests/logs go (default: <repo>.upgrade-backups next to the
                     repo; must be outside the repo). Env: SWEETY_BACKUP_ROOT.
  --test             (--verify) run `npm test` (Node 22+). The database-free tests always run.
  --test-db URL      (--verify) also run the database tests against a SCRATCH Postgres
                     (postgres://user:pw@host:5432/scratch_db). They create and drop their own
                     schema; never point this at production data.

What changes (4 files edited, 12 created):
  NEW  controller/productImageController.js, routes/productImageRoutes.js, utils/imageValidation.js,
       sql/001_product_images.sql (table product_images, bytea), utils/imageImport.js +
       scripts/import_product_images.mjs (migrates the old image-server files), test/*
  EDIT routes/studentsRoutes.js  mounts the endpoints; /uploadImages and /addNewCandy_with_image
                                 (both could never work) now answer 410 with a pointer
       utils/ControllerHandler.js the "Postgres tier" ran on the MySQL connection; made explicit (off)
       index.js                  /upload sent two responses on "no files"; fixed
       package.json              adds a "test" script only (no new dependencies)

New API (base /api/v1/student, no auth, same as the rest of the API):
  POST|PUT /productImage/:productId   multipart, exactly one file (any field name), JPEG/PNG/WebP, <= 5 MB
  GET      /productImage/:productId   the image bytes (ETag, 304 support) - usable directly in <img src>
  GET      /productImage/:productId/meta     JSON metadata
  GET      /productImages                    JSON list (which products have images)
  DELETE   /productImage/:productId

Environment: IMAGE_AUTO_MIGRATE=0 disables the automatic CREATE TABLE IF NOT EXISTS.

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
    --test-db) TEST_DB_URL="${2:?--test-db needs a postgres:// URL}"; RUN_TESTS=1; shift ;;
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
  [[ -f "$WORK/p/changes.patch" && -f "$WORK/p/files.tsv" && -f "$WORK/p/expected.sha256" ]] || die $E_PREREQ "Payload is incomplete"
}
extract_payload
PATCH="$WORK/p/changes.patch"; FILES="$WORK/p/files.tsv"; EXPECT="$WORK/p/expected.sha256"

sha_of()   { sha256sum "$1" | awk '{print $1}'; }
mode_of()  { stat -c '%a' "$1"; }
expected_sha() { awk -v f="$1" '$2==f {print $1}' "$EXPECT"; }
head_blob_sha() { # sha256 of the file as committed in HEAD ("" if not in HEAD)
  git -C "$REPO" cat-file -e "HEAD:$1" 2>/dev/null && git -C "$REPO" show "HEAD:$1" | sha256sum | awk '{print $1}' || true
}

# classify one file: pristine | upgraded | modified | missing | exists-other
classify() { # $1 kind (M|N)  $2 relpath
  local kind="$1" rel="$2" abs="$REPO/$2" exp cur base
  exp="$(expected_sha "$rel")"
  if [[ ! -e "$abs" ]]; then echo "missing"; return; fi
  cur="$(sha_of "$abs")"
  [[ "$cur" == "$exp" ]] && { echo "upgraded"; return; }
  if [[ "$kind" == "M" ]]; then
    base="$(head_blob_sha "$rel")"
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
    log "Hint: inspect with  git -C '$REPO' diff -- <file>   (HEAD may have moved since the audit; send the current files if so)"
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
    local d; d="$(dirname "$rel")"; [[ -d "$REPO/$d" ]] || echo -e "D\t$d" >>"$man"
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
  log "NOT deployed. To go live YOU rebuild/redeploy sweety-api (this script never does). After deploy:"
  log "  1) the API creates table product_images itself on first use (or run sql/001_product_images.sql)"
  log "  2) migrate existing images:  node scripts/import_product_images.mjs --dir <old image folder>   (dry run first)"
  log "  3) check:  curl -ik https://<api-host>:8443/api/v1/student/productImages"
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
    if [[ -n "$TEST_DB_URL" ]]; then log "Tests: full suite incl. database tests against the scratch DB you gave"; else log "Tests: database-free tests only (add --test-db URL for the rest)"; fi
    ( cd "$REPO" && TEST_PG_URL="$TEST_DB_URL" npm test --silent ) >"$WORK/test.out" 2>&1 || true
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
  S="$tmp/repo/scripts/u.sh"; BR="$tmp/bk"
  local R="$tmp/repo"
  run() { bash "$S" --repo "$R" --backup-root "$BR" "$@" >"$tmp/out.txt" 2>&1; rc=$?; cat "$tmp/out.txt" >>"$LOG_FILE"; return $rc; }
  check() { # name, expected rc, args...
    local name="$1" want="$2"; shift 2; rc=0; run "$@" || rc=$?
    if [[ $rc -eq $want ]]; then log "  PASS  $name (exit $rc)"; else log "  FAIL  $name (exit $rc, wanted $want)"; fails=$((fails+1)); fi
  }
  ok() { if eval "$2"; then log "  PASS  $1"; else log "  FAIL  $1"; fails=$((fails+1)); fi; }

  log "Self-test on a disposable clone of HEAD (your working tree is not touched):"
  check "audit reports ready"                 0 --audit
  check "dry-run"                             0 --dry-run
  ok    "dry-run wrote nothing"               '[[ -z "$(git -C "$R" status --porcelain | grep -v "^?? scripts/")" ]]'
  check "apply"                               0 --apply
  check "apply again is a no-op"              0 --apply
  ok    "second apply said already applied"   'grep -q "Already applied" "$tmp/out.txt"'
  check "verify (hashes + syntax)" 0 --verify
  # simulate the user's own work after the upgrade
  local conflict_file="utils/imageValidation.js" f
  echo "# unrelated user note" >>"$R/README.md"; echo "mine" >"$R/unrelated_user_file.txt"
  cp "$R/$conflict_file" "$tmp/conflict.bak"; printf '\n// user edit\n' >>"$R/$conflict_file"
  check "restore detects the post-upgrade user edit" $E_RESTORE --restore
  ok    "user's edited file was kept"         'grep -q "user edit" "$R/$conflict_file"'
  ok    "unrelated edits preserved"           'grep -q "unrelated user note" "$R/README.md" && [[ -f "$R/unrelated_user_file.txt" ]]'
  cp "$tmp/conflict.bak" "$R/$conflict_file"
  check "restore completes after conflict resolved" 0 --restore
  local bad=0
  while IFS=$'\t' read -r kind rel; do
    [[ "$kind" == "M" ]] && { git -C "$R" diff --quiet -- "$rel" || bad=$((bad+1)); }
    [[ "$kind" == "N" && -e "$R/$rel" ]] && bad=$((bad+1))
  done <"$FILES"
  ok    "every touched file is back to HEAD; created files removed" '[[ $bad -eq 0 ]]'
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
L0/m+R+v8zTKABgBAA==
