-- Chỉ thêm metadata; không thay trạng thái đơn, ví hoặc hàng trong kho.
ALTER TABLE "Order" ADD COLUMN "telegramNotifyFailedAt" TIMESTAMP(3);
ALTER TABLE "Deposit" ADD COLUMN "telegramNotifyFailedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
