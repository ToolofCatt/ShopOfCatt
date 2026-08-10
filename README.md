# Catt Store — Web bán hàng số (digital goods)

Web bán hàng số chuyên nghiệp giao diện **trắng đen**: bán key bản quyền, gift card, mã kích hoạt... **Giao hàng tự động** ngay sau khi thanh toán — **mỗi dòng trong kho = 1 sản phẩm** được giao. Thanh toán crypto (USDT) qua **Binance Pay**, kèm chế độ **giả lập thanh toán** để dev/demo không cần tài khoản Binance Merchant.

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Frontend `apps/web` | Next.js 15 (App Router) · React 19 · Tailwind CSS v4 · lucide-react · Geist font |
| Backend `apps/api` | NestJS 11 · Prisma 6 · JWT · Binance Pay API |
| Database | PostgreSQL 16 |
| Dùng chung `packages/shared` | TypeScript types + hằng số dùng chung FE/BE |
| Đa ngôn ngữ | Tiếng Việt · English · 中文 (cả giao diện lẫn thông báo lỗi từ API) |
| Triển khai | Docker + docker compose (image multi-stage, có healthcheck) |

## Sản phẩm nhiều loại, nhiều giá

Một sản phẩm có thể có **nhiều loại** (ví dụ *Canva Pro*: gói 1 tháng / 1 năm), **mỗi loại có giá và kho riêng**. Khách chọn loại ngay trên trang sản phẩm; giá và tồn kho đổi theo lựa chọn. Trang chủ hiển thị *"Từ 4.99 USDT"* khi các loại khác giá nhau.

Trong trang quản trị, mỗi sản phẩm có bảng **Loại sản phẩm** để thêm/sửa/xoá loại, và ô nhập kho riêng cho từng loại (vẫn theo nguyên tắc *mỗi dòng = một sản phẩm giao*).

## Tự động dịch nội dung (Claude API)

Admin chỉ cần nhập **tiếng Việt** — hệ thống tự dịch tên, mô tả, danh mục và tên các loại sang **English** và **中文**, lưu vào database và hiển thị theo ngôn ngữ khách đang chọn.

```env
# apps/api/.env  (hoặc .env ở gốc khi chạy Docker)
ANTHROPIC_API_KEY="sk-ant-..."
```

