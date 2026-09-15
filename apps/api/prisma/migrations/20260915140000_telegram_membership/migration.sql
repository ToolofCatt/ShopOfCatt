-- Mặc định tắt để deployment cũ vẫn phục vụ cho đến khi chủ shop xác minh kênh.
ALTER TABLE "StoreSetting"
  ADD COLUMN "telegramMembershipRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "telegramMembershipChatId" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "telegramMembershipJoinUrl" TEXT NOT NULL DEFAULT '';
