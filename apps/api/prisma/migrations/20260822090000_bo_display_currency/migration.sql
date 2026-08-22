-- Bỏ tuỳ chọn "tiền hiện cho khách".
--
-- Giá hiện cho khách nay suy THẲNG từ ngôn ngữ họ đang xem (vi→₫, en→$, zh→¥),
-- không có cấu hình nào chen vào. Chủ shop chọn đơn vị ở chỗ khác — ngay tại ô
-- nhập giá — nên hai bộ chọn cho hai việc khác nhau chỉ gây lẫn.
--
-- Xoá cột chứ không để lại: một cột không ai đọc là schema nói dối về hành vi
-- thật của ứng dụng. Cần lại thì thêm lại rất nhanh.
ALTER TABLE "StoreSetting" DROP COLUMN "displayCurrency";
