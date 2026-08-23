-- Trang quản trị riêng cho bot Telegram: hai cấu hình hiển thị mới.
-- telegramSendAnnouncement mặc định TRUE để giữ nguyên hành vi GĐ2 (bot đang
-- gửi thông báo kèm /start) — default false là một lần deploy âm thầm đổi
-- hành vi cửa hàng đang chạy.
ALTER TABLE "StoreSetting"
  ADD COLUMN "telegramSendAnnouncement" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "telegramGreeting" TEXT NOT NULL DEFAULT '';
