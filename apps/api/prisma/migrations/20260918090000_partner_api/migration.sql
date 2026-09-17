-- Mặc định không mở API cho tài khoản hiện hữu. Không thay ví hoặc lịch sử hàng hóa.
CREATE TABLE "ApiAccess" (
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "approvedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiAccess_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "ApiAccess" ADD CONSTRAINT "ApiAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "ApiKey" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApiKey_ownerId_revokedAt_expiresAt_idx" ON "ApiKey"("ownerId", "revokedAt", "expiresAt");
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "ApiOperationReceipt" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "orderId" TEXT,
  "depositId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiOperationReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApiOperationReceipt_target_check" CHECK (
    ("operation" = 'orders.create' AND "orderId" IS NOT NULL AND "depositId" IS NULL)
    OR ("operation" = 'deposits.create' AND "depositId" IS NOT NULL AND "orderId" IS NULL)
  )
);
CREATE UNIQUE INDEX "ApiOperationReceipt_ownerId_operation_idempotencyKey_key" ON "ApiOperationReceipt"("ownerId", "operation", "idempotencyKey");
CREATE UNIQUE INDEX "ApiOperationReceipt_orderId_key" ON "ApiOperationReceipt"("orderId");
CREATE UNIQUE INDEX "ApiOperationReceipt_depositId_key" ON "ApiOperationReceipt"("depositId");
CREATE INDEX "ApiOperationReceipt_ownerId_operation_createdAt_idx" ON "ApiOperationReceipt"("ownerId", "operation", "createdAt");
ALTER TABLE "ApiOperationReceipt" ADD CONSTRAINT "ApiOperationReceipt_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiOperationReceipt" ADD CONSTRAINT "ApiOperationReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiOperationReceipt" ADD CONSTRAINT "ApiOperationReceipt_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "Deposit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "ApiRateBucket" (
  "id" TEXT NOT NULL,
  "hits" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiRateBucket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApiRateBucket_expiresAt_idx" ON "ApiRateBucket"("expiresAt");
