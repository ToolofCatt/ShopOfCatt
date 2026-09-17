#!/bin/sh
# Chạy code vận hành thật nhưng thay Docker/pg_dump ở biên, không nối database.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT
REAL_GZIP=$(command -v gzip)
REAL_CHMOD=$(command -v chmod)
export REAL_GZIP REAL_CHMOD
mkdir -p "$FIXTURE/bin"
cat > "$FIXTURE/bin/docker" <<'EOF'
#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$CASE/docker.calls"
case "$*" in
  'volume ls '*) [ "${FAIL_STEP:-}" != inventory ] || exit 1; printf '%s' "${VOLUME_EXISTS:-}"; exit 0 ;;
  'ps -a '*) printf '%s' "${CONTAINER_EXISTS:-}"; exit 0 ;;
  'compose version') exit 0 ;;
  'compose stop '*) [ "${FAIL_STEP:-}" != stop ]; exit ;;
  'compose start '*) exit 0 ;;
  'compose run '*) [ "${FAIL_STEP:-}" != backup ]; exit ;;
  'compose exec -T postgres createdb '*) [ "${FAIL_STEP:-}" != createdb ]; exit ;;
  'compose exec -T postgres dropdb '*) [ "${FAIL_STEP:-}" != dropdb ]; exit ;;
  'compose exec -T postgres psql '*)
    case "$*" in *'-X -v ON_ERROR_STOP=1'*) ;; *) exit 92 ;; esac
    case "$*" in
      *'SELECT '*|*'SELECT\n'*)
        [ "${FAIL_STEP:-}" != counts ] || exit 1
        if [ "${FAIL_STEP:-}" = mismatch ]; then
          case "$*" in *'-d webcatt '*) printf '0|0|0\n'; exit 0 ;; esac
        fi
        printf '3|2|1\n'; exit 0 ;;
      *'DROP SCHEMA'*'-f -'*)
        cat > "$CASE/target.sql"
        [ "${FAIL_STEP:-}" != target ]; exit ;;
      *'DROP SCHEMA'*) [ "${FAIL_STEP:-}" != target ]; exit ;;
    esac
    case "$*" in
      *webcatt_restore_*)
        cat > "$CASE/rehearsal.sql"
        if [ "${MUTATE_SOURCE:-}" = true ]; then printf broken > "$CASE/input.sql.gz"; fi
        [ "${FAIL_STEP:-}" != rehearsal ]; exit ;;
      *) cat > "$CASE/target.sql"; [ "${FAIL_STEP:-}" != target ]; exit ;;
    esac ;;
esac
printf 'Unexpected docker fixture call\n' >&2
exit 91
EOF
cat > "$FIXTURE/bin/gzip" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$CASE/gzip.calls"
case "${GZIP_FAIL:-}:$*" in
  decompress:*'-d'*) printf 'partial SQL'; exit 1 ;;
  compress:*'-9'*) printf partial; exit 1 ;;