Lấy khóa tại [platform.claude.com](https://platform.claude.com) → **API keys**. Để trống thì nút *"Dịch tự động"* báo chưa cấu hình, mọi chức năng khác vẫn chạy bình thường (nội dung hiển thị tiếng Việt cho cả 3 ngôn ngữ).

Bản dịch chạy **nền** sau khi lưu sản phẩm nên thao tác lưu không bị chậm; nút *"Dịch tự động"* trong trang sửa sản phẩm cho phép dịch lại và xem kết quả ngay.

## Hộp thông báo trang chủ

Trang quản trị có mục **Thông báo**: bật/tắt, nhập tiêu đề + nội dung tiếng Việt (dịch được sang EN/ZH), hiển thị ngay đầu trang chủ. Tắt thì trang chủ vào thẳng lưới sản phẩm.

## Đa ngôn ngữ (VI / EN / ZH)

Bấm biểu tượng 🌐 trên thanh điều hướng để đổi giữa **Tiếng Việt**, **English**, **中文**.

- Lựa chọn được lưu trong cookie `wc_locale`, nên cả trang render sẵn ở server (trang chủ, trang sản phẩm) lẫn trang chạy ở trình duyệt đều đổi theo.
- Khách truy cập lần đầu được đoán ngôn ngữ theo `Accept-Language` của trình duyệt.
- Web gửi kèm ngôn ngữ khi gọi API, nên **thông báo lỗi từ máy chủ cũng đúng ngôn ngữ** (ví dụ *"Sản phẩm không đủ hàng"* / *"does not have enough stock"* / *"库存不足"*).
- Thêm/sửa câu chữ: `apps/web/lib/i18n/dictionaries/{vi,en,zh}.ts` (bản `vi.ts` là chuẩn — thiếu khoá ở `en`/`zh` sẽ báo lỗi biên dịch) và `apps/api/src/i18n/messages.ts` cho thông báo phía API.
- Tên và mô tả **sản phẩm** lấy từ cơ sở dữ liệu nên hiển thị đúng như admin nhập, không tự dịch.

---

> **Triển khai lên máy chủ thật?** Đọc [docs/TRIEN-KHAI.md](docs/TRIEN-KHAI.md)
> — hướng dẫn từng bước cho VPS + tên miền + HTTPS, kèm danh sách kiểm
> **trước khi bán đơn đầu tiên**.

## 🚀 Cách 1 — Chạy bằng Docker (khuyến nghị)

Yêu cầu: **Docker Desktop** (hoặc Docker Engine + plugin compose). Không cần cài Node, pnpm hay PostgreSQL.

```bash
# 1. Tạo file cấu hình từ mẫu rồi sửa JWT_SECRET
cp .env.docker.example .env          # Windows: Copy-Item .env.docker.example .env

# 2. Dựng và chạy toàn bộ (database + api + web)
docker compose up -d --build
```

Xong. Lần đầu container API sẽ tự **chạy migration** tạo bảng và **seed dữ liệu mẫu** (vì `SEED_ON_START=true`).

| Dịch vụ | Địa chỉ |
|---|---|
| Cửa hàng | http://localhost:3000 |
| Trang quản trị | http://localhost:3000/admin |
| API | http://localhost:3001/api |
| Health check | http://localhost:3001/api/health |
| PostgreSQL (từ máy thật) | `localhost:5433` |

Lệnh thường dùng:

```bash
docker compose logs -f api      # xem log API
docker compose ps               # trạng thái + healthcheck
docker compose restart api      # khởi động lại 1 dịch vụ
docker compose down             # dừng (giữ nguyên dữ liệu)
docker compose down -v          # dừng và XÓA SẠCH dữ liệu database
docker compose exec api node dist-seed/seed.js   # seed lại thủ công
```

---

## 🛠 Cách 2 — Chạy trực tiếp trên máy (không cần Docker)

Yêu cầu: Node.js ≥ 20, pnpm (`npm i -g pnpm`).

```bash
pnpm install

# Cấu hình. JWT_SECRET và ADMIN_PASSWORD để trống trong file mẫu — máy chủ và
# seed từ chối chạy cho tới khi bạn tự đặt (repo công khai, chuỗi mẫu không an toàn).
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
echo "JWT_SECRET=\"$(openssl rand -base64 48 | tr -d '\n')\"" >> apps/api/.env
echo "ADMIN_PASSWORD=\"$(openssl rand -base64 18 | tr -d '\n')\"" >> apps/api/.env

# Khởi động PostgreSQL — chọn MỘT trong hai:
pnpm db:embedded                              # PostgreSQL nhúng, giữ cửa sổ này mở
docker compose -f docker-compose.dev.yml up -d # hoặc chỉ chạy database bằng Docker

# Cửa sổ terminal khác:
pnpm db:deploy    # tạo bảng (chạy migration)
pnpm db:seed      # tạo tài khoản chủ shop (SEED_DEMO=true để có thêm hàng mẫu)
pnpm dev          # web :3000 + api :3001
```

---

## Tài khoản chủ cửa hàng

Seed **không có mật khẩu mặc định**. Đặt trong `apps/api/.env` (hoặc `.env` ở gốc khi chạy Docker)
trước khi chạy `pnpm db:seed`:

```env
ADMIN_EMAIL="ban@vidu.com"
ADMIN_PASSWORD="mat-khau-manh-cua-ban"
```

Seed chỉ **tạo mới** tài khoản này khi chưa tồn tại — chạy lại không ghi đè mật khẩu
hay vai trò của tài khoản đang dùng.

Đặt `SEED_DEMO=true` nếu muốn thêm sản phẩm/khách hàng mẫu để xem thử
(khách demo `user@cattstore.local` / `User@123`). Cửa hàng thật để `false`.

## Luồng bán hàng số

1. Admin tạo sản phẩm, dán kho vào ô "Kho hàng" — **mỗi dòng là một key/mã** sẽ giao cho khách.
2. Khách bấm **Mua ngay** → hệ thống **giữ chỗ** đúng số dòng trong kho, tạo đơn + phiên thanh toán (đơn hết hạn sau 30 phút thì tự nhả kho).
3. Khách thanh toán qua Binance Pay (QR / app) — hoặc cổng giả lập khi `PAYMENT_MOCK=true`.
4. Webhook/kiểm tra thanh toán xác nhận → các dòng kho chuyển **ĐÃ BÁN** và hiện ngay trong đơn hàng của khách (sao chép từng dòng / tải file .txt).

---

## Chi tiết cấu hình Docker

### Các dịch vụ

| Dịch vụ | Mô tả |
|---|---|
| `postgres` | PostgreSQL 17 (UTF-8), dữ liệu lưu ở volume `webcatt_pgdata`, chỉ nghe trên `127.0.0.1` |
| `api` | NestJS — tự chạy `prisma migrate deploy` khi khởi động, có healthcheck `/api/health` |
| `web` | Next.js bản `standalone` — image gọn, chỉ chứa file cần chạy |
| `proxy` | Caddy — đường vào duy nhất từ Internet, tự xin + tự gia hạn chứng chỉ Let's Encrypt |
| `backup` | `pg_dump` định kỳ ra `./backups`, tự xoá bản cũ theo `BACKUP_KEEP` |

`web` chỉ khởi động sau khi `api` báo **healthy**, và `api` chỉ khởi động sau khi `postgres` sẵn sàng.

**Web và API chỉ nghe trên `127.0.0.1`** (biến `APP_BIND`) — mọi truy cập từ ngoài đi qua `proxy` để luôn có HTTPS. Publish thẳng ra `0.0.0.0` là để lộ HTTP không mã hoá, và Docker tự ghi luật DNAT vượt qua `ufw` nên tường lửa cũng không chặn được.

### ⚠️ Biến `NEXT_PUBLIC_API_URL` được nhúng lúc build

Next.js nhúng các biến `NEXT_PUBLIC_*` vào bundle **khi build**, không đọc lúc chạy. Vì vậy trình duyệt sẽ gọi API bằng đúng giá trị lúc build image. Khi đổi giá trị này, phải build lại:

```bash
docker compose up -d --build web
```

### Một tên miền duy nhất, HTTPS tự động

Web và API dùng chung một origin nên **không dính CORS**, và Caddy tự lo chứng chỉ.

```bash
# Trong .env:
SITE_DOMAIN=shop.cua-ban.com     # đã trỏ A/AAAA về máy chủ này
ACME_EMAIL=ban@vidu.com
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_SITE_URL=https://shop.cua-ban.com
WEB_URL=https://shop.cua-ban.com
API_PUBLIC_URL=https://shop.cua-ban.com

docker compose up -d --build
# → https://shop.cua-ban.com
```

Caddy chuyển `/api/*` sang container API, phần còn lại sang web (xem `docker/Caddyfile`). Chạy thử trong máy thì để `SITE_DOMAIN=localhost` — chứng chỉ tự ký, trình duyệt cảnh báo nhưng luồng vẫn đúng.

📘 Từng bước chi tiết cho VPS: [docs/TRIEN-KHAI.md](docs/TRIEN-KHAI.md)

### Checklist trước khi chạy thật (production)

- [ ] Điền `JWT_SECRET`, `POSTGRES_PASSWORD`, `ADMIN_PASSWORD` — cả ba để trống trong file mẫu, container **từ chối khởi động** cho tới khi bạn tự đặt. Mật khẩu Postgres chỉ dùng chữ và số (nó nằm giữa chuỗi kết nối).
- [ ] Đặt `SITE_DOMAIN` + `ACME_EMAIL` theo tên miền thật đã trỏ DNS
- [ ] Đặt `WEB_URL` / `API_PUBLIC_URL` / `NEXT_PUBLIC_SITE_URL` = `https://<tên miền>`, `NEXT_PUBLIC_API_URL=/api`, rồi **build lại web**
- [ ] Giữ `APP_BIND=127.0.0.1` — chỉ đổi khi bạn thật sự cần bỏ qua HTTPS
- [ ] `PAYMENT_MOCK=false` (mặc định), và bật ít nhất một phương thức thanh toán thật trong `/admin/settings`
- [ ] Mở `/admin` xem **dải cảnh báo đỏ ở đầu trang tổng quan** — hết cảnh báo mới thật sự bán được
- [ ] Chạy thử **khôi phục** từ một bản sao lưu (`./docker/restore.sh`) trước khi bán đơn đầu tiên

---

## Cấu hình Binance Pay thật

1. Đăng ký [Binance Merchant](https://merchant.binance.com), lấy **API Key** + **API Secret**.
2. Sửa `.env` (Docker) hoặc `apps/api/.env` (chạy trực tiếp):
   ```env
   PAYMENT_MOCK=false
   BINANCE_PAY_API_KEY="..."
   BINANCE_PAY_API_SECRET="..."
   API_PUBLIC_URL="https://api.ten-mien-cua-ban.com"   # Binance gọi webhook về đây — cần HTTPS public
   ```
3. Webhook nhận tại `POST /api/payments/binance/webhook` (chữ ký RSA được xác thực tự động). Khi dev local không có domain public, nút **"Kiểm tra thanh toán"** trên trang thanh toán sẽ tự đối soát với Binance.

---

## Lệnh hữu ích

| Lệnh | Tác dụng |
|---|---|
| `pnpm dev` | Chạy web + api (watch) |
| `pnpm build` | Build toàn bộ |
| `pnpm db:embedded` | PostgreSQL nhúng (không cần Docker) |
| `pnpm db:deploy` | Áp dụng migration vào database |
| `pnpm db:seed` | Tạo admin + sản phẩm mẫu |
| `pnpm --filter @webcatt/api db:migrate --name ten_thay_doi` | Tạo migration mới sau khi sửa `schema.prisma` |
| `pnpm docker:up` / `docker:down` / `docker:logs` | Tắt/bật/xem log stack Docker |
| `pnpm docker:reset` | Xóa sạch dữ liệu Docker và dừng |

## Cấu trúc thư mục

```
apps/
  web/            # Next.js — cửa hàng + trang quản trị (/admin)
    Dockerfile    #   image standalone
  api/            # NestJS — REST API, Prisma, Binance Pay, giao hàng tự động
    Dockerfile    #   image production (multi-stage)
    prisma/       #   schema + migrations + seed
packages/
  shared/         # Types + hằng số dùng chung
docker/
  Caddyfile       # Reverse proxy + HTTPS tự động
  backup.sh       # pg_dump định kỳ
  restore.sh      # Khôi phục từ một bản dump
docs/SPEC.md      # Đặc tả chi tiết hệ thống
docker-compose.yml       # Toàn bộ stack
docker-compose.dev.yml   # Chỉ database, cho môi trường dev
.env.docker.example      # Mẫu cấu hình cho docker compose
```
