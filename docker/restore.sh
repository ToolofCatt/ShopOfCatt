#!/bin/sh
# Chỉ nhận dump tin cậy do backup.sh tạo. SQL dump có thể thực thi lệnh psql;
# diễn tập kiểm tính hợp lệ, KHÔNG phải sandbox cho file đến từ người lạ.
set -eu
umask 077
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=docker/env.sh
. "$SCRIPT_DIR/env.sh"

usage() {
  printf 'Cach dung: %s [--rehearsal | --no-start] FILE.sql.gz\n' "$0" >&2
  printf '  --rehearsal: chi kiem gzip/SQL trong DB tam; khong dung hay sua target.\n' >&2
  printf '  --no-start: phuc hoi target nhung giu api/web/backup dung de doi soat.\n' >&2
}
MODE=restore FILE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --rehearsal|--no-start) [ "$MODE" = restore ] || { usage; exit 2; }; MODE=${1#--} ;;
    -h|--help) usage; exit 0 ;;
    -*) usage; exit 2 ;;
    *) [ -z "$FILE" ] || { usage; exit 2; }; FILE=$1 ;;
  esac
  shift
done
[ -n "$FILE" ] && [ -f "$FILE" ] || { usage; exit 2; }
fail() { printf '[restore] %s\n' "$*" >&2; exit 1; }
DB=${POSTGRES_DB:-$(env_value POSTGRES_DB)}; DB=${DB:-webcatt}
DB_USER=${POSTGRES_USER:-$(env_value POSTGRES_USER)}; DB_USER=${DB_USER:-postgres}
# Biến chỉ dùng làm argument, không ghép vào SQL; vẫn chặn tên bất thường để
# không khôi phục nhầm database hoặc truyền option tới client PostgreSQL.
for identifier in "$DB" "$DB_USER"; do
  case "$identifier" in ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) fail 'POSTGRES_DB/POSTGRES_USER chi duoc gom chu, so, dau gach duoi.' ;; esac
  [ "${#identifier}" -le 63 ] || fail 'Ten PostgreSQL qua dai.'
done
case "$DB" in postgres|template0|template1|webcatt_restore_*) fail 'Tu choi target database he thong/DB dien tap.' ;; esac

WORK=$(mktemp -d "${TMPDIR:-/tmp}/webcatt-restore.XXXXXXXX")
REHEARSAL="" STOPPED=false
cleanup() {
  rc=$?
  trap - EXIT
  if [ -n "$REHEARSAL" ]; then
    if ! docker compose exec -T postgres dropdb -U "$DB_USER" --if-exists "$REHEARSAL"; then
      printf '[restore] Khong xoa duoc DB tam %s; can don thu cong.\n' "$REHEARSAL" >&2
      rc=1
    fi
  fi
  rm -rf "$WORK"
  if [ "$rc" -ne 0 ]; then
    if [ "$STOPPED" = true ]; then
      printf '!! PHUC HOI THAT BAI - KHONG tu khoi dong api/web/backup. Giu writer dung de doi soat.\n' >&2
    else
      printf '!! Preflight that bai - chua thay doi target, khong tu restart dich vu.\n' >&2
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Copy một lần vào thư mục private trước khi kiểm: file nguồn bị thay thế sau
# preflight không thể khiến rehearsal và target nhận hai bản SQL khác nhau.
cp "$FILE" "$WORK/input.sql.gz" || fail 'Khong copy duoc ban dump.'
gzip -t "$WORK/input.sql.gz" || fail 'File gzip hong.'
gzip -dc "$WORK/input.sql.gz" > "$WORK/dump.sql" || fail 'Giai nen that bai.'
rm "$WORK/input.sql.gz"
# Không dùng gunzip | psql hay tail | grep: POSIX sh có thể che mã lỗi đầu pipe.
awk '
  /^-- PostgreSQL database dump complete([[:space:]]|$)/ { marker=NR }
  END { exit !(marker && NR-marker <= 20) }
' "$WORK/dump.sql" || fail 'Dump thieu end marker PostgreSQL.'
chmod 400 "$WORK/dump.sql"

# template0 tránh kế thừa bảng/extension từ một template1 đã được chỉnh sửa.
REHEARSAL_NAME="webcatt_restore_$(date -u +%Y%m%d%H%M%S)_${WORK##*.}"
printf '[1/5] Dien tap SQL vao DB tam %s...\n' "$REHEARSAL_NAME"
docker compose exec -T postgres createdb -U "$DB_USER" -T template0 "$REHEARSAL_NAME" || fail 'Khong tao duoc DB dien tap.'
# Chỉ cleanup DB mà chính lần chạy này tạo thành công. createdb thất bại vì
# trùng tên/quyền không được biến thành dropdb của dữ liệu đã có.
REHEARSAL=$REHEARSAL_NAME
docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$REHEARSAL" \
  --single-transaction -f - < "$WORK/dump.sql" || fail 'SQL dien tap that bai.'
COUNTS='SELECT (SELECT count(*) FROM "StockItem") AS kho, (SELECT count(*) FROM "Order") AS don, (SELECT count(*) FROM "User") AS nguoi_dung;'
docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$REHEARSAL" \
  -At -c "$COUNTS" > "$WORK/expected.counts" || fail 'Khong doc duoc bang nghiep vu trong dump.'
docker compose exec -T postgres dropdb -U "$DB_USER" "$REHEARSAL" || fail 'Khong xoa duoc DB dien tap.'
REHEARSAL=""
if [ "$MODE" = rehearsal ]; then
  printf 'Dien tap dat. Target va dich vu chua bi thay doi; counts (kho|don|nguoi_dung):\n'
  cat "$WORK/expected.counts"
  exit 0
fi

printf "Se XOA schema public cua CSDL '%s' va nap dump da dien tap.\n" "$DB"
printf "Go 'YES' de xac nhan: "
read -r answer || fail 'Khong nhan duoc xac nhan.'
[ "$answer" = YES ] || fail 'Da huy; target chua bi thay doi.'
printf '[2/5] Dung writer va worker backup...\n'
STOPPED=true
docker compose stop api web backup || fail 'Dung dich vu that bai.'
# Backup cuối sau khi writer dừng; thất bại thì không được xóa dữ liệu target.
printf '[3/5] Sao luu target hien tai bang backup.sh --once...\n'
docker compose run --rm --no-deps backup --once || fail 'Backup truoc restore that bai.'
printf '[4/5] Thay schema va nap cung artifact SQL trong mot transaction...\n'
docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" \
  --single-transaction -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' -f - \
  < "$WORK/dump.sql" || fail 'Nap target that bai.'
printf '[5/5] Doi chieu counts voi DB dien tap...\n'
docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" \
  -At -c "$COUNTS" > "$WORK/actual.counts" || fail 'Doi chieu target that bai.'
cmp -s "$WORK/expected.counts" "$WORK/actual.counts" || fail 'Counts target khong khop DB dien tap.'
if [ "$MODE" = no-start ]; then
  printf 'Restore dat; api/web/backup van DUNG. Doi soat truoc khi start thu cong.\n'
else
  docker compose start api web backup || fail 'Khoi dong dich vu that bai; kiem tra thu cong.'
  printf 'Restore dat, da khoi dong api/web/backup. Kiem tra health va doi soat nghiep vu.\n'
fi
