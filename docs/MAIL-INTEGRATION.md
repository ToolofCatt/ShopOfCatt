# Tích hợp Mail — 5Mail

> Đây là đề xuất ban đầu ngày 24/09. Phạm vi đã triển khai, cấu hình và quy trình
> vận hành mới nằm trong [MAIL-WORKSPACE.md](./MAIL-WORKSPACE.md).

Trạng thái 24/09/2026: đã chuẩn bị adapter API và kiểm thử hợp đồng; chưa gắn vào
luồng thanh toán, chưa bật bán, chưa gọi mua thật. Kiểm tra lại chi tiết
`g_api_chatgpt` và cả hai danh mục đã trả `code=0/SUCCESS`: gmail-api có 88 mục,
gmail-account có 5 mục tại thời điểm kiểm tra. Không lưu token trong tài liệu
hoặc mã nguồn. Cần xác nhận đơn vị giá vốn trước khi bật bán.

## Phạm vi đã chốt

Chủ shop chọn cả quản trị và khách: cấu hình giá bán, khách mua và giao tự động.
Tách khu Mail khỏi sản phẩm kho hiện tại. Web có `/mail`, admin có `/admin/mail`.
Telegram có nút Mail mở cùng danh mục, dùng lại đơn hàng, thanh toán, lịch sử,
copy, tải TXT và link xem đơn hiện có. Không tạo ví hoặc hệ thống đối soát thứ hai.

### Quản trị

Tab ngang: **Danh mục**, **Giá bán**, **Đơn nhà cung cấp**, **Kết nối**.

- Kết nối: token chỉ nhận một chiều; trả `tokenSet` và bốn ký tự cuối. Chỉ
  SUPERADMIN đổi token/bật mua tự động. ADMIN xem danh mục và cấu hình sản phẩm
  theo quyền hiện có. Không có token trong URL trình duyệt, log hay audit.
- Danh mục: chuyển `gmail-api` / `gmail-account`, tìm theo tên/mã, làm mới,
  giá vốn, tồn nhà cung cấp, thời điểm đồng bộ; phân biệt lỗi tải và kho bằng 0.
- Giá bán: đặt tên hiển thị, giá bán theo cơ chế neo hiện có, giới hạn số lượng,
  giá vốn tối đa cho mỗi món, bật/tắt từng mã. Không tự lấy giá vốn làm giá bán.
  Chưa cấu hình giá hoặc chưa xác nhận đơn vị tiền thì không thể bật bán.
- Đơn nhà cung cấp: mã đơn shop, mã 5Mail, số lượng, chi phí thực tế, trạng thái,
  thời điểm gửi/nhận. Không hiển thị mật khẩu hoặc URL nhận mã trong bảng chung.
- Đơn không rõ kết quả: cho phép ghi nhận kết quả đối soát có audit và nhập hàng
  đã mua. Không đặt nút “Thử lại” gọi `/buy` mù; cần chứng cứ chưa mua mới tạo
  lần mua mới có xác nhận chủ shop.

### Khách

- Tab Mail gồm hai nhóm trên, giá bán công khai, tồn khả dụng gần nhất, mô tả
  định dạng hàng và điều kiện sử dụng do shop soạn.
- Chọn loại và số lượng → kiểm lại tồn/giá vốn → tạo đơn shop → chọn thanh toán.
- Chỉ mua nhà cung cấp sau khi đơn đã trả tiền thật; đơn chờ/hủy không mua.
- Khi đang xử lý: hiện “Đã thanh toán, đang lấy mail”. Không báo giao thành công
  trước khi lưu hàng vào CSDL. Khi cần đối soát: thông báo rõ và liên hệ hỗ trợ.
- Giao nguyên văn `details[].text`; dùng các nút copy/TXT/web đã có. Không tự
  truy cập URL nhận OTP trong `details[].url`, không gửi email hoặc đăng nhập mail.

## Kiến trúc đề xuất

`mail/` chia `fivemail.client`, cấu hình, danh mục, ánh xạ giá bán, worker mua,
API quản trị và API public. Module nhà cung cấp không phụ thuộc Telegram/web.

Adapter hiện có `list`, `info`, `buy` gọi duy nhất origin HTTPS của 5Mail;
timeout 15 giây, không redirect, giới hạn phản hồi 2 MB. Kiểm `code===0`, kiểu
giá/tồn, mã sản phẩm và số món được giao. Lỗi phía ngoài được thay bằng khóa
i18n; không echo URL có token. `buy` tuyệt đối không tự retry.

### Dữ liệu cần bổ sung trước khi nối bán

1. `MailProviderSetting`: token, enabled, currency, xác nhận đơn vị tiền,
   giới hạn chi theo đơn/ngày, metadata lần kiểm kết nối. Mặc định tắt.
2. `MailOffer`: category + providerCode unique, variantId unique, giá vốn snapshot,
   stock snapshot, syncedAt, maxUnitCost, active. Giá bán nằm ở ProductVariant
   để giữ nguyên logic giảm giá theo phương thức/coupon.
3. `MailFulfillment`: orderItemId unique, providerCode/category snapshot, quantity,
   maxCost snapshot, state, providerOrderNo unique, actualCost, timestamps,
   mã lỗi chuẩn hóa; nội dung nhận được chỉ lưu ở vùng dữ liệu riêng có quyền.
