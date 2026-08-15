-- Thống kê cho chủ shop: lượt xem sản phẩm và từ khoá tìm kiếm.
--
-- Cả hai bảng đều GỘP THEO NGÀY thay vì lưu từng sự kiện: bảng sự kiện phình vô
-- hạn theo lượt truy cập, còn gộp sẵn thì số dòng bị chặn ở (số sản phẩm × số
-- ngày) và (số từ khoá × số ngày).
--
-- Không có cột IP hay userId — chủ shop cần con số, không cần biết ai đã xem.

-- CreateTable
CREATE TABLE "ProductViewDaily" (
    "productId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductViewDaily_pkey" PRIMARY KEY ("productId","day")
);

-- CreateTable
CREATE TABLE "SearchQueryDaily" (
    "term" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "zeroResults" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SearchQueryDaily_pkey" PRIMARY KEY ("term","day")
);

-- CreateIndex
CREATE INDEX "ProductViewDaily_day_idx" ON "ProductViewDaily"("day");

-- CreateIndex
CREATE INDEX "SearchQueryDaily_day_idx" ON "SearchQueryDaily"("day");

-- AddForeignKey
ALTER TABLE "ProductViewDaily" ADD CONSTRAINT "ProductViewDaily_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
