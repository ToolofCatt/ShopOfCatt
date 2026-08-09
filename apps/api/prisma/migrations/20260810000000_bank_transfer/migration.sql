-- Chuyển khoản ngân hàng Việt Nam (VietQR).

-- Cấu hình cửa hàng: thông tin tài khoản nhận + tỉ giá USDT→VND
ALTER TABLE "StoreSetting" ADD COLUMN "bankTransferEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreSetting" ADD COLUMN "bankBin" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StoreSetting" ADD COLUMN "bankAccountNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StoreSetting" ADD COLUMN "bankAccountName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StoreSetting" ADD COLUMN "usdtVndRate" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Ảnh chụp trên từng lần thanh toán: đổi cấu hình sau này không làm sai đơn cũ
ALTER TABLE "Payment" ADD COLUMN "bankBin" TEXT;
ALTER TABLE "Payment" ADD COLUMN "bankAccountNumber" TEXT;
ALTER TABLE "Payment" ADD COLUMN "bankAccountName" TEXT;
ALTER TABLE "Payment" ADD COLUMN "bankAmountVnd" DECIMAL(18,0);
ALTER TABLE "Payment" ADD COLUMN "bankTransferContent" TEXT;
ALTER TABLE "Payment" ADD COLUMN "customerClaimedAt" TIMESTAMP(3);
