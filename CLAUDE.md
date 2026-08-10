# Catt Store — hướng dẫn cho agent

Cửa hàng bán **sản phẩm số** (key bản quyền, thẻ quà tặng, mã kích hoạt): khách
đặt đơn → trả tiền → hệ thống **tự giao key ngay**. Giao diện tiếng Việt, có bản
dịch Anh/Trung.

> **Mỗi dòng trong bảng `StockItem` LÀ một món hàng.** Giao nhầm, giao trùng, hay
> mất cơ sở dữ liệu đều là mất tiền thật — không có cách nào dựng lại. Đọc kỹ mục
> "Ràng buộc không được phá" trước khi sửa bất cứ thứ gì liên quan đến đơn hàng,
> thanh toán hoặc kho.

---

## Chạy và kiểm tra

```bash
pnpm install

# Cấu hình lần đầu (JWT_SECRET và ADMIN_PASSWORD để TRỐNG có chủ ý — xem README)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

pnpm db:embedded    # PostgreSQL nhúng ở cổng 5433 — giữ cửa sổ này mở
pnpm db:deploy      # chạy migration
pnpm db:seed        # tạo tài khoản chủ shop
pnpm dev            # web :3000 + api :3001

pnpm typecheck      # bắt buộc xanh trước khi commit
pnpm test           # vitest — 38 test (28 api + 10 shared)
pnpm build
```

API nằm sau tiền tố `/api` (`app.setGlobalPrefix('api')`), nên địa chỉ đầy đủ là
`http://localhost:3001/api/...`.

### Ba cái bẫy trên Windows

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `pnpm build` treo vài phút rồi vẫn chưa xong | `next dev` đang giữ khoá thư mục `.next` | Dừng dev server rồi build lại — build sạch chỉ mất ~35 giây |
| `EPERM` khi `pnpm install` | API đang chạy, giữ file DLL của Prisma query engine | Dừng API trước |
| `pnpm test` chạy vòng lặp vô tận | Script `test` của workspace con gọi lại `turbo test` | Workspace con phải gọi thẳng `vitest run` |

---

## Bố cục

```
apps/api/          NestJS 11 + Prisma 6 + PostgreSQL 17
  src/orders/        đặt đơn, giữ kho, giao hàng, đối soát crypto
  src/payments/      cổng thanh toán, VietQR, webhook Binance Pay
  src/binance-exchange/  đọc lịch sử nạp USDT, khớp số tiền duy nhất
  src/admin/         API trang quản trị (sản phẩm, đơn, thống kê, xuất CSV)
  src/settings/      cấu hình cửa hàng + phương thức thanh toán đang bật
  src/security/      @RateLimit + guard
  src/i18n/          khoá thông báo lỗi (K) + bộ lọc dịch
  prisma/            schema, migrations, seed
apps/web/          Next.js 15 App Router + React 19 + Tailwind v4
  app/               trang khách + /admin
  lib/i18n/          từ điển vi / en / zh
packages/shared/   kiểu dữ liệu + hằng số + hàm tính tiền dùng chung
docker/            Caddyfile, backup.sh, restore.sh
docs/TRIEN-KHAI.md hướng dẫn triển khai VPS
docs/SPEC.md       đặc tả hệ thống
```

`@webcatt/shared` là **hợp đồng duy nhất** giữa API và web. Đổi một kiểu ở đây là
đổi cả hai đầu — đó là chủ ý, cứ để trình biên dịch chỉ ra mọi chỗ phải sửa.

---

## Ràng buộc không được phá

**Tiền và kho**

1. Giữ kho bằng `FOR UPDATE SKIP LOCKED` trong **một** transaction
   (`orders/fulfillment.service.ts`). Không thay bằng `findMany` rồi `update` —
   hai khách đặt cùng lúc sẽ nhận trùng key.
2. Trước khi giao hàng phải khoá dòng `Order` bằng `SELECT ... FOR UPDATE`
   (`fulfillment.service.ts:184`). Bỏ khoá này là hai lần bấm "giao lại" đồng
   thời sẽ giao gấp đôi số key.
3. Luôn khoá theo thứ tự **Order → StockItem**. Đảo thứ tự ở một chỗ là deadlock.
4. **Luôn tính lại số tiền từ CSDL.** Không bao giờ tin số tiền do client gửi lên.
5. Khớp tiền crypto chỉ đi qua `binance-exchange/deposit-matcher.ts`
   (`matchDeposits`). Đừng viết nhánh "số tiền ≥ tổng đơn thì cho qua" — đã từng
   có, và nó cho phép lấy TxID của người khác trên BscScan để nhận hàng miễn phí.
