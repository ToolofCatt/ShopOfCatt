-- Tiền của đơn cũng cần SÁU chữ số thập phân.
--
-- Neo giá theo ₫ mới chỉ đúng ở bảng ProductVariant: tổng đơn vẫn bị cắt về hai
-- chữ số, nên đơn 100.000 ₫ ra 3.85 USDT rồi quy ngược lại thành 99.943 ₫ — và
-- 99.943 ₫ chính là số in trên mã QR chuyển khoản. Đo trên đơn thật:
--
--   1 món  → 3.85  USDT →  99.943 ₫  (mong 100.000)
--   2 món  → 7.70  USDT → 199.886 ₫  (mong 200.000)
--   3 món  → 11.56 USDT → 300.089 ₫  (mong 300.000)
--
-- Nới thêm chữ số chỉ làm cột chính xác hơn, không mất dữ liệu cũ.

ALTER TABLE "Order"
  ALTER COLUMN "subtotalAmount" TYPE DECIMAL(18,6),
  ALTER COLUMN "discountAmount" TYPE DECIMAL(18,6),
  ALTER COLUMN "totalAmount" TYPE DECIMAL(18,6);

ALTER TABLE "OrderItem" ALTER COLUMN "unitPrice" TYPE DECIMAL(18,6);

ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE DECIMAL(18,6);
