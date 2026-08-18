-- Dịch tự động dùng được nhà cung cấp AI bất kỳ, không chỉ Claude.
--
-- Đổi tên cột thay vì thêm cột mới: "anthropicApiKey" thành sai nghĩa ngay khi
-- nó chứa khoá của OpenRouter hay DeepSeek. RENAME giữ nguyên dữ liệu đang có
-- nên không cần chép tay, và cột này vừa thêm hôm qua nên gần như còn rỗng.
ALTER TABLE "StoreSetting" RENAME COLUMN "anthropicApiKey" TO "aiApiKey";

ALTER TABLE "StoreSetting" ADD COLUMN "aiProvider" TEXT NOT NULL DEFAULT 'anthropic';
ALTER TABLE "StoreSetting" ADD COLUMN "aiBaseUrl"  TEXT NOT NULL DEFAULT '';
ALTER TABLE "StoreSetting" ADD COLUMN "aiModel"    TEXT NOT NULL DEFAULT '';
