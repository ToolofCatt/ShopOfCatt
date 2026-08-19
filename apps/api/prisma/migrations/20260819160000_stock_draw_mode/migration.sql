-- Cách rút kho: cũ trước (như cũ) hoặc ngẫu nhiên.
--
-- Cần cho loại hàng mà mỗi key một khác — ví dụ tài khoản còn số ngày ngẫu
-- nhiên. Rút cũ trước thì khách mua sớm vét hết những key nạp đầu, còn khách
-- sau chỉ còn phần đuôi.
--
-- Mặc định SEQUENTIAL để mọi sản phẩm đang có giữ nguyên hành vi cũ.
CREATE TYPE "StockDrawMode" AS ENUM ('SEQUENTIAL', 'RANDOM');

ALTER TABLE "Product"
  ADD COLUMN "stockDrawMode" "StockDrawMode" NOT NULL DEFAULT 'SEQUENTIAL';
