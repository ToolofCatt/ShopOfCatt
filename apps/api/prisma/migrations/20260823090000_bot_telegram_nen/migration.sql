-- Nền cho bot Telegram bán hàng (Giai đoạn 1 — xem docs/BOT-TELEGRAM.md).
--
-- Khách Telegram không có email lẫn mật khẩu, mà Order.userId thì bắt buộc —
-- nên User.email phải cho NULL và mỗi chat được nhận diện bằng telegramChatId.
-- Postgres cho nhiều NULL trong unique index nên khách web không vướng nhau.
-- passwordHash vẫn NOT NULL: khách Telegram lưu hash của một chuỗi ngẫu nhiên
-- vứt đi ngay lúc tạo, để mọi nhánh so mật khẩu cứ chạy và luôn trượt.

ALTER TABLE "User" ADD COLUMN "telegramChatId" TEXT,
ADD COLUMN "telegramName" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "email" DROP NOT NULL;

CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");

-- Công tắc + token bot. Token là BÍ MẬT — không bao giờ vào AdminStoreSettingDto
-- hay nhật ký; xem chú thích ở schema.prisma.
ALTER TABLE "StoreSetting" ADD COLUMN "telegramBotEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "telegramBotToken" TEXT NOT NULL DEFAULT '';

-- Outbox cho thông báo giao hàng qua bot (Giai đoạn 4): KHÔNG gọi Telegram
-- trong transaction giao hàng — vòng quét riêng đọc cột này rồi gửi và đánh dấu.
ALTER TABLE "Order" ADD COLUMN "telegramNotifiedAt" TIMESTAMP(3);
