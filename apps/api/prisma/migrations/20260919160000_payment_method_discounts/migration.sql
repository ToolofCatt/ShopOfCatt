ALTER TABLE "StoreSetting" ADD COLUMN "paymentDiscounts" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Order" ADD COLUMN "paymentDiscountAmount" DECIMAL(18,6) NOT NULL DEFAULT 0, ADD COLUMN "paymentDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "PaymentInstruction" ADD COLUMN "orderTotalAmount" DECIMAL(18,6), ADD COLUMN "paymentDiscountAmount" DECIMAL(18,6) NOT NULL DEFAULT 0, ADD COLUMN "paymentDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "MerchantPaymentSession" ADD COLUMN "orderTotalAmount" DECIMAL(18,6), ADD COLUMN "paymentDiscountAmount" DECIMAL(18,6) NOT NULL DEFAULT 0, ADD COLUMN "paymentDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
UPDATE "PaymentInstruction" i SET "orderTotalAmount" = p.amount FROM "Payment" p WHERE p.id = i."paymentId";
UPDATE "MerchantPaymentSession" s SET "orderTotalAmount" = p.amount FROM "Payment" p WHERE p.id = s."paymentId";
