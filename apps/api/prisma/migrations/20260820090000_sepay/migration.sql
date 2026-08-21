-- SePay: nhận chuyển khoản ngân hàng VND, xác nhận bằng webhook.
--
-- Giá bán ghi bằng USDT còn ngân hàng báo VND, nên phải có tỉ giá mới dựng được
-- số tiền để đối chiếu. vndPerUsdt = 0 nghĩa là chưa cấu hình, và lúc đó phương
-- thức không được chào ra cho khách (fail-closed) — xem getEnabledMethods.
ALTER TABLE "StoreSetting"
  ADD COLUMN "sepayEnabled"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sepayAccountNumber" TEXT    NOT NULL DEFAULT '',
  ADD COLUMN "sepayBank"          TEXT    NOT NULL DEFAULT '',
  ADD COLUMN "sepayAccountHolder" TEXT    NOT NULL DEFAULT '',
  ADD COLUMN "sepayApiKey"        TEXT    NOT NULL DEFAULT '',
  ADD COLUMN "sepayWebhookSecret" TEXT    NOT NULL DEFAULT '',
  ADD COLUMN "vndPerUsdt"         DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Số tài khoản + ngân hàng được CHỤP LẠI vào từng đơn: đổi tài khoản giữa lúc
-- có đơn đang chờ mà không chụp là khách chuyển vào chỗ không còn ai theo dõi.
ALTER TABLE "Payment"
  ADD COLUMN "sepayBank" TEXT,
  ADD COLUMN "vndAmount" DECIMAL(18,0),
  ADD COLUMN "sepayRef"  TEXT;

-- Hàng rào chống dùng lại: một giao dịch SePay chỉ trả được cho MỘT đơn, kể cả
-- khi webhook được gửi lại nhiều lần cùng lúc.
CREATE UNIQUE INDEX "Payment_sepayRef_key" ON "Payment"("sepayRef");
