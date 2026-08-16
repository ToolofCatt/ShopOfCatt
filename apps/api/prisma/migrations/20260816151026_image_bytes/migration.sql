-- Ghi san co anh cua tung anh, de KHONG phai select cot base64 chi vi can biet
-- "co anh hay khong" va "nang bao nhieu".
--
-- Tu day anh khong con nhung vao JSON/HTML nua ma phuc vu qua endpoint rieng,
-- nen truy van danh sach lan chi tiet deu chi can id + co de dung dia chi anh.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imageBytes" INTEGER,
ADD COLUMN     "thumbnailBytes" INTEGER;

-- AlterTable
ALTER TABLE "ProductImage" ADD COLUMN     "bytes" INTEGER NOT NULL DEFAULT 0;


-- Nap so lieu cho du lieu dang co.
-- Chi giai ma nhung gia tri that su la data URI; ban cu con cho phep dan URL
-- ngoai vao o anh, decode base64 mot chuoi "https://..." se lam migration chet.
UPDATE "Product"
   SET "imageBytes" = octet_length(decode(substring("image" from position(',' in "image") + 1), 'base64'))
 WHERE "image" LIKE 'data:%' AND position(',' in "image") > 0;

UPDATE "Product"
   SET "thumbnailBytes" = octet_length(decode(substring("thumbnail" from position(',' in "thumbnail") + 1), 'base64'))
 WHERE "thumbnail" LIKE 'data:%' AND position(',' in "thumbnail") > 0;

-- URL ngoai thi khong co byte anh nao de dem, nhung van phai khac NULL de cho
-- khac biet duoc "co anh" voi "chua co anh".
UPDATE "Product" SET "imageBytes" = octet_length("image")
 WHERE "image" IS NOT NULL AND "imageBytes" IS NULL;
UPDATE "Product" SET "thumbnailBytes" = octet_length("thumbnail")
 WHERE "thumbnail" IS NOT NULL AND "thumbnailBytes" IS NULL;

UPDATE "ProductImage"
   SET "bytes" = octet_length(decode(substring("data" from position(',' in "data") + 1), 'base64'))
 WHERE "data" LIKE 'data:%' AND position(',' in "data") > 0;