esac
exec "$REAL_GZIP" "$@"
EOF
cat > "$FIXTURE/bin/pg_dump" <<'EOF'
#!/bin/sh
cat "$CASE/source.sql"
[ "${DUMP_FAIL:-}" != true ]
EOF
cat > "$FIXTURE/bin/chmod" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$CASE/chmod.calls"
exec "$REAL_CHMOD" "$@"
EOF
cat > "$FIXTURE/bin/sleep" <<'EOF'
#!/bin/sh
# Bản cũ chạy daemon; dừng sau một lượt để test không treo.
exit 87
EOF
chmod +x "$FIXTURE/bin/"*
export PATH="$FIXTURE/bin:$PATH"
new_case() {
  CASE="$FIXTURE/$1"; export CASE
  mkdir -p "$CASE/docker" "$CASE/backups" "$CASE/backup-status" "$CASE/tmp"
  cp "$ROOT/docker/restore.sh" "$ROOT/docker/backup.sh" "$CASE/docker/"
  [ ! -f "$ROOT/docker/env.sh" ] || cp "$ROOT/docker/env.sh" "$CASE/docker/"
  cp "$ROOT/install.sh" "$ROOT/storectl" "$CASE/"
  printf 'POSTGRES_USER=postgres\nPOSTGRES_DB=webcatt\n' > "$CASE/.env"
  printf '%s\n' '-- PostgreSQL database dump' 'CREATE TABLE "StockItem" (id text);' '-- PostgreSQL database dump complete' '--' > "$CASE/source.sql"
  "$REAL_GZIP" -c "$CASE/source.sql" > "$CASE/input.sql.gz"
  : > "$CASE/docker.calls"; : > "$CASE/gzip.calls"; : > "$CASE/chmod.calls"
  unset FAIL_STEP GZIP_FAIL DUMP_FAIL MUTATE_SOURCE VOLUME_EXISTS CONTAINER_EXISTS BACKUP_KEEP
}
restore() {
  status=0
  (cd "$CASE" && printf 'YES\n' | TMPDIR="$CASE/tmp" sh docker/restore.sh "$@") > "$CASE/output" 2>&1 || status=$?
}
backup() {
  status=0
  (cd "$CASE" && BACKUP_DIR="$CASE/backups" BACKUP_HEARTBEAT_DIR="$CASE/backup-status" sh docker/backup.sh --once) > "$CASE/output" 2>&1 || status=$?
}
fail() { printf 'FAIL: %s\n' "$*" >&2; return 1; }
no_target_writes() { ! grep -Eq 'compose (stop|start|run)|DROP SCHEMA' "$CASE/docker.calls" || fail 'preflight touched target/services'; }
no_restart() { ! grep -q 'compose start' "$CASE/docker.calls" || fail 'error restarted services'; }
failed() { [ "$status" -ne 0 ] || fail 'expected nonzero status'; }
passed=0; failed_count=0
run() {
  set +e
  (set -e; "$1")
  result=$?
  set -e
  if [ "$result" -eq 0 ]; then printf 'PASS: %s\n' "$1"; passed=$((passed + 1));
  else printf 'FAIL: %s\n' "$1"; failed_count=$((failed_count + 1)); fi
}
# Mỗi nhánh trả lỗi phải thắng trước stop/drop/start, không chỉ in cảnh báo.
corrupt_gzip() { new_case corrupt; printf broken > "$CASE/input.sql.gz"; restore input.sql.gz; failed; no_target_writes; }
missing_endmarker() { new_case truncated; printf 'CREATE TABLE partial();\n' | "$REAL_GZIP" > "$CASE/input.sql.gz"; restore input.sql.gz; failed; no_target_writes; }
decompression_failure() { new_case decompress; GZIP_FAIL=decompress; export GZIP_FAIL; restore input.sql.gz; failed; no_target_writes; }
sql_rehearsal_failure() { new_case invalidsql; FAIL_STEP=rehearsal; export FAIL_STEP; restore input.sql.gz; failed; grep -q webcatt_restore_ "$CASE/docker.calls"; no_target_writes; }
rehearsal_only() { new_case rehearsal; restore --rehearsal input.sql.gz; [ "$status" -eq 0 ]; cmp "$CASE/source.sql" "$CASE/rehearsal.sql"; no_target_writes; }
immutable_no_start() {
  new_case immutable; MUTATE_SOURCE=true; export MUTATE_SOURCE
  restore --no-start input.sql.gz; [ "$status" -eq 0 ]
  cmp "$CASE/source.sql" "$CASE/rehearsal.sql"; cmp "$CASE/source.sql" "$CASE/target.sql"
  [ "$(grep -c -- '-dc\|-cd' "$CASE/gzip.calls")" -eq 1 ]
  no_restart
  grep -q -- '--single-transaction -c DROP SCHEMA public CASCADE; CREATE SCHEMA public; -f -' "$CASE/docker.calls"
  awk '/webcatt_restore_.*psql|psql.*webcatt_restore_/ { rehearsal=NR } /compose stop/ { stop=NR } /compose run/ { backup=NR } /DROP SCHEMA/ { target=NR } END { exit !(rehearsal && rehearsal < stop && stop < backup && backup < target) }' "$CASE/docker.calls"
  [ -z "$(ls -A "$CASE/tmp")" ]
}
restore_failures_no_restart() {
  for step in stop backup target counts mismatch createdb dropdb; do
    new_case "failure-$step"; FAIL_STEP=$step; export FAIL_STEP
    restore input.sql.gz; failed; no_restart
  done
}
restore_success() { new_case success; restore input.sql.gz; [ "$status" -eq 0 ]; grep -q 'compose start api web backup' "$CASE/docker.calls"; }
env_is_data() {
  new_case env
  printf '%s\n' 'NEXT_PUBLIC_SITE_NAME=Catt Store' 'IGNORED=$(touch env-executed)' "POSTGRES_DB='webcatt'" 'POSTGRES_USER="postgres"' >> "$CASE/.env"
  restore --rehearsal input.sql.gz; [ "$status" -eq 0 ]; [ ! -e "$CASE/env-executed" ]; grep -q -- '-U postgres' "$CASE/docker.calls"
}
dump_nonzero_after_endmarker() { new_case dumpfailed; DUMP_FAIL=true; export DUMP_FAIL; backup; failed; [ ! -f "$CASE/backup-status/.last-success.json" ]; [ -z "$(ls -A "$CASE/backups")" ]; }
backup_gzip_failure() { new_case gzipfailed; GZIP_FAIL=compress; export GZIP_FAIL; backup; failed; [ ! -f "$CASE/backup-status/.last-success.json" ]; [ -z "$(ls -A "$CASE/backups")" ]; }
backup_private_heartbeat_public() {
  new_case backupok; backup; [ "$status" -eq 0 ]
  [ -f "$CASE/backup-status/.last-success.json" ]; [ ! -f "$CASE/backups/.last-success.json" ]
  grep -q '^700 .*backups' "$CASE/chmod.calls"; grep -q '^600 .*sql.gz' "$CASE/chmod.calls"
  grep -q '^755 .*backup-status' "$CASE/chmod.calls"; grep -q '^644 .*backup-status' "$CASE/chmod.calls"
  for f in "$CASE/backups/"*.sql.gz; do "$REAL_GZIP" -t "$f"; done
  case "$(uname -s)" in
    Linux)
      [ "$(stat -c %a "$CASE/backups")" = 700 ]
      [ "$(stat -c %a "$f")" = 600 ]
      [ "$(stat -c %a "$CASE/backup-status")" = 755 ]
      [ "$(stat -c %a "$CASE/backup-status/.last-success.json")" = 644 ] ;;
    *) printf 'NOTE: chmod calls checked; POSIX mode enforcement requires Linux.\n' ;;
  esac
}
install_existing_env_untouched() {
  new_case reinstall; cp "$CASE/.env" "$CASE/expected.env"; status=0
  (cd "$CASE" && sh install.sh --non-interactive --domain store.example --admin-email test@example.com) > "$CASE/output" 2>&1 || status=$?
  failed; cmp "$CASE/.env" "$CASE/expected.env"; grep -q 'Existing .env' "$CASE/output"; [ ! -s "$CASE/docker.calls" ]
}
install_existing_volume_untouched() {
  new_case orphaned; rm "$CASE/.env"; VOLUME_EXISTS=webcatt_webcatt_pgdata; export VOLUME_EXISTS; status=0
  (cd "$CASE" && sh install.sh --non-interactive --domain store.example --admin-email test@example.com) > "$CASE/output" 2>&1 || status=$?
  failed; [ ! -e "$CASE/.env" ]; grep -q 'Existing deployment' "$CASE/output"; ! grep -q 'compose up' "$CASE/docker.calls"
}
create_failure_does_not_drop_existing_db() {
  new_case createfailed; FAIL_STEP=createdb; export FAIL_STEP; restore --rehearsal input.sql.gz
  failed; no_target_writes; ! grep -q ' dropdb ' "$CASE/docker.calls"
}
backup_failure_keeps_last_good() {
  new_case retainfailed; printf 'old heartbeat\n' > "$CASE/backup-status/.last-success.json"
  cp "$CASE/input.sql.gz" "$CASE/backups/webcatt-20000101-000000.sql.gz"
  cp "$CASE/backup-status/.last-success.json" "$CASE/expected.json"
  DUMP_FAIL=true; export DUMP_FAIL; backup; failed
  cmp "$CASE/expected.json" "$CASE/backup-status/.last-success.json"
  cmp "$CASE/input.sql.gz" "$CASE/backups/webcatt-20000101-000000.sql.gz"
}
backup_retention_only_after_success() {
  new_case retention; BACKUP_KEEP=2; export BACKUP_KEEP
  for stamp in 20000101 20000102 20000103; do cp "$CASE/input.sql.gz" "$CASE/backups/webcatt-$stamp-000000.sql.gz"; done
  printf unrelated > "$CASE/backups/keep-me.txt"
  backup; [ "$status" -eq 0 ]; [ ! -f "$CASE/backups/webcatt-20000101-000000.sql.gz" ]; [ ! -f "$CASE/backups/webcatt-20000102-000000.sql.gz" ]
  [ -f "$CASE/backups/webcatt-20000103-000000.sql.gz" ]; [ -f "$CASE/backups/keep-me.txt" ]
}
backup_rejects_embedded_heartbeat() {
  new_case embedded; status=0
  (BACKUP_DIR="$CASE/backups" BACKUP_HEARTBEAT_DIR="$CASE/backups/status" sh "$CASE/docker/backup.sh" --once) > "$CASE/output" 2>&1 || status=$?
  failed; ! grep -q '^755 .*backups' "$CASE/chmod.calls"
}
install_inventory_error_is_closed() {
  new_case inventoryfailed; rm "$CASE/.env"; FAIL_STEP=inventory; export FAIL_STEP; status=0
  (cd "$CASE" && sh install.sh --non-interactive --domain store.example --admin-email test@example.com) > "$CASE/output" 2>&1 || status=$?
  failed; [ ! -e "$CASE/.env" ]; grep -q 'Cannot inspect existing volumes' "$CASE/output"; ! grep -q 'compose up' "$CASE/docker.calls"
}
storectl_backup_error_propagates() {
  new_case ctlbackup; FAIL_STEP=backup; export FAIL_STEP; status=0
  sh "$CASE/storectl" backup > "$CASE/output" 2>&1 || status=$?
  failed; grep -qx 'compose run --rm --no-deps backup --once' "$CASE/docker.calls"
}
storectl_restore_forwards_rehearsal() {
  new_case ctlrestore; status=0
  sh "$CASE/storectl" restore --rehearsal input.sql.gz > "$CASE/output" 2>&1 || status=$?
  [ "$status" -eq 0 ]; cmp "$CASE/source.sql" "$CASE/rehearsal.sql"; no_target_writes
}
backup_concurrent_attempt_is_closed() {
  new_case concurrent; mkdir "$CASE/backups/.backup.lock"
  backup; failed
  [ ! -e "$CASE/backup-status/.last-success.json" ]; [ -d "$CASE/backups/.backup.lock" ]
  set -- "$CASE/backups/"*.sql.gz; [ ! -f "$1" ]
}
for test in corrupt_gzip missing_endmarker decompression_failure sql_rehearsal_failure rehearsal_only immutable_no_start restore_failures_no_restart restore_success env_is_data dump_nonzero_after_endmarker backup_gzip_failure backup_private_heartbeat_public install_existing_env_untouched install_existing_volume_untouched create_failure_does_not_drop_existing_db backup_failure_keeps_last_good backup_retention_only_after_success backup_rejects_embedded_heartbeat install_inventory_error_is_closed storectl_backup_error_propagates storectl_restore_forwards_rehearsal backup_concurrent_attempt_is_closed; do run "$test"; done
printf '\nOps fixtures: %s passed, %s failed\n' "$passed" "$failed_count"
[ "$failed_count" -eq 0 ]
