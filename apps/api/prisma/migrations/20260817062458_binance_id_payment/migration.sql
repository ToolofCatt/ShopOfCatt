-- Binance Pay CA NHAN: khach chuyen USDT thang toi Binance ID cua chu shop.
--
-- Khac han Binance Pay MERCHANT (binancePayEnabled) von can tai khoan merchant
-- rieng va cap khoa BINANCE_PAY_*. Loai nay chi can khoa doc san co: lich su
-- giao dich Pay doc duoc qua /sapi/v1/pay/transactions, nen doi soat tu dong
-- duoc y het on-chain — khop theo so tien duy nhat + thoi diem.
--
-- Payment khong can cot moi: mode la chuoi, con cryptoAmount/cryptoTxId dung
-- chung cho ca hai loai (xem chu thich trong schema.prisma).

-- AlterTable
ALTER TABLE "StoreSetting" ADD COLUMN     "binanceId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "binanceIdEnabled" BOOLEAN NOT NULL DEFAULT false;
