#!/bin/sh
# Khôi phục cơ sở dữ liệu từ một bản sao lưu do dịch vụ `backup` tạo ra.
#
#   ./docker/restore.sh backups/webcatt-20260809-120000.sql.gz
#
# CẢNH BÁO: thao tác này XOÁ toàn bộ dữ liệu hiện tại rồi nạp lại từ bản sao lưu.
# Hãy diễn tập một lần trên máy thử TRƯỚC KHI cần dùng thật.
set -eu

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Cach dung: $0 <duong-dan-ban-sao-luu.sql.gz>" >&2
  echo "" >&2
  echo "Cac ban dang co:" >&2
  ls -1t backups/webcatt-*.sql.gz 2>/dev/null | head -20 >&2 || echo "  (chua co ban nao)" >&2
  exit 1
fi

DB="${POSTGRES_DB:-webcatt}"
USER="${POSTGRES_USER:-postgres}"

echo "Se khoi phuc '$FILE' vao CSDL '$DB'."
echo "TOAN BO du lieu hien tai se bi xoa."
printf "Go 'YES' de xac nhan: "
read -r answer
[ "$answer" = "YES" ] || { echo "Da huy."; exit 1; }

echo "[1/3] Dung API de khong ai ghi vao CSDL giua chung..."
docker compose stop api web

echo "[2/3] Xoa schema cu va nap ban sao luu..."
docker compose exec -T postgres psql -U "$USER" -d "$DB" \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c "$FILE" | docker compose exec -T postgres psql -U "$USER" -d "$DB"

echo "[3/3] Khoi dong lai dich vu..."
docker compose start api web

echo "Xong. Kiem tra: docker compose logs -f api"
