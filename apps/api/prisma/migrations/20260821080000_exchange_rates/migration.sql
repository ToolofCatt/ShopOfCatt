-- Tỉ giá: tự cập nhật hàng ngày, và thêm CNY để hiện giá cho khách tiếng Trung.
--
-- vndPerUsdt đã có sẵn và vẫn là tỉ giá ĐANG DÙNG (đã cộng biên) — bật rateAuto
-- thì nó bị ghi lại mỗi ngày, tắt thì chủ shop tự nhập. Không thêm cột "tỉ giá
-- thô" riêng: giá trị thô được ghi vào rateSource dạng chữ để soi lại, còn mọi
-- chỗ tính tiền chỉ đọc đúng một cột nên không thể lệch nhau.
ALTER TABLE "StoreSetting"
  ADD COLUMN "cnyPerUsdt"        DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN "rateAuto"          BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN "rateMarkupPercent" DECIMAL(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN "rateUpdatedAt"     TIMESTAMP(3),
  ADD COLUMN "rateSource"        TEXT          NOT NULL DEFAULT '';
