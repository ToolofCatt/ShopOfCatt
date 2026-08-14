#!/bin/sh
# Sao lưu PostgreSQL định kỳ.
#
# Mỗi dòng trong bảng StockItem LÀ một sản phẩm (key/mã kích hoạt) — mất cơ sở
# dữ liệu là mất hàng hoá, không có cách nào dựng lại. Đây là lý do dịch vụ này
# tồn tại chứ không phải "cho có".
set -eu

# Trong sh, mã lỗi của một pipeline là mã lỗi của lệnh CUỐI. `pg_dump | gzip` mà
# pg_dump chết giữa đường thì gzip vẫn kết thúc thành công, nên nhánh `if` bên
# dưới từng báo OK cho một bản dump bị cắt cụt. Bật pipefail nếu shell hỗ trợ;
# phần kiểm tra sản phẩm ở dưới mới là hàng rào chính, vì nó bắt cả trường hợp
# hết đĩa giữa lúc gzip đang ghi.
# shellcheck disable=SC3040
(set -o pipefail 2>/dev/null) && set -o pipefail || true

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=webcatt}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_KEEP:=14}"          # số bản giữ lại
: "${BACKUP_INTERVAL:=86400}"   # giây giữa hai lần (mặc định 24 giờ)

mkdir -p "$BACKUP_DIR"

run_backup() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  target="$BACKUP_DIR/webcatt-$stamp.sql.gz"
  tmp="$target.partial"

  # Ghi ra file .partial rồi mới đổi tên: bản sao lưu nửa chừng (do container bị
  # dừng giữa lúc dump) sẽ không bị nhầm là bản hoàn chỉnh.
  if ! pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
       --no-owner --no-acl | gzip -9 > "$tmp"; then
    rm -f "$tmp"
    echo "[backup] $(date -u '+%F %T') THAT BAI - xem log postgres" >&2
    return 1
  fi

  # KIỂM TRA SẢN PHẨM TRƯỚC KHI PHONG LÀ BẢN HOÀN CHỈNH.
  # Mã lỗi một mình không đủ: chỉ cần shell không có pipefail, hoặc đĩa đầy đúng
  # lúc gzip đang ghi, là ta có một file .gz "thành công" nhưng thiếu dữ liệu.
  # Mỗi dòng StockItem là một món hàng — một bản sao lưu cắt cụt mà tưởng là tốt
  # còn tệ hơn không có bản nào, vì nó khiến ta yên tâm sai.
  if ! gzip -t "$tmp" 2>/dev/null; then
    rm -f "$tmp"
    echo "[backup] $(date -u '+%F %T') THAT BAI - file gz bi hong" >&2
    return 1
  fi
  # pg_dump ghi dòng "-- PostgreSQL database dump complete" ở cuối. Thiếu nó =
  # bản dump bị cắt. (Đọc 20 dòng cuối vì sau nó còn vài dòng meta của psql.)
  if ! gunzip -c "$tmp" | tail -20 | grep -q 'PostgreSQL database dump complete'; then
    rm -f "$tmp"
    echo "[backup] $(date -u '+%F %T') THAT BAI - ban dump bi cat cut, da xoa" >&2
    return 1
  fi

  mv "$tmp" "$target"
  echo "[backup] $(date -u '+%F %T') OK  -> $(basename "$target") ($(du -h "$target" | cut -f1))"

  # Dọn bản cũ, chỉ giữ $BACKUP_KEEP bản mới nhất
  count=$(ls -1 "$BACKUP_DIR"/webcatt-*.sql.gz 2>/dev/null | wc -l)
  if [ "$count" -gt "$BACKUP_KEEP" ]; then
    ls -1t "$BACKUP_DIR"/webcatt-*.sql.gz | tail -n +$((BACKUP_KEEP + 1)) | while read -r old; do
      rm -f "$old"
      echo "[backup] da xoa ban cu: $(basename "$old")"
    done
  fi
}

echo "[backup] Khoi dong. Chu ky ${BACKUP_INTERVAL}s, giu ${BACKUP_KEEP} ban, thu muc ${BACKUP_DIR}"
# Sao lưu ngay lần đầu để biết cấu hình có chạy không, thay vì đợi 24 giờ mới phát hiện sai.
while true; do
  run_backup || true
  sleep "$BACKUP_INTERVAL"
done
