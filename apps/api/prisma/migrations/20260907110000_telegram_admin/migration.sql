CREATE TYPE "TelegramAdminPermission" AS ENUM ('VIEWER', 'OPERATOR', 'FULL');
ALTER TABLE "StoreSetting" ADD COLUMN "telegramAdminEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AuditLog" ADD COLUMN "actorSource" TEXT NOT NULL DEFAULT 'WEB', ADD COLUMN "telegramUserId" TEXT, ADD COLUMN "telegramName" TEXT;
CREATE TABLE "TelegramAdmin" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "telegramUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "permission" "TelegramAdminPermission" NOT NULL DEFAULT 'OPERATOR',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "inAdminMode" BOOLEAN NOT NULL DEFAULT false,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "TelegramAdmin_telegramUserId_key" ON "TelegramAdmin"("telegramUserId");
CREATE TABLE "TelegramAdminAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "telegramUserId" TEXT NOT NULL,
  "adminVersion" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "TelegramAdminAction_telegramUserId_status_idx" ON "TelegramAdminAction"("telegramUserId", "status");
CREATE INDEX "TelegramAdminAction_expiresAt_idx" ON "TelegramAdminAction"("expiresAt");
