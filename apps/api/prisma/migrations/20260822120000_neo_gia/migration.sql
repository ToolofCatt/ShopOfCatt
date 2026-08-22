-- Giá NEO theo đơn vị chủ shop đã gõ.
--
-- Trước đây giá chỉ là USDT với hai chữ số thập phân, nên gõ 100.000 ₫ thành
-- 3.84 USDT rồi quy ngược lại ra 100.046 ₫: hai mức giá kề nhau cách nhau đúng
-- 0,01 USDT ≈ 260 ₫, không có cách nào đặt được một số tròn bằng đồng. Tệ hơn,
-- con số ₫ đó TRÔI theo tỉ giá — hôm nay 100.046, tuần sau 100.550.
--
-- Từ nay `priceAmount` + `priceCurrency` là nguồn sự thật, còn `price` (USDT)
-- là số dẫn xuất, được tính lại mỗi lần tỉ giá đổi. Nới `price` lên sáu chữ số
-- để số ₫ quy ngược lại lệch dưới một đồng.

ALTER TABLE "ProductVariant" ALTER COLUMN "price" TYPE DECIMAL(18,6);

ALTER TABLE "ProductVariant"
  ADD COLUMN "priceCurrency" TEXT NOT NULL DEFAULT 'USDT',
  ADD COLUMN "priceAmount" DECIMAL(18,2);

-- Giá cũ đều là USDT do chủ shop gõ trực tiếp, nên chính nó là số đã gõ.
UPDATE "ProductVariant" SET "priceAmount" = "price" WHERE "priceAmount" IS NULL;

-- Chỉ đặt NOT NULL sau khi đã lấp đủ, để migration chạy được trên CSDL đang có
-- dữ liệu chứ không riêng CSDL rỗng.
ALTER TABLE "ProductVariant" ALTER COLUMN "priceAmount" SET NOT NULL;
