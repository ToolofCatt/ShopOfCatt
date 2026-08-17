-- Anh QR nhan tien Binance Pay, do chu shop tu tai len.
--
-- Khong dung duoc tu Binance ID: QR cua Binance chua mot lien ket noi bo co
-- token rieng, khong suy ra tu so ID. Ma hoa so ID tran thi app Binance quet
-- khong hieu — tha de chu shop chup QR trong app roi tai len.

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "binanceQr" TEXT NOT NULL DEFAULT '';
