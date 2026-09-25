# Mail workspace

## Cấu hình và sử dụng

Trang khách `/mail/gmail` dùng bố cục sidebar đã duyệt. `/mail` chuyển về cùng
trang; tab Sản phẩm số/Mail chuyển bằng Next Link, giữ header và tài khoản thật.
Mail không hiển thị thông báo trang chủ. Giao diện có VI/EN/ZH, tìm kiếm, Copy
địa chỉ/mã và xuất TXT có xác thực.

Mã cũ mở khi hover, bấm để ghim. Khi ghim, nền bị khóa cuộn nhưng danh sách mã
vẫn cuộn; bấm biểu tượng ghim hoặc bấm ngoài để bỏ ghim/đóng. Không có nút X hoặc
dòng hướng dẫn. Lịch sử đang đọc không bị chèn lại khi poll nhận mã mới.

Trong `/admin/mail`:

1. **Kết nối:** SUPERADMIN nhập token, đặt hệ số giá và hạn mức. Token mới phải
   đọc được catalog trước khi thay; API chỉ trả `tokenSet` và bốn ký tự cuối.
2. **Danh mục & giá:** đồng bộ dữ liệu thật, bật/tắt từng dịch vụ hoặc đặt giá
   cố định. Mặc định giá nguồn ×2, dùng Decimal sáu chữ số. Sync giữ lựa chọn admin.
3. Xác nhận đơn vị giá nguồn là USDT hoặc chấp nhận quy đổi USD theo tỷ lệ 1:1
   sang USDT trước khi bật mua. Không suy ra đơn vị tiền từ con số giá.
4. **Đơn nhà cung cấp:** xem trạng thái, chi phí và mã nguồn; đối soát các đơn REVIEW.

Cài mới mặc định `enabled=false`, `currencyConfirmed=false`. `gmail-api` được mua
bằng ví hiện có; `gmail-account` được đồng bộ để admin xem, chưa mở mua trên trang
nhận mã. Không đưa dữ liệu mockup hoặc số dư giả vào production.

Trần chi được kiểm trước request theo giá `info`. Provider `/buy` không nhận giá
trần hoặc khóa giá, nên không bảo đảm trần thực tế nếu nguồn đổi giá giữa hai
request. Chi phí thực tế được lưu từ receipt; cần giữ hạn mức tài khoản nguồn phù hợp.

## Tiền và giao hàng

`MailPurchase` là đơn riêng của tab Mail, dùng cùng `User.balance`, `BalanceEntry`
và khóa phân xử tiền hiện có. Không tạo Order/StockItem giả để biểu diễn kho nguồn.
Không thêm luồng nạp ví, đối soát ngân hàng hoặc email gửi tự động.

Client gửi UUID của yêu cầu, mã dịch vụ, số lượng 1–10 và giá đang xem. API lấy
giá/tồn qua `info`, tính lại giá bán từ DB, từ chối nếu khác giá đã xác nhận.
Transaction khóa theo thứ tự phân xử tiền → Setting → Offer → User, rồi ghi intent
REQUESTING, debit và ledger cùng lúc. Gọi mạng chỉ xảy ra sau commit.

Khóa unique `(userId, requestId)` làm request trùng trả cùng đơn. Mỗi intent chỉ
gửi buy một lần. Receipt và mailbox được lưu cùng transaction; mã đơn nguồn và
định danh mailbox unique chống giao trùng. Chỉ DELIVERED là giao thành công.

Timeout, receipt sai/thiếu/trùng, hoặc commit sau buy không rõ kết quả chuyển
REVIEW. REQUESTING quá hai phút cũng chuyển REVIEW khi đọc danh sách. Không tự
retry buy hoặc hoàn tiền khi chưa biết nguồn có trừ/giao hàng hay chưa.

SUPERADMIN chỉ hoàn REVIEW sau khi xác nhận chưa giao và không còn giao dịch
nguồn chưa rõ kết quả; bắt buộc lý do/bằng chứng. Refund, ledger và audit nằm cùng
transaction, gọi lại không cộng hai lần. Nếu nguồn đã giao nhưng receipt bị mất,
giữ REVIEW và xử lý đối soát; bản đầu chưa có endpoint nhập receipt thủ công.

## Đọc mã và bảo mật

- Chỉ chủ sở hữu đọc, poll, xuất và dừng nhận mã của mailbox.
- Read URL chỉ lưu server; chỉ cho `https://gapi.mailsapi.com/api/get-code?uid=...`,
  chặn redirect và không nhận URL tùy ý từ client.
- Poll khi trang hiện, mỗi ba giây, tối đa 30 mailbox/lượt và năm request nguồn
  đồng thời. Lease DB chống nhiều tab đọc cùng một mailbox.
- Parser chỉ nhận field mã rõ ràng: JSON `code=0,data.code` dạng chuỗi 4–10 số,
  mảng record cùng field, hoặc text thuần toàn bộ là mã. Không quét số từ HTML.
- Lỗi mạng/định dạng giữ mã cũ, báo lỗi đọc; không suy ra mail chết hoặc tự đặt
  thời hạn. Dừng poll không hủy mua hoặc hoàn tiền.
- Public catalog không có token, giá vốn hoặc URL đọc mã. Export có xác thực và
  `Cache-Control: no-store`; dữ liệu giao không được công khai.

Hợp đồng đọc mã thực tế phải kiểm lại với tài liệu/receipt mới của nguồn trước
khi coi là đã nghiệm thu live. Đợt triển khai này không mua mail hoặc nhận OTP thật.

## Kiểm thử và phát hành

Unit/integration trong `apps/api/src/mail/` kiểm request trùng, cạnh tranh số dư,
timeout, refund, giá, ownership, 101 mã, SSRF và sync/mua đồng thời. Migration thêm
bảng và quan hệ User; không sửa lịch sử Order/Payment/StockItem.

Test toàn repo phải dùng cluster thử riêng và truyền biến môi trường qua Turbo:

```powershell
$env:DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:PORT/review?schema=public'
$env:API_KEYS_TEST_DATABASE_URL=$env:DATABASE_URL
$env:PARTNER_TRANSACTION_TEST_DATABASE_URL=$env:DATABASE_URL
pnpm exec turbo test --env-mode=loose --force
```

Các suite tạo/xóa database riêng; không dùng URL production. Chạy thêm typecheck,
build và browser trên bản production để kiểm CSP, desktop/mobile, VI/EN/ZH.

Trước deploy: backup DB mới, kiểm gzip, backup source và image; migrate rồi rebuild
riêng API/web bằng `docker compose up -d --build --no-deps api web`. Giữ proxy và
compose override. Rollback source/image cũ giữ bảng mới; không down migration hoặc
restore DB cũ đè các đơn phát sinh sau deploy.

## English operations note

The approved sidebar UI uses authenticated APIs and persistent mailbox history.
Provider purchasing is attempted once after a durable wallet debit. Ambiguous
results require manual reconciliation; never retry them blindly. Confirm provider
currency and the live code-reading contract before activation. New installs remain
disabled; no fixture mailbox or balance is shipped to production.