6. Đổi trạng thái đơn bằng `updateMany` có điều kiện trạng thái, hoặc CAS — không
   dùng `update` trần, để gọi lại hai lần không cộng tiền hai lần.

**Bảo mật — chủ shop đã chốt, đừng tự ý đổi**

- **Không có email tự động dưới bất kỳ hình thức nào.** Quên mật khẩu = khách
  liên hệ admin qua kênh hỗ trợ trong `/admin/settings`, admin đặt lại tay.
- Khoá Binance là khoá **chỉ đọc** (`enableReading`, không `enableWithdrawals`).
  Đừng thêm lệnh gọi API cần quyền rút tiền hay giao dịch.
- Thanh toán **fail-closed**: không bật phương thức nào thì `/orders` trả 503 với
  thông báo rõ, tuyệt đối không âm thầm rơi về cổng giả lập.
- Cổng giả lập chỉ bật khi **cả hai** đều đúng: `PAYMENT_MOCK=true` trong môi
  trường **và** công tắc trong CSDL. Một mình công tắc CSDL không đủ.
- HTML do admin soạn (thông báo, trang chính sách) phải đi qua `sanitize-html`
  với danh sách cho phép.
- Bí mật mẫu bị chặn theo tên trong `auth.module.ts` và `prisma/seed.ts`. Repo
  công khai ⇒ chuỗi mẫu = ai cũng ký được token quản trị giả. Thêm chuỗi mẫu mới
  ở đâu thì thêm luôn vào hai danh sách đó.

---

## Quy ước viết mã

- **Chú thích bằng tiếng Việt, giải thích *tại sao*, không mô tả lại code.** Chỗ
  nào từng có lỗi thì ghi rõ lỗi đó là gì — phần lớn chú thích trong repo là bằng
  chứng của một sự cố thật.
- Định danh (biến, hàm, kiểu) bằng tiếng Anh, theo đúng lối viết xung quanh.
- API **ném ra khoá thông báo** (`K.xxx` trong `i18n/messages.ts`), không ném
  chuỗi tiếng Việt. `I18nExceptionFilter` dịch theo `Accept-Language`.
- Web: `lib/i18n/dictionaries/vi.ts` là **nguồn chuẩn** — kiểu `Dictionary` suy ra
  từ nó, nên thiếu khoá ở `en.ts` hay `zh.ts` là **lỗi biên dịch**. Thêm chữ mới
  phải sửa đủ ba file.
- Tiền dùng `Prisma.Decimal` ở tầng CSDL và các hàm trong `packages/shared`
  (`sumMoney`, `calcDiscount`) — đừng cộng số thực trực tiếp.
- Route Nest cụ thể phải khai báo **trước** route có tham số:
  `@Get('orders/export')` đứng trên `@Get('orders/:code')`, nếu không "export" bị
  hiểu là mã đơn.

---

## Khi sửa những chỗ hay sai

| Việc | Nhớ sửa đủ |
|---|---|
| Thêm phương thức thanh toán | `PaymentMethod` trong shared → `PAYMENT_METHODS` trong `select-payment.dto.ts` (có rào chắn lúc biên dịch) → `settings.service.ts` `getEnabledMethods` → `orders.service.ts` → giao diện thanh toán → cả ba từ điển |
| Thêm chữ hiển thị | `vi.ts` + `en.ts` + `zh.ts` |
| Thêm thông báo lỗi API | `i18n/messages.ts` (khoá + đủ ba ngôn ngữ) |
| Đổi schema | `schema.prisma` → `pnpm --filter @webcatt/api db:migrate` → kiểm chứng migration chạy được trên CSDL **rỗng** |
| Thêm endpoint quản trị | Guard `JwtAuthGuard` + `AdminGuard`, và cân nhắc `@RateLimit` |

---

## Trước khi báo là xong

1. `pnpm typecheck && pnpm test && pnpm build` — cả ba phải xanh.
2. Đụng đến tiền/kho/thanh toán thì **chạy thử thật**, không chỉ đọc code: dựng
   đơn, gọi endpoint, xem kết quả. Ở dự án này nhiều lỗi nặng nhất chỉ lộ ra khi
   chạy.
3. Mở `/admin` xem dải cảnh báo đầu trang tổng quan — nó báo cửa hàng có đang
   thật sự bán được không.
4. Báo cáo trung thực: test hỏng thì nói hỏng kèm output; bỏ bước nào thì nói rõ.

Kiểm tra sâu hơn theo từng loại việc: dùng skill **`catt-store`**
(`.claude/skills/catt-store/`).
