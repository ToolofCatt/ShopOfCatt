-- GĐ4: bot tự đẩy key khi đơn giao xong (vòng quét outbox telegramNotifiedAt).

-- Ngôn ngữ bot của khách — vòng đẩy chạy ngoài mọi tương tác, không có
-- language_code nào để đoán nên phải nhớ từ lần mua trước.
ALTER TABLE "User" ADD COLUMN "telegramLang" TEXT NOT NULL DEFAULT '';

-- Đơn đã giao TRƯỚC khi có vòng đẩy: coi như đã báo (khách đã lấy key qua nút
-- kiểm tra), kẻo lần deploy này dội một loạt tin cho đơn cũ.
UPDATE "Order" SET "telegramNotifiedAt" = now()
WHERE "status" = 'DELIVERED'
  AND "telegramNotifiedAt" IS NULL
  AND "userId" IN (SELECT "id" FROM "User" WHERE "telegramChatId" IS NOT NULL);