4. `StockItem` chỉ được tạo khi nhà cung cấp đã trả hàng thật. Không dùng dòng
   kho rỗng/giả để biểu diễn tồn API; không sửa định nghĩa mỗi dòng là một món.

Ở bước đặt đơn, loại Mail tạo intent riêng thay vì gọi giữ StockItem nội bộ.
Trừ các intent đang chờ khỏi snapshot tồn khi tính khả dụng; khóa bản ghi offer
để tránh vượt số lượng nội bộ. Đây không phải giữ hàng ở 5Mail: provider không
có API giữ kho, nên vẫn có thể hết hàng trước lúc thanh toán.

Worker chạy sau commit PAID; dùng claim CAS nguyên tử trên intent. Gọi mạng
ngoài transaction. Khi có kết quả, transaction khóa Order → Variant → StockItem,
lưu receipt + tạo hàng thật gắn đúng orderItem, rồi dùng luồng giao hàng hiện có.
Ghi cùng transaction để replay không nhập/giao trùng. Worker không được chặn
đơn kho thường hoặc giữ financial lock trong lúc chờ mạng.

## Trạng thái mua và lỗi không rõ kết quả

`WAITING_PAYMENT → READY → REQUESTING → RECEIVED → DELIVERED`.

- PENDING/CANCELLED: không chuyển READY và không gọi nhà cung cấp.
- READY: đọc lại info, kiểm stock và giá vốn không vượt trần đã chốt. Không đủ
  hàng hoặc giá tăng quá trần → NEEDS_REVIEW, chưa gọi buy.
- REQUESTING ghi trước I/O. Hai worker chỉ một worker thắng CAS.
- Timeout, lỗi mạng, JSON sai, thiếu món, mã sản phẩm sai hoặc restart lúc
  REQUESTING → UNKNOWN/NEEDS_REVIEW. Không tự mua lại.
- RECEIVED: lưu nội dung đầy đủ trước khi phát sự kiện giao; DB ghi lỗi sau
  khi mua là sự cố cần đối soát, không được gửi request mua lần hai.
- Giá provider giữa `info` và `buy` có thể thay đổi: `/buy` hiện không nhận
  maxPrice, nên kiểm trước không bảo đảm tuyệt đối trần chi. Phải xác nhận chính
  sách provider hoặc giới hạn tài khoản cung cấp trước khi bật tự động.
- Hoàn tiền chỉ qua ledger/quy trình quản trị hiện hành, không tự sửa số dư.

## Những thông tin còn thiếu từ hợp đồng 5Mail

- Token đã xác thực đọc danh mục và chi tiết; quyền mua cần kiểm tra riêng
  bằng giao dịch thử có ngân sách được cho phép.
- `price`/`totalPrice` là USD, USDT hay đơn vị ví riêng? Không đoán theo ví dụ.
- API kiểm số dư, tra cứu đơn theo orderNo/client reference, lịch sử đơn và
  quy tắc retry/idempotency; token được cấp không chứng minh quyền mua.
- Mã lỗi nào bảo đảm chưa trừ tiền, có giao một phần không, giới hạn count và
  rate limit? Thời gian timeout đề nghị? Có khóa giá trước mua không?
- Điều kiện bảo hành và thời hạn truy cập URL nhận mã, chính sách mua lại/refund.

## Thứ tự thi công và nghiệm thu

1. Xác thực token bằng list/info; xác nhận tiền tệ và phân loại lỗi nhà cung cấp.
2. Migration riêng, fresh/upgrade tests; giữ default tắt, không chạm kho lịch sử.
3. Admin Mail + giá bán + public `/mail`; test VI/EN/ZH, desktop/mobile, trạng
   thái trống/đang tải/lỗi, không lộ token trong response/audit/log.
4. Nối tạo intent vào web/Telegram, thanh toán hiện có; kiểm coupon, giảm phương
   thức, số dư, callback trùng, stale stock, giá tăng và hết hạn đơn.
5. Worker + tests với transport giả: webhook lặp, hai worker, timeout sau mua,
   response thiếu/trùng/mã sai, crash sau claim/sau mua/trước commit, quyền xem
   đơn, TXT/copy nguyên văn. Chứng minh không trừ ví/mua/giao hai lần.
6. Có endpoint lịch sử hoặc quy trình đối soát rõ mới nghiệm thu tự động hóa;
   mua thử thật cần ngân sách và số lượng cụ thể được chủ shop cho phép.
7. Typecheck, unit/integration trên PostgreSQL cô lập, build Linux, backup,
   deploy API/web, giữ proxy; bật từng sản phẩm sau khi kiểm đủ cấu hình.

## English handoff

Scope: dedicated Mail storefront/admin areas with configurable resale prices,
existing checkout/Telegram delivery, and provider purchasing only after payment.
Retesting confirmed code0/SUCCESS for product info and both categories.
Provider currency is unconfirmed. No live purchase has been made. Adapter tests
use synthetic transport. Do not retry an ambiguous purchase: this contract has
no idempotency key or order reconciliation API. Do not fabricate StockItem rows
to represent upstream inventory, expose provider tokens, fetch OTP links, or
automatically credit/refund wallets. Complete the gates above before activation.
