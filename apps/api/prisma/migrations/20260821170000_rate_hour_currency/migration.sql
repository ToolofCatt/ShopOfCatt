-- Giờ lấy tỉ giá cố định + chọn tiền hiện cho khách.
--
-- rateHour theo GIỜ VIỆT NAM. Trước đây lịch là "24 tiếng kể từ lần lấy trước",
-- nên giờ cập nhật trôi dần và mỗi lần dựng lại máy chủ là mốc lại nhảy — chủ
-- shop không bao giờ biết tỉ giá đổi lúc nào.
--
-- displayCurrency = 'auto' giữ đúng hành vi đang chạy (theo ngôn ngữ khách chọn).
ALTER TABLE "StoreSetting"
  ADD COLUMN "rateHour"        INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "displayCurrency" TEXT    NOT NULL DEFAULT 'auto';
