-- Khoá Claude API cho dịch tự động, sửa được ngay trong /admin/settings.
--
-- Trước đây chỉ đọc từ biến môi trường ANTHROPIC_API_KEY, nghĩa là muốn bật
-- dịch thì phải SSH vào máy chủ sửa .env rồi dựng lại container. Chủ shop yêu
-- cầu sửa được trên web, nên khoá xuống CSDL — đánh đổi: nó nằm trong mọi bản
-- sao lưu. Biến môi trường vẫn được giữ làm nguồn dự phòng khi cột này rỗng.
ALTER TABLE "StoreSetting" ADD COLUMN "anthropicApiKey" TEXT NOT NULL DEFAULT '';
