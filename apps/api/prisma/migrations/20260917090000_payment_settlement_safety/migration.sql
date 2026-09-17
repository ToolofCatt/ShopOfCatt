-- Không đổi dữ liệu hàng hóa khi chặn cascade: loại có kho/lịch sử chỉ được ngừng bán.
ALTER TABLE "StockItem" DROP CONSTRAINT "StockItem_variantId_fkey";
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_variantId_fkey";
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deposit" ADD COLUMN "sepayBank" TEXT;
ALTER TABLE "Deposit" ADD COLUMN "sepayAccountHolder" TEXT;
ALTER TABLE "Payment" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ALTER COLUMN "mode" SET DEFAULT 'INITIALIZING';

CREATE TABLE "IncomingTransfer" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "amount" DECIMAL(18,6) NOT NULL,
  "currency" TEXT NOT NULL,
  "network" TEXT,
  "receiver" TEXT,
  "receivedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'OBSERVED',
  "reviewReason" TEXT,
  "paymentId" TEXT,
  "depositId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncomingTransfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IncomingTransfer_source_check" CHECK ("source" IN ('CRYPTO:BEP20', 'CRYPTO:TRC20', 'BINANCE_ID', 'SEPAY', 'BINANCE_MERCHANT')),
  CONSTRAINT "IncomingTransfer_status_check" CHECK ("status" IN ('OBSERVED', 'REVIEW', 'CLAIMED')),
  CONSTRAINT "IncomingTransfer_reference_check" CHECK (length("reference") > 0),
  CONSTRAINT "IncomingTransfer_target_check" CHECK (
    ("status" = 'CLAIMED' AND num_nonnulls("paymentId", "depositId") = 1)
    OR ("status" <> 'CLAIMED' AND num_nonnulls("paymentId", "depositId") = 0)
  )
);
CREATE UNIQUE INDEX "IncomingTransfer_source_reference_key" ON "IncomingTransfer"("source", "reference");
CREATE UNIQUE INDEX "IncomingTransfer_paymentId_key" ON "IncomingTransfer"("paymentId");
CREATE UNIQUE INDEX "IncomingTransfer_depositId_key" ON "IncomingTransfer"("depositId");
CREATE INDEX "IncomingTransfer_status_createdAt_idx" ON "IncomingTransfer"("status", "createdAt");
ALTER TABLE "IncomingTransfer" ADD CONSTRAINT "IncomingTransfer_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IncomingTransfer" ADD CONSTRAINT "IncomingTransfer_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Unique/check chủ ý làm migration dừng khi lịch sử trùng hoặc mất namespace, không tự chọn bên thắng.
INSERT INTO "IncomingTransfer" ("id", "source", "reference", "amount", "currency", "network", "receiver", "status", "paymentId", "createdAt", "updatedAt")
SELECT 'payment-crypto-' || "id",
  CASE WHEN "cryptoNetwork" IN ('BEP20', 'TRC20') THEN 'CRYPTO:' || "cryptoNetwork" WHEN "mode" = 'BINANCE_ID' THEN 'BINANCE_ID' ELSE 'UNKNOWN' END,
  CASE WHEN "cryptoNetwork" IN ('BEP20', 'TRC20') THEN lower(trim("cryptoTxId")) ELSE trim("cryptoTxId") END,
  COALESCE("cryptoAmount", "amount"), 'USDT', "cryptoNetwork", "cryptoAddress", 'CLAIMED', "id", "createdAt", "updatedAt"
FROM "Payment" WHERE "cryptoTxId" IS NOT NULL;
INSERT INTO "IncomingTransfer" ("id", "source", "reference", "amount", "currency", "receiver", "status", "paymentId", "createdAt", "updatedAt")
SELECT 'payment-sepay-' || "id", 'SEPAY', trim("sepayRef"), COALESCE("vndAmount", 0), 'VND', "cryptoAddress", 'CLAIMED', "id", "createdAt", "updatedAt"
FROM "Payment" WHERE "sepayRef" IS NOT NULL;
INSERT INTO "IncomingTransfer" ("id", "source", "reference", "amount", "currency", "network", "receiver", "status", "depositId", "createdAt", "updatedAt")
SELECT 'deposit-crypto-' || "id",
  CASE WHEN "mode" = 'CRYPTO' AND "cryptoNetwork" IN ('BEP20', 'TRC20') THEN 'CRYPTO:' || "cryptoNetwork" WHEN "mode" = 'BINANCE_ID' THEN 'BINANCE_ID' ELSE 'UNKNOWN' END,
  CASE WHEN "mode" = 'CRYPTO' THEN lower(trim("cryptoTxId")) ELSE trim("cryptoTxId") END,
  "amountUsdt", 'USDT', "cryptoNetwork", "cryptoAddress", 'CLAIMED', "id", "createdAt", CURRENT_TIMESTAMP
FROM "Deposit" WHERE "cryptoTxId" IS NOT NULL;
INSERT INTO "IncomingTransfer" ("id", "source", "reference", "amount", "currency", "status", "depositId", "createdAt", "updatedAt")
SELECT 'deposit-sepay-' || "id", 'SEPAY', trim("sepayRef"), "vndAmount", 'VND', 'CLAIMED', "id", "createdAt", CURRENT_TIMESTAMP
FROM "Deposit" WHERE "sepayRef" IS NOT NULL;
INSERT INTO "IncomingTransfer" ("id", "source", "reference", "amount", "currency", "status", "paymentId", "createdAt", "updatedAt")
SELECT 'payment-merchant-' || "id", 'BINANCE_MERCHANT', "merchantTradeNo", "amount", "currency", 'CLAIMED', "id", "createdAt", "updatedAt"
FROM "Payment" WHERE "mode" = 'BINANCE' AND "status" = 'SUCCESS' AND "cryptoTxId" IS NULL AND "sepayRef" IS NULL;

CREATE TABLE "PaymentInstruction" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL,
  "mode" TEXT NOT NULL,
  "amount" DECIMAL(18,6) NOT NULL,
  "network" TEXT,
  "receiver" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentInstruction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentInstruction_paymentId_sessionVersion_key" ON "PaymentInstruction"("paymentId", "sessionVersion");
CREATE INDEX "PaymentInstruction_mode_createdAt_idx" ON "PaymentInstruction"("mode", "createdAt");
ALTER TABLE "PaymentInstruction" ADD CONSTRAINT "PaymentInstruction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "PaymentInstruction" ("id", "paymentId", "sessionVersion", "mode", "amount", "network", "receiver", "createdAt")
SELECT 'legacy-' || "id", "id", 0, "mode", CASE WHEN "mode" = 'SEPAY' THEN COALESCE("vndAmount", 0) ELSE COALESCE("cryptoAmount", "amount") END, "cryptoNetwork", "cryptoAddress", "createdAt"
FROM "Payment" WHERE "mode" IN ('CRYPTO', 'BINANCE_ID', 'SEPAY');

CREATE TABLE "MerchantPaymentSession" (
  "merchantTradeNo" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantPaymentSession_pkey" PRIMARY KEY ("merchantTradeNo")
);
CREATE INDEX "MerchantPaymentSession_paymentId_idx" ON "MerchantPaymentSession"("paymentId");
ALTER TABLE "MerchantPaymentSession" ADD CONSTRAINT "MerchantPaymentSession_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "MerchantPaymentSession" ("merchantTradeNo", "paymentId", "createdAt") SELECT "merchantTradeNo", "id", "createdAt" FROM "Payment" WHERE "mode" = 'BINANCE';
