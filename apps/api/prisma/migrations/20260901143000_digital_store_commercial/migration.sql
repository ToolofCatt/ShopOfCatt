-- CreateTable
CREATE TABLE "StoreSetup" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "setupVersion" INTEGER NOT NULL DEFAULT 1,
    "maintenanceMode" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "publishedRevisionId" TEXT,
    "currentStep" TEXT NOT NULL DEFAULT 'system',
    "checkResults" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StoreSetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontDraft" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "document" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StorefrontDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorefrontRevision" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "publishedById" TEXT,
    "publishedBy" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorefrontRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreMediaAsset" (
    "id" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoreMediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorefrontRevision_version_key" ON "StorefrontRevision"("version");
CREATE INDEX "StorefrontRevision_publishedAt_idx" ON "StorefrontRevision"("publishedAt");
CREATE INDEX "StoreMediaAsset_createdAt_idx" ON "StoreMediaAsset"("createdAt");
CREATE INDEX "StoreMediaAsset_sha256_idx" ON "StoreMediaAsset"("sha256");

-- Deployment đang tồn tại phải tiếp tục bán ngay sau migrate. Database mới chưa
-- có StoreSetting nên không có dòng này và vẫn ở màn "Đang thiết lập".
INSERT INTO "StoreSetup" (
  "id", "setupVersion", "maintenanceMode", "publishedAt", "currentStep",
  "checkResults", "createdAt", "updatedAt"
)
SELECT 'main', 1, false, CURRENT_TIMESTAMP, 'review', '[]'::jsonb,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "StoreSetting"
WHERE "id" = 'main'
ON CONFLICT ("id") DO NOTHING;
