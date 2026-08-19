-- Chủ shop tự rút key ra khỏi kho để thu hồi.
--
-- Trạng thái riêng chứ không xoá dòng: xoá là mất dấu vết, mà rút kho là thao
-- tác đụng tới hàng đã bỏ tiền mua. WITHDRAWN cũng KHÔNG phải SOLD — nếu dùng
-- SOLD thì doanh thu bị cộng thêm những đơn không tồn tại.
ALTER TYPE "StockStatus" ADD VALUE 'WITHDRAWN';

ALTER TABLE "StockItem" ADD COLUMN "withdrawnAt" TIMESTAMP(3);
