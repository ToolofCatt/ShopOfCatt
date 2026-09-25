-- CreateEnum
CREATE TYPE "MailPurchaseStatus" AS ENUM ('REQUESTING', 'DELIVERED', 'REVIEW', 'REFUNDED');

-- CreateTable
CREATE TABLE "MailProviderSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "token" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "currencyConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "multiplier" DECIMAL(8,4) NOT NULL DEFAULT 2,
    "maxOrderCost" DECIMAL(18,6) NOT NULL DEFAULT 5,
    "maxDailyCost" DECIMAL(18,6) NOT NULL DEFAULT 50,
    "syncedAt" TIMESTAMP(3),
    "lastSyncFailed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailProviderSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailOffer" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "cost" DECIMAL(18,6) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "salePrice" DECIMAL(18,6),
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailOffer_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "MailPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "offerCode" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "total" DECIMAL(18,6) NOT NULL,
    "expectedCost" DECIMAL(18,6) NOT NULL,
    "actualCost" DECIMAL(18,6),
    "status" "MailPurchaseStatus" NOT NULL DEFAULT 'REQUESTING',
    "providerOrderNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mailbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "deliveryText" TEXT NOT NULL,
    "readUrl" TEXT,
    "readUid" TEXT,
    "providerIdentity" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "lastPolledAt" TIMESTAMP(3),
    "pollLeaseUntil" TIMESTAMP(3),
    "pollFailed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailCode" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailOffer_category_active_idx" ON "MailOffer"("category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "MailPurchase_providerOrderNo_key" ON "MailPurchase"("providerOrderNo");

-- CreateIndex
CREATE INDEX "MailPurchase_userId_createdAt_idx" ON "MailPurchase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MailPurchase_status_createdAt_idx" ON "MailPurchase"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailPurchase_userId_requestId_key" ON "MailPurchase"("userId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Mailbox_providerIdentity_key" ON "Mailbox"("providerIdentity");

-- CreateIndex
CREATE INDEX "Mailbox_userId_createdAt_idx" ON "Mailbox"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Mailbox_closedAt_lastPolledAt_idx" ON "Mailbox"("closedAt", "lastPolledAt");

-- CreateIndex
CREATE INDEX "MailCode_mailboxId_receivedAt_idx" ON "MailCode"("mailboxId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailCode_mailboxId_code_key" ON "MailCode"("mailboxId", "code");

-- AddForeignKey
ALTER TABLE "MailPurchase" ADD CONSTRAINT "MailPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailPurchase" ADD CONSTRAINT "MailPurchase_offerCode_fkey" FOREIGN KEY ("offerCode") REFERENCES "MailOffer"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "MailPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailCode" ADD CONSTRAINT "MailCode_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
