-- Nạp ví qua crypto: thêm kênh nạp (mode) + cột chụp mạng/địa chỉ + txId đã
-- khớp. cryptoTxId @unique là trọng tài chống cộng ví hai lần — cùng vai trò
-- sepayRef bên kênh ngân hàng.

-- CreateEnum
CREATE TYPE "DepositMode" AS ENUM ('SEPAY', 'CRYPTO', 'BINANCE_ID');

-- AlterTable
ALTER TABLE "Deposit" ADD COLUMN     "cryptoAddress" TEXT,
ADD COLUMN     "cryptoNetwork" TEXT,
ADD COLUMN     "cryptoTxId" TEXT,
ADD COLUMN     "mode" "DepositMode" NOT NULL DEFAULT 'SEPAY';

-- CreateIndex
CREATE UNIQUE INDEX "Deposit_cryptoTxId_key" ON "Deposit"("cryptoTxId");
