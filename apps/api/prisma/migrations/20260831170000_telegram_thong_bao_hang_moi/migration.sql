-- Thông báo hàng mới dùng outbox theo từng khách: nhập kho và xếp hàng cùng
-- transaction, còn gọi Telegram luôn nằm ngoài transaction giữ dữ liệu kho.

ALTER TABLE "StoreSetting"
ADD COLUMN "telegramStockAlertsEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "TelegramStockAlert" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "priceCurrency" TEXT NOT NULL,
    "priceAmount" DECIMAL(18,2) NOT NULL,
    "added" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramStockAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramStockAlertRecipient" (
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramStockAlertRecipient_pkey" PRIMARY KEY ("alertId","userId")
);

CREATE INDEX "TelegramStockAlert_createdAt_idx"
ON "TelegramStockAlert"("createdAt");

CREATE INDEX "TelegramStockAlertRecipient_sentAt_failedAt_createdAt_idx"
ON "TelegramStockAlertRecipient"("sentAt", "failedAt", "createdAt");

ALTER TABLE "TelegramStockAlertRecipient"
ADD CONSTRAINT "TelegramStockAlertRecipient_alertId_fkey"
FOREIGN KEY ("alertId") REFERENCES "TelegramStockAlert"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramStockAlertRecipient"
ADD CONSTRAINT "TelegramStockAlertRecipient_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
