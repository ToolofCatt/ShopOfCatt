# Danh sách kiểm khi thêm hoặc đổi tính năng

Mỗi mục dưới đây là một chuỗi file **phải sửa cùng nhau**. Bỏ sót một mắt xích là
lỗi lúc chạy chứ không phải lỗi biên dịch — trừ những chỗ đã cố tình gài rào chắn.

---

## Thêm một phương thức thanh toán

1. `packages/shared/src/index.ts` — thêm giá trị vào union `PaymentMethod`.
2. `apps/api/src/orders/dto/select-payment.dto.ts` — thêm vào mảng
   `PAYMENT_METHODS`.
   → Đã có **rào chắn lúc biên dịch**: nếu quên bước này, `MissingPaymentMethod`
   khác `never` và build hỏng. Đây là kết quả của một lỗi thật (thiếu
   `bank_transfer` khiến mọi lần chọn phương thức đều trả 400).
3. `apps/api/src/settings/settings.service.ts` → `getEnabledMethods()` — quy tắc
   "bật khi nào". Phương thức thiếu cấu hình phải **bị loại khỏi danh sách**, chứ
   không hiện nút hỏng cho khách.
4. `getReadiness()` cùng file — chủ shop **phải** thấy được là mình bật rồi nhưng
   thiếu cấu hình. Đây là loại lỗi im lặng: giao diện trông vẫn bình thường,
   chỉ khách mới thấy lỗi lúc bấm đặt hàng.
5. `apps/api/src/orders/orders.service.ts` — nhánh tạo phiên thanh toán.
6. Giao diện thanh toán `apps/web/app/checkout/[code]/page.tsx`.
7. Cả ba từ điển `vi.ts` / `en.ts` / `zh.ts`.
8. Nếu có webhook: xác minh chữ ký trên **`rawBody`**, không phải trên JSON đã
   parse. `main.ts` đã bật `rawBody: true` cho việc này.

---

## Thêm chữ hiển thị trên web

`apps/web/lib/i18n/dictionaries/` — sửa đủ **ba** file:

- `vi.ts` là **nguồn chuẩn**: kiểu `Dictionary` được suy ra từ chính nó.
- `en.ts` và `zh.ts` khai báo `: Dictionary`, nên thiếu khoá là **lỗi biên dịch**.

Không cần lo quên — `pnpm typecheck` sẽ chặn. Nhưng phải dịch cho tử tế, đừng để
nguyên tiếng Việt trong `en.ts`.

---

## Thêm thông báo lỗi từ API

`apps/api/src/i18n/messages.ts`:

1. Thêm khoá vào `K` (ví dụ `K.bankRateRequired`).
2. Thêm bản dịch cho **cả ba ngôn ngữ**.
3. Service/DTO ném ra **khoá**, không ném chuỗi tiếng Việt:
   `throw new BadRequestException(K.bankRateRequired)`.

`I18nExceptionFilter` (đăng ký trong `main.ts`) dịch theo header
`Accept-Language` trước khi trả về.

---

## Đổi schema cơ sở dữ liệu

```bash
# 1. Sửa apps/api/prisma/schema.prisma
# 2. Sinh migration
pnpm --filter @webcatt/api db:migrate
# 3. Kiểm chứng migration chạy được trên CSDL RỖNG (quan trọng nhất)
```

**Vì sao bước 3 quan trọng:** thư mục migration sắp xếp theo tên. Đã từng có bản
migration sửa một bảng mà bản tạo bảng đó lại đứng sau nó theo thứ tự chữ cái →
`migrate deploy` chết trên máy mới, container lặp vô hạn, **không gì khởi động
được**. Lịch sử migration hiện tại đã được gộp lại thành một bản nền `0_init`.

Kiểm chứng bằng shadow database:

```bash
pnpm --filter @webcatt/api exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:postgres@localhost:5433/shadow_kiemtra"
# Kết quả mong đợi: "This is an empty migration."
```

Đổi schema thì thường phải đổi luôn `packages/shared` (kiểu DTO) — cứ để trình
biên dịch chỉ ra chỗ nào hỏng.

---

## Thêm endpoint quản trị

```ts
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)   // ← cả hai
export class AdminController { ... }
```

- Endpoint có thể bị lạm dụng (tra cứu, gửi biểu mẫu, xuất dữ liệu) thì thêm
  `@RateLimit({ limit, windowMs })` từ `security/rate-limit.guard.ts`.
- **Route cụ thể phải khai báo TRƯỚC route có tham số.** `@Get('orders/export')`
  đứng trên `@Get('orders/:code')`, nếu không Nest hiểu `"export"` là một mã đơn
  và trả 404 "Đơn hàng không tồn tại".
- Thao tác thay đổi dữ liệu thì ghi nhật ký qua `AuditService`.
- Trả file (CSV, …) thì dùng `@Res({ passthrough: true })` và đặt
  `Content-Type` + `Content-Disposition`. Phía web **không dùng được thẻ `<a
  href>`** vì endpoint cần header `Authorization` — phải `fetch` rồi tạo blob URL.

---

## Thêm trang quản trị mới

- Dùng lại `components/admin/`: `PageHeader`, `Tabs`, `Pagination`, `StatCard`,
  `RevenueChart`, `ReadinessBanner`. Các thành phần dùng chung với trang khách
  (`Button`, `Card`, `Input`, `Spinner`, `EmptyState`, `Badge`) nằm ở
  `components/ui.tsx`.
- Trang là client component (`'use client'`), lấy token qua `useAuth()`, gọi
  `apiFetch` từ `lib/api.ts`.
- Cần địa chỉ API thô (tải file) thì dùng `apiBaseUrl()`, đừng tự ghép chuỗi.
- Thêm liên kết vào thanh điều hướng quản trị và khoá dịch tương ứng.

---

## Nội dung do admin tự soạn (HTML)

Thông báo trang chủ và trang chính sách cho phép admin nhập HTML. Mọi nội dung
kiểu này **phải** đi qua `sanitize-html` với danh sách thẻ/thuộc tính cho phép,
lọc ở **máy chủ** trước khi lưu. Không tin phía web đã lọc.

---

## Thêm biến môi trường

1. `.env.docker.example` — bắt buộc thì để **trống** và dùng `${VAR:?...}` trong
   `docker-compose.yml`, để container từ chối khởi động thay vì chạy với giá trị
   mẫu.
2. `apps/api/.env.example` cho môi trường dev.
3. `docker-compose.yml` — truyền vào service tương ứng.
4. `docs/TRIEN-KHAI.md` — nếu người triển khai cần biết.
5. Là bí mật thì thêm giá trị mẫu vào danh sách chặn (`auth.module.ts`,
   `prisma/seed.ts`). Repo công khai ⇒ chuỗi mẫu không bao giờ được phép chạy thật.

Đối chiếu nhanh compose ↔ file mẫu (không thiếu, không thừa):

```bash
node -e "
const fs=require('fs');
const raw=fs.readFileSync('docker-compose.yml','utf8');
const env=new Set(fs.readFileSync('.env.docker.example','utf8').split(/\r?\n/)
  .filter(l=>/^[A-Za-z0-9_]+=/.test(l)).map(l=>l.split('=')[0]));
for(const m of raw.matchAll(/\\\$\{([A-Za-z0-9_]+)((:\?|:-|\?|-)([^}]*))?\}/g))
  if(!env.has(m[1])) console.log('thieu trong .env mau:', m[1]);
for(const k of env) if(!raw.includes('\${'+k)) console.log('thua trong .env mau:', k);
"
```
