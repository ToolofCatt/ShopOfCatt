-- Bỏ hẳn phương thức chuyển khoản ngân hàng VN (VietQR).
--
-- Lý do: VietQR sinh QR miễn phí, nhưng KHÔNG có cách nào tự động biết tiền đã
-- về hay chưa — chỉ sao kê ngân hàng mới biết, nên mọi đơn đều phải admin đối
-- soát tay. Cửa hàng chốt đi theo Binance Pay + USDT on-chain, vì hai đường đó
-- đối soát tự động được qua API Binance (quyền chỉ đọc).
--
-- Xoá cột là KHÔNG hoàn tác được. Thời điểm chạy migration này cửa hàng chưa có
-- đơn nào và cấu hình ngân hàng còn trống, nên không mất dữ liệu thật.

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "bankAccountName",
DROP COLUMN "bankAccountNumber",
DROP COLUMN "bankAmountVnd",
DROP COLUMN "bankBin",
DROP COLUMN "bankTransferContent",
DROP COLUMN "customerClaimedAt";

-- AlterTable
ALTER TABLE "StoreSetting" DROP COLUMN "bankAccountName",
DROP COLUMN "bankAccountNumber",
DROP COLUMN "bankBin",
DROP COLUMN "bankTransferEnabled",
DROP COLUMN "usdtVndRate";
