-- Màn 🌐 chọn ngôn ngữ của bot: khách đã tự chọn thì telegramLang là quyết
-- định cuối, không bị language_code của app Telegram ghi đè nữa.
ALTER TABLE "User" ADD COLUMN "telegramLangChosen" BOOLEAN NOT NULL DEFAULT false;
