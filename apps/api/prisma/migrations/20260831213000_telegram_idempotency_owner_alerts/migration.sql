-- Chống Telegram phát lại callback tạo trùng đơn/mã nạp, đồng thời thêm các
-- mốc outbox cho cảnh báo vận hành của chủ shop.

ALTER TABLE "Deposit"
ADD COLUMN "telegramCallbackId" TEXT;

ALTER TABLE "Order"
ADD COLUMN "telegramCallbackId" TEXT,
ADD COLUMN "telegramOwnerNewOrderNotifiedAt" TIMESTAMP(3),
ADD COLUMN "telegramOwnerStuckNotifiedAt" TIMESTAMP(3);

-- Đơn cũ không phải "đơn mới" khi vừa triển khai tính năng. Đơn PENDING cũ
-- vẫn để mốc stuck rỗng để chủ shop được cảnh báo nếu nó thực sự đang kẹt.
UPDATE "Order"
SET "telegramOwnerNewOrderNotifiedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "ProductVariant"
ADD COLUMN "telegramOwnerLowStockNotifiedAt" TIMESTAMP(3);

ALTER TABLE "StoreSetting"
ADD COLUMN "telegramOwnerChatId" TEXT NOT NULL DEFAULT '',
ADD COLUMN "telegramOwnerOrderAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "telegramOwnerStuckAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "telegramOwnerStuckMinutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "telegramOwnerLowStockAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "telegramOwnerLowStockThreshold" INTEGER NOT NULL DEFAULT 3;

CREATE UNIQUE INDEX "Deposit_telegramCallbackId_key"
ON "Deposit"("telegramCallbackId");

CREATE UNIQUE INDEX "Order_telegramCallbackId_key"
ON "Order"("telegramCallbackId");

CREATE INDEX "Order_telegramOwnerNewOrderNotifiedAt_createdAt_idx"
ON "Order"("telegramOwnerNewOrderNotifiedAt", "createdAt");

CREATE INDEX "Order_status_telegramOwnerStuckNotifiedAt_createdAt_idx"
ON "Order"("status", "telegramOwnerStuckNotifiedAt", "createdAt");
