-- Nhieu anh cho mot san pham + anh nho rieng cho the san pham.
--
-- `Product.thumbnail` (~400px): truy van danh sach san pham khong con keo cot
-- `image` ban lon ve nua, vi anh luu base64 ngay trong CSDL nen trang chu 20 san
-- pham la vai MB JSON cho nhung o anh rong ~250px.
--
-- `ProductImage` de rieng mot bang chu khong nhet mang vao cot cua Product: cot
-- nam trong Product la moi truy van danh sach deu keo ca dong base64 theo.
-- Anh bia van o `Product.image`, bang nay chi chua anh phu.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "thumbnail" TEXT;

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
