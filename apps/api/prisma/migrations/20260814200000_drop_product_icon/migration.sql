-- Bỏ cột icon của sản phẩm.
--
-- Trước đây chủ shop phải chọn icon từ một danh sách tên component lucide bằng
-- tiếng Anh (KeyRound, AppWindow…), trong khi thứ khách thật sự nhìn thấy là ảnh
-- sản phẩm. Giờ ảnh được chọn từ máy nên icon thành thừa: sản phẩm chưa có ảnh
-- hiển thị một biểu tượng hộp mặc định.
--
-- Xoá cột là KHÔNG hoàn tác được. Lúc chạy migration này cửa hàng chưa có sản
-- phẩm nào nên không mất dữ liệu thật.

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "icon";
