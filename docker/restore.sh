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

# Nạp .env như docker compose vẫn làm. Không nạp thì POSTGRES_USER/POSTGRES_DB ở
# đây rơi về mặc định, trong khi compose đã tạo CSDL bằng giá trị trong .env —
# phục hồi sẽ trỏ vào sai tên user hoặc sai database.
if [ -f .env ]; then
  # shellcheck disable=SC1091
  . ./.env
fi

DB="${POSTGRES_DB:-webcatt}"
USER="${POSTGRES_USER:-postgres}"

echo "Se khoi phuc '$FILE' vao CSDL '$DB'."
echo "TOAN BO du lieu hien tai se bi xoa."
printf "Go 'YES' de xac nhan: "
read -r answer
[ "$answer" = "YES" ] || { echo "Da huy."; exit 1; }

# Phục hồi hỏng giữa đường là CSDL trống rỗng. Dừng ở đây và nói thật to, tuyệt
# đối không đi tiếp tới bước khởi động lại api/web.
trap 'echo "" >&2; echo "!! PHUC HOI THAT BAI - api/web dang DUNG. CSDL co the dang do dang." >&2; echo "!! Dung file sao luu khac roi chay lai; DUNG khoi dong api khi chua xong." >&2' EXIT

echo "[1/4] Dung API va dich vu sao luu de khong ai ghi vao CSDL giua chung..."
# Phải dừng cả `backup`: nếu chu kỳ sao lưu nổ đúng lúc đang phục hồi, nó sẽ
# chụp một CSDL nửa vời và ghi đè lên chỗ bản tốt trong danh sách giữ lại.
docker compose stop api web backup

echo "[2/4] Xoa schema cu..."
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$USER" -d "$DB" \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

echo "[3/4] Nap ban sao luu..."
# ON_ERROR_STOP=1 là bắt buộc: không có nó, psql chạy tiếp qua mọi câu lệnh lỗi
# rồi trả về 0, và script này từng in "Xong." trên một CSDL nạp thiếu một nửa.
gunzip -c "$FILE" | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$USER" -d "$DB"

echo "[4/4] Doi chieu nhanh roi khoi dong lai dich vu..."
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$USER" -d "$DB" -c \
  'SELECT (SELECT count(*) FROM "StockItem") AS kho, (SELECT count(*) FROM "Order") AS don, (SELECT count(*) FROM "User") AS nguoi_dung;'

trap - EXIT
docker compose start api web backup

echo "Xong. So dong o tren phai khop voi luc truoc su co."
echo "Kiem tra tiep: docker compose logs -f api"
