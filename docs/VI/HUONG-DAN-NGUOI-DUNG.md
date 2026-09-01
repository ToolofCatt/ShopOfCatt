# Digital Store - hướng dẫn người dùng

## 1. Bắt đầu nhanh

Digital Store là bộ mã nguồn self-hosted cho một cửa hàng sản phẩm số. Mỗi bản
cài đặt dùng một PostgreSQL riêng; không có máy chủ license, updater hay dịch vụ
bắt buộc của nhà phát hành.

Trên VPS Ubuntu/Debian đã có Docker:

```bash
chmod +x install.sh storectl
./install.sh --domain shop.example.com --admin-email owner@example.com
```

Nếu truyền `--admin-password`, dùng 12-128 ký tự gồm chữ, số hoặc
`._~@%+=:-`. Giới hạn này bảo đảm cùng file `.env` được cả Docker Compose và
`storectl` đọc nhất quán; bỏ tham số để bộ cài tự sinh mật khẩu mạnh.

Trình cài kiểm tra hệ điều hành, Docker Compose, DNS và cổng; sinh secret; ghi
`.env` với quyền `600`; dựng PostgreSQL/API/web/backup/Caddy và in URL đăng nhập.
Lần đầu khách chỉ thấy trang **Đang thiết lập**.

## 2. Wizard 6 bước

Mở `/admin/setup` và xử lý theo thứ tự:

1. **Hệ thống & cửa hàng:** DNS/HTTPS, secret, database, backup và đổi mật khẩu
   bootstrap của SUPERADMIN.
2. **Thương hiệu & giao diện:** đặt tên, logo, favicon, theme và kiểm tra preview.
3. **Thanh toán:** bật ít nhất một kênh thật; tắt cả công tắc mock trong môi
   trường và cơ sở dữ liệu.
4. **Kênh & tự động hóa:** thêm liên hệ, soạn ba chính sách; Telegram/AI chỉ bị
   bắt buộc kiểm tra kết nối khi đã bật.
5. **Sản phẩm & kho:** cần ít nhất một sản phẩm và variant đang bán, cùng một món
   kho `AVAILABLE`. Phép thử rollback không tạo đơn và không tiêu hao key.
6. **Kiểm tra & xuất bản:** chạy lại toàn bộ blocker trên máy chủ, sau đó bấm
   **Xuất bản**.

`pass` là đạt, `warn` không chặn, `fail` chặn xuất bản, `stale` là kết quả cũ sau
khi cấu hình liên quan thay đổi. Cửa hàng đã xuất bản không tự đóng khi một dịch
vụ tạm thời lỗi; readiness vẫn cảnh báo và thanh toán tiếp tục fail-closed.

## 3. Page Builder

Mở `/admin/design`:

- Palette bên trái chứa block bố cục và nội dung.
- Canvas ở giữa cho kéo block để sắp xếp; toolbar đổi trang, VI/EN/ZH và
  desktop/mobile.
- Inspector bên phải sửa block đang chọn hoặc theme/thương hiệu khi chưa chọn.
- Draft tự lưu sau khoảng 800 ms. Hai tab cùng sửa dùng CAS; tab cũ không ghi đè
  được tab mới.
- Undo/redo chỉ tác động draft. Xuất bản tạo snapshot bất biến; hệ thống giữ 20
  revision gần nhất. Khôi phục luôn tạo revision mới thay vì sửa lịch sử.

Block nghiệp vụ như danh sách hàng, buy box, thanh toán, trạng thái đơn và key đã
giao không thể bị xóa, nhân bản hoặc sửa logic. Builder không nhận JavaScript,
CSS, HTML tùy ý hay địa chỉ nhận tiền. Rich text được API sanitize.

Media chỉ nhận PNG/JPEG/WebP, tối đa 1 MB và 2400 x 2400 px. Trình duyệt kiểm tra
trước để báo nhanh; API vẫn kiểm magic byte và kích thước lại.

## 4. Thanh toán và kho

- Giá, số tiền đơn và giảm giá luôn được tính lại từ database.
- Mỗi dòng `StockItem` là một món hàng. Đơn giữ kho bằng
  `FOR UPDATE SKIP LOCKED` trong một transaction; hết hạn thì nhả lại.
- Production phải để `PAYMENT_MOCK=false` và tắt mock trong trang cấu hình.
- Khóa Binance tài khoản thường chỉ bật **Enable Reading**; tắt Withdraw/Trade.
- SePay cần số tài khoản, ngân hàng, tỉ giá và khóa webhook. Request webhook sai
  khóa phải trả `401`.

Wizard không chuyển tiền thử. Phép thử webhook gửi thông tin vô hiệu và mong bị
từ chối; phép thử kho dùng khóa PostgreSQL thật rồi chủ động rollback.

## 5. Telegram và AI

Telegram nằm tại `/admin/telegram`: token không bao giờ được trả lại trình duyệt.
Bật bot thì check kết nối phải đạt; tắt bot thì wizard chỉ cảnh báo. Hỗ trợ đơn,
bảo hành và thông báo chủ shop dùng chung dữ liệu của deployment này.

Dịch AI là tùy chọn. Khi bật, điền provider, base URL, model và key trong Cấu
hình. Key chỉ được ghi, không được echo về UI hay audit log.

## 6. Vận hành, backup và khôi phục

```bash
./storectl status
./storectl logs api
./storectl doctor
./storectl doctor --json
./storectl backup
```

Backup container chỉ ghi `backups/.last-success.json` sau khi `pg_dump`,
`gzip -t` và marker cuối dump đều đạt. Nên đồng bộ `backups/` sang máy hoặc vùng
khác. Khôi phục trong cửa sổ bảo trì:

```bash
./storectl restore backups/webcatt-YYYYMMDD-HHMMSS.sql.gz
```

Thử khôi phục định kỳ quan trọng hơn việc chỉ nhìn thấy file backup.

## 7. Xử lý lỗi

- Wizard báo `stale`: bấm **Kiểm tra bước này**.
- Không publish được: xem mọi dòng `fail`, không chỉ bước đang mở.
- Webhook treo: kiểm tra khóa, URL HTTPS, log API và thời gian máy chủ.
- Bot không trả lời: kiểm token, lỗi long-polling `409` và đảm bảo chỉ chạy một
  API instance.
- Build Windows lỗi symlink: bật Developer Mode hoặc dùng terminal admin;
  Docker Linux không gặp giới hạn này.
- Trước khi sửa tiền/kho, đọc `AGENTS.md` và `docs/AGENT-GUIDE.md`.

## 8. Quyền phân phối

Mã gốc phát hành theo MIT. Người nhận có thể sửa, phân phối, cấp phép lại hoặc
bán lại, nhưng phải giữ thông báo bản quyền/giấy phép và notice của bên thứ ba.
Không có license runtime, updater hay cam kết cập nhật.
