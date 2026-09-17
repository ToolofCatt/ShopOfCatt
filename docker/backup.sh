#!/bin/sh
# StockItem là hàng hóa: dump chỉ được công bố khi mọi bước thành công.
# Không pipe pg_dump | gzip: POSIX sh có thể che lỗi pg_dump dù có end marker.
set -eu
umask 077
: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=webcatt}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_HEARTBEAT_DIR:=/backup-status}"
: "${BACKUP_KEEP:=14}"
: "${BACKUP_INTERVAL:=86400}"
export POSTGRES_HOST POSTGRES_USER POSTGRES_DB BACKUP_DIR BACKUP_HEARTBEAT_DIR BACKUP_KEEP BACKUP_INTERVAL
for number in "$BACKUP_KEEP" "$BACKUP_INTERVAL"; do
  case "$number" in ''|*[!0-9]*|0|0*) printf '[backup] So luong/chu ky phai la so nguyen duong.\n' >&2; exit 2 ;; esac
done
case "${1:-}" in
  '')
    printf '[backup] Chu ky %ss, giu %s ban.\n' "$BACKUP_INTERVAL" "$BACKUP_KEEP"
    # Child shell riêng giữ set -e hoạt động: gọi function trong `|| true`
    # vô hiệu errexit bên trong function và từng biến lỗi ghi file thành OK.
    while true; do
      if sh "$0" --once; then :; else printf '[backup] THAT BAI; khong cap nhat heartbeat.\n' >&2; fi
      sleep "$BACKUP_INTERVAL"
    done ;;
  --once) [ "$#" -eq 1 ] || exit 2 ;;
  *) printf 'Usage: backup.sh [--once]\n' >&2; exit 2 ;;
esac

mkdir -p "$BACKUP_DIR" "$BACKUP_HEARTBEAT_DIR"
BACKUP_DIR=$(CDPATH= cd -- "$BACKUP_DIR" && pwd)
BACKUP_HEARTBEAT_DIR=$(CDPATH= cd -- "$BACKUP_HEARTBEAT_DIR" && pwd)
case "$BACKUP_HEARTBEAT_DIR/" in "$BACKUP_DIR/"*) printf '[backup] Heartbeat phai nam NGOAI thu muc dump.\n' >&2; exit 2 ;; esac
case "$BACKUP_DIR/" in "$BACKUP_HEARTBEAT_DIR/"*) printf '[backup] Thu muc dump khong duoc nam trong mount heartbeat.\n' >&2; exit 2 ;; esac
chmod 700 "$BACKUP_DIR"
chmod 755 "$BACKUP_HEARTBEAT_DIR"
# Worker định kỳ và --once có thể trùng nhau. Serial hóa cả heartbeat/retention,
# không tự cướp khóa còn lại sau crash vì không biết tiến trình kia đã dừng chưa.
LOCK="$BACKUP_DIR/.backup.lock"
mkdir "$LOCK" 2>/dev/null || { printf '[backup] Dang co backup/lock. Chi xoa .backup.lock sau khi xac minh khong con worker.\n' >&2; exit 1; }
WORK="" HEARTBEAT_TMP=""
cleanup() {
  rc=$?
  trap - EXIT
  [ -z "$WORK" ] || rm -rf "$WORK"
  [ -z "$HEARTBEAT_TMP" ] || rm -f "$HEARTBEAT_TMP"
  rmdir "$LOCK" || rc=1
  [ "$rc" -eq 0 ] || printf '[backup] THAT BAI; dump chua xac minh khong duoc cong bo.\n' >&2
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
WORK=$(mktemp -d "$BACKUP_DIR/.backup.XXXXXXXX")

pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --no-acl > "$WORK/dump.sql"
awk '
  /^-- PostgreSQL database dump complete([[:space:]]|$)/ { marker=NR }
  END { exit !(marker && NR-marker <= 20) }
' "$WORK/dump.sql"
gzip -9 -c "$WORK/dump.sql" > "$WORK/dump.sql.gz"
gzip -t "$WORK/dump.sql.gz"
chmod 600 "$WORK/dump.sql.gz"
stamp=$(date -u +%Y%m%d-%H%M%S)
# Suffix mktemp tránh hai lần --once trong cùng giây ghi đè một bản tốt.
name="webcatt-$stamp-${WORK##*.}.sql.gz"
target="$BACKUP_DIR/$name"
mv "$WORK/dump.sql.gz" "$target"

# Chỉ metadata vô hại được API node đọc. KHÔNG chmod dump thành world-readable.
HEARTBEAT_TMP=$(mktemp "$BACKUP_HEARTBEAT_DIR/.heartbeat.XXXXXXXX")
bytes=$(wc -c < "$target")
printf '{"completedAt":"%s","file":"%s","bytes":%s}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$name" "$bytes" > "$HEARTBEAT_TMP"
chmod 644 "$HEARTBEAT_TMP"
mv "$HEARTBEAT_TMP" "$BACKUP_HEARTBEAT_DIR/.last-success.json"
HEARTBEAT_TMP=""
printf '[backup] OK -> %s (%s bytes)\n' "$name" "$bytes"

# Tên UTC sắp xếp theo thời gian; glob không có pipeline che lỗi ls/rm.
# Không đụng file ngoài mẫu của worker, không cắt retention sau một dump lỗi.
LC_ALL=C; export LC_ALL
count=0
for old in "$BACKUP_DIR"/webcatt-*.sql.gz; do [ ! -f "$old" ] || count=$((count + 1)); done
for old in "$BACKUP_DIR"/webcatt-*.sql.gz; do
  [ "$count" -gt "$BACKUP_KEEP" ] || break
  [ -f "$old" ] || continue
  [ "$old" != "$target" ] || continue
  rm "$old"
  count=$((count - 1))
done
