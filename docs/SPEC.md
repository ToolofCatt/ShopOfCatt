# Catt Store — Digital Goods Shop — BUILD SPEC (v1)

This document is the single source of truth for building this codebase. All implementation agents MUST read it fully before writing code and MUST follow contracts exactly — the API and the Web frontend are built by different agents and only match if both follow this spec.

## 1. Product overview

A professional black-and-white (monochrome) e-commerce site for **digital goods** (license keys, gift-card codes, activation codes). Vietnamese UI.

Core model: **each stock line = one deliverable item**. Admin pastes a multi-line text; every non-empty line becomes one `StockItem`. When a customer pays for quantity N, N lines are assigned to their order and shown to them (copy / download .txt). Delivery is automatic after payment.

Payment: **Binance Pay** (crypto, USDT) via merchant API, plus a **MOCK mode** (`PAYMENT_MOCK=true`, default in dev) that simulates the gateway with a local fake-payment page so the whole flow works without Binance credentials.

The homepage IS the product listing — no marketing hero, no intermediate landing ("không lòng vòng").

## 2. Tech stack & repo layout (ALREADY SCAFFOLDED — do not recreate/modify these)

pnpm + Turborepo monorepo, root `C:\Users\cattfan\Desktop\Web_Catt`:

```
package.json / pnpm-workspace.yaml / turbo.json / tsconfig.base.json / docker-compose.yml
packages/shared      @webcatt/shared — shared TS types (ALREADY WRITTEN — see packages/shared/src/index.ts)
apps/api             @webcatt/api  — NestJS 11 + Prisma 6 + PostgreSQL (schema at apps/api/prisma/schema.prisma — ALREADY WRITTEN, do not change)
apps/web             @webcatt/web  — Next.js 15 (App Router) + React 19 + Tailwind CSS v4 + lucide-react + geist fonts
```

Already present and FROZEN (do not edit): all `package.json` files (dependencies are fixed — do NOT add new dependencies), tsconfig files, `nest-cli.json`, `next.config.ts`, `postcss.config.mjs`, `.env` / `.env.example` files, `prisma/schema.prisma`, `packages/shared/src/index.ts`, `apps/api/scripts/dev-db.ts`.

`node_modules` are installed, `@webcatt/shared` is prebuilt to `dist/`, and `prisma generate` has been run — so `pnpm --filter <pkg> typecheck` works.

**Agent boundaries:**
- API agent writes ONLY inside `apps/api/src/**` and `apps/api/prisma/seed.ts`.
- Web storefront agent writes ONLY inside `apps/web/**` (app/, components/, lib/, app/globals.css) — EXCEPT `apps/web/app/admin/**`.
- Web admin agent writes ONLY `apps/web/app/admin/**` and `apps/web/components/admin/**`.
- Import shared types from `@webcatt/shared` wherever they exist instead of redeclaring.

## 3. Environment variables

API (`apps/api/.env`, loaded via `@nestjs/config`):
- `DATABASE_URL` — postgres on localhost:5433
- `PORT` (3001), `JWT_SECRET`, `WEB_URL` (http://localhost:3000), `API_PUBLIC_URL` (http://localhost:3001)
- `PAYMENT_MOCK` ("true"/"false") — true = mock gateway
- `BINANCE_PAY_BASE_URL` (https://bpay.binanceapi.com), `BINANCE_PAY_API_KEY`, `BINANCE_PAY_API_SECRET`
- `ORDER_EXPIRE_MINUTES` (30)
- `ADMIN_EMAIL`, `ADMIN_PASSWORD` (used by seed)

Web: `NEXT_PUBLIC_API_URL` (browser → API), `API_URL` (server components → API), `NEXT_PUBLIC_SITE_NAME` ("Catt Store").

## 4. Data model (Prisma — schema already written)

Models: `User(role USER|ADMIN)`, `Product(slug, name, shortDescription, description, price Decimal, currency USDT, image?, icon?, category?, sortOrder, active)`, `StockItem(content, status AVAILABLE|RESERVED|SOLD, orderItemId?, soldAt?)`, `Order(code unique, status PENDING|PAID|DELIVERED|CANCELLED|EXPIRED, totalAmount, expiresAt, paidAt)`, `OrderItem(productName snapshot, unitPrice, quantity)`, `Payment(mode MOCK|BINANCE, merchantTradeNo unique, prepayId?, status PENDING|SUCCESS|FAILED|EXPIRED, checkoutUrl?, qrcodeLink?, deeplink?, universalUrl?, rawWebhook Json?)`.

**All Decimal fields must be serialized as `number`** in API responses (`Number(x)`).

## 5. API — NestJS (`apps/api`)

- Global prefix `api`; `NestFactory.create(AppModule, { rawBody: true })` (needed for webhook signature); `app.enableCors({ origin: WEB_URL })`; global `ValidationPipe({ whitelist: true, transform: true })`; listen on `PORT`.
- Modules: `PrismaModule` (global), `AuthModule`, `ProductsModule`, `OrdersModule`, `PaymentsModule`, `AdminModule`.
- Auth: JWT Bearer (`@nestjs/jwt`, expiresIn 7d, payload `{ sub, email, role }`). `JwtAuthGuard` verifies token AND loads the user from DB (404→401 if deleted), attaches to `req.user`. `AdminGuard` requires `req.user.role === 'ADMIN'`. Passwords hashed with `bcryptjs` (10 rounds).
- Vietnamese error messages in DTO validators and exceptions (e.g. `"Email hoặc mật khẩu không đúng"`, `"Sản phẩm không tồn tại"`, `"Sản phẩm \"X\" không đủ hàng (còn N)"`).
- Order code: `DH-` + 6 random chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (retry on unique collision). `merchantTradeNo`: code without dash + 10 random alphanumeric (≤32 chars total, alphanumeric only).

### 5.1 Endpoints — exact contracts (shapes from `@webcatt/shared`)

AUTH
- `POST /api/auth/register` `{email, password(min 6), name?}` → 201 `AuthResponse`. 409 `"Email đã được đăng ký"`.
- `POST /api/auth/login` `{email, password}` → 200 `AuthResponse`. 401 `"Email hoặc mật khẩu không đúng"`.
- `GET /api/auth/me` (auth) → `PublicUser`.

PRODUCTS (public)
- `GET /api/products` → `ProductDto[]` — only `active: true`, ordered by `sortOrder asc, createdAt desc`. `availableStock` = count of AVAILABLE stock items; `sold` = count of SOLD. Call `releaseExpiredOrders()` first (see 5.2).
- `GET /api/products/:slug` → `ProductDto` (404 if missing or inactive).

ORDERS (auth required)
- `POST /api/orders` body `{items: [{productId: string, quantity: number(int ≥1)}]}` (at least 1 item) → 201 `CreateOrderResponse` `{order: OrderDetailDto, payment: PaymentInfoDto}`.
- `GET /api/orders` → `OrderSummaryDto[]` (own orders, newest first).
- `GET /api/orders/:code` → `OrderDetailDto` (own order only, 404 otherwise). `items[].deliveredLines` (the assigned StockItem contents) ONLY when status is DELIVERED (or PAID with partially delivered lines — include whatever lines are assigned).
- `POST /api/orders/:code/check-payment` (own order) → `CheckPaymentDto {status, delivered}`. Logic: releaseExpiredOrders → if order PENDING and mode BINANCE: query Binance order status; if paid → `markPaidAndDeliver`. If mode MOCK: just return current status (mock confirm endpoint is what flips it).
- `POST /api/orders/:code/cancel` (own order, PENDING only, else 400 `"Đơn hàng không thể hủy"`) → `{status: 'CANCELLED'}` — releases reserved stock, payment → FAILED.

PAYMENTS
- `POST /api/payments/binance/webhook` — public. Verify signature (see 5.3). On `bizStatus: 'PAY_SUCCESS'` → parse `data` (JSON string) → `merchantTradeNo` → `markPaidAndDeliver`. On `PAY_CLOSED` → expire order + release stock. Always respond `{"returnCode":"SUCCESS","returnMessage":null}` when handled; `{"returnCode":"FAIL"}` with 400 on bad signature. Store raw payload into `Payment.rawWebhook`.
- `POST /api/payments/mock/confirm` body `{code}` — ONLY works when `PAYMENT_MOCK=true` (otherwise 403). No auth (it simulates an external gateway). Marks paid + delivers → `{status}`.

ADMIN (auth + ADMIN) — prefix `/api/admin`
- `GET /admin/stats` → `AdminStatsDto` — `revenue` = sum totalAmount of PAID+DELIVERED, `ordersToday` = created today (server tz), `lowStock` = active products with availableStock < 5 (LOW_STOCK_THRESHOLD from shared).
- `GET /admin/products` → `ProductDto[]` (ALL incl. inactive).
- `POST /admin/products` `{name, price, slug?, shortDescription?, description?, image?, icon?, category?, sortOrder?, active?}` → `ProductDto`. Slug auto-generated from name if absent (Vietnamese-aware slugify: đ→d, strip diacritics via NFD, lowercase, non-alnum→`-`); 409 on duplicate slug `"Slug đã tồn tại"`.
- `PATCH /admin/products/:id` (all fields optional) → `ProductDto`.
- `DELETE /admin/products/:id` → hard delete if product has no orderItems, else 409 `"Sản phẩm đã có đơn hàng, hãy ẩn thay vì xóa"`.
- `POST /admin/products/:id/stock` `{content: string, dedupe?: boolean = true}` — split by newline, trim, drop empties; if dedupe, skip lines that already exist for this product with status AVAILABLE or RESERVED → `AddStockResponse {added, skipped, total}` (total = availableStock after).
- `GET /admin/products/:id/stock?status=&page=1&limit=50` → `Paginated<StockItemDto>` (orderCode = code of order the line belongs to, via orderItem.order).
- `DELETE /admin/stock/:id` — only AVAILABLE lines (400 otherwise `"Chỉ xóa được dòng chưa bán"`).
- `GET /admin/orders?status=&q=&page=1&limit=20` → `Paginated<OrderSummaryDto>` (q matches order code or user email, `userEmail` filled).
- `GET /admin/orders/:code` → `OrderDetailDto & {userEmail}` — deliveredLines always included regardless of status.
- `POST /admin/orders/:code/deliver` — re-run delivery for PAID orders that were under-delivered (stock was missing); 400 if order not PAID `"Chỉ giao lại được đơn đã thanh toán"`.

### 5.2 Stock reservation & delivery (CRITICAL correctness)

**Create order** (single `prisma.$transaction(async tx => ...)`):
1. `releaseExpiredOrders(tx)` — see below.
2. For each item: load product (must be active), lock available lines:
   `SELECT id FROM "StockItem" WHERE "productId" = $1 AND status = 'AVAILABLE' ORDER BY "createdAt" ASC LIMIT $qty FOR UPDATE SKIP LOCKED` (via `tx.$queryRaw`). If fewer than qty → throw BadRequest `"Sản phẩm \"{name}\" không đủ hàng (còn {n})"` (count via a COUNT query for the message).
3. Create Order (code, totalAmount = Σ price×qty using `Prisma.Decimal`, expiresAt = now + ORDER_EXPIRE_MINUTES) + OrderItems (productName/unitPrice snapshots).
4. `updateMany` the locked ids → `{status: 'RESERVED', orderItemId}`.
5. Create Payment: mock mode → `{mode:'MOCK', merchantTradeNo}`; real mode → call Binance create-order (5.3) and store `prepayId/checkoutUrl/qrcodeLink/deeplink/universalUrl`. Binance HTTP call happens AFTER the transaction commits (so locks aren't held during network I/O) — if Binance call fails, cancel the order + release stock and rethrow 502 `"Không tạo được phiên thanh toán Binance"`.

**`markPaidAndDeliver(merchantTradeNo | orderId)`** — idempotent:
1. `updateMany Order {id, status IN (PENDING, EXPIRED)} → {status:'PAID', paidAt: now}`; if count === 0 → return existing status (already handled).
2. Payment → SUCCESS.
3. Delivery in a transaction, per order item: take lines RESERVED with this orderItemId; if fewer than quantity (reservation was released after expiry), lock extra AVAILABLE lines with the same `FOR UPDATE SKIP LOCKED` query; mark all as `{status:'SOLD', soldAt: now, orderItemId}`. If every item got full quantity → order DELIVERED, else stays PAID (admin can top up stock and hit `/admin/orders/:code/deliver`).

**`releaseExpiredOrders(tx?)`**: orders `status=PENDING AND expiresAt < now` → status EXPIRED, their payments → EXPIRED, their reserved stock (`status=RESERVED AND orderItemId IN (...)`) → `{status:'AVAILABLE', orderItemId: null}`. Called at: product listing/detail, order create, check-payment, order get.

### 5.3 Binance Pay integration (`binance.service.ts`)

Signed request helper (merchant API):
- Headers: `content-type: application/json`, `BinancePay-Timestamp` (ms), `BinancePay-Nonce` (32 random alphanumeric), `BinancePay-Certificate-SN` = API key, `BinancePay-Signature` = UPPERCASE hex of `HMAC-SHA512(timestamp + "\n" + nonce + "\n" + jsonBody + "\n", secret)`. Use Node `crypto` + global `fetch`.
- Create order: `POST {base}/binancepay/openapi/v3/order` body:
```json
{
  "env": {"terminalType": "WEB"},
  "merchantTradeNo": "...",
  "orderAmount": 12.5,
  "currency": "USDT",
  "description": "Đơn hàng DH-XXXXXX",
  "goodsDetails": [{"goodsType": "02", "goodsCategory": "Z000", "referenceGoodsId": "<productId>", "goodsName": "<name>", "goodsUnitAmount": {"currency": "USDT", "amount": <unitPrice>}}],
  "returnUrl": "{WEB_URL}/don-hang/{code}",
  "cancelUrl": "{WEB_URL}/thanh-toan/{code}",
  "webhookUrl": "{API_PUBLIC_URL}/api/payments/binance/webhook",
  "orderExpireTime": <expiresAt ms>
}
```
  Success: `{status:"SUCCESS", data:{prepayId, checkoutUrl, qrcodeLink, deeplink, universalUrl}}` — else throw.
- Query order: `POST {base}/binancepay/openapi/v2/order/query` body `{merchantTradeNo}` → `data.status` — treat `PAID` as paid; `CANCELED`/`EXPIRED` as closed.
- Webhook verify: headers `binancepay-timestamp`, `binancepay-nonce`, `binancepay-signature` (base64 RSA), payload = `timestamp + "\n" + nonce + "\n" + rawBody + "\n"`. Fetch public key once via signed `POST {base}/binancepay/openapi/certificates` (cache in memory; `data[0].certPublic`), verify RSA-SHA256. If `PAYMENT_MOCK=true`, webhook returns 403 (not used in mock).

### 5.4 Seed (`apps/api/prisma/seed.ts`, run with tsx) — idempotent (upsert by slug/email)

- Admin user from `ADMIN_EMAIL`/`ADMIN_PASSWORD` (role ADMIN, name "Quản trị viên"); demo user `user@cattstore.local` / `User@123` (name "Khách hàng demo").
- 8 products (legit digital goods, Vietnamese copy, prices in USDT, icon = lucide icon name):
  1. `key-windows-11-pro` — "Key bản quyền Windows 11 Pro" — 8.50 — icon `KeyRound` — category "Phần mềm" — 15 stock lines like `W269N-WFGWX-YVC9B-4J6C9-T83GX` (generate random key-style lines)
  2. `key-office-2021-pro-plus` — "Key Microsoft Office 2021 Pro Plus" — 12.00 — `AppWindow` — "Phần mềm" — 10 lines
  3. `gift-card-steam-10` — "Steam Gift Card 10$" — 10.50 — `Gift` — "Thẻ quà tặng" — 8 lines
  4. `key-game-aaa-steam` — "Key game AAA trên Steam (random)" — 4.99 — `Gamepad2` — "Game" — 20 lines
  5. `khoa-hoc-lap-trinh-web` — "Khóa học Lập trình Web Fullstack (mã kích hoạt)" — 15.00 — `GraduationCap` — "Khóa học" — 12 lines `COURSE-XXXX-XXXX`
  6. `key-antivirus-1-nam` — "Key diệt virus bản quyền 1 năm" — 9.99 — `Shield` — "Phần mềm" — 10 lines
  7. `ebook-bao-mat` — "Ebook: Làm chủ bảo mật cá nhân (mã tải)" — 4.50 — `BookOpen` — "Ebook" — 10 lines
  8. `canva-pro-1-nam` — "Canva Pro 1 năm (mã kích hoạt)" — 19.99 — `Palette` — "Phần mềm" — 0 lines (để demo trạng thái "Hết hàng")
- Each product gets a real `shortDescription` (1 câu) and `description` (3–5 đoạn/bullet tiếng Việt: mô tả, cách kích hoạt, bảo hành). Only add stock when product has none yet.

## 6. Web — Next.js App Router (`apps/web`)

### 6.1 Design system — "trắng đen chuyên nghiệp" (monochrome, professional)

- Tailwind v4: `app/globals.css` starts with `@import "tailwindcss";` then `@theme` setting `--font-sans: var(--font-geist-sans)` etc. Fonts: `geist` package (`import { GeistSans } from 'geist/font/sans'`, `GeistMono` for codes/lines) — apply on `<html>`, `<body className="bg-white text-neutral-950 antialiased">`.
- Palette: white background, `neutral-950` text, `neutral-500` muted, `neutral-200` borders, `neutral-100` subtle fills. Primary action: black bg / white text / `hover:bg-neutral-800`. NO colors anywhere except: `emerald-600` only for success/delivered confirmation, `red-600` only for errors/destructive. Status badges otherwise monochrome (black fill or outlined).
- Cards: `rounded-xl border border-neutral-200 bg-white`, hover `border-neutral-400` + tiny `-translate-y-0.5 transition`. No colored shadows; at most `shadow-sm`.
- Typography: headings `font-semibold tracking-tight`; prices `font-semibold tabular-nums`; stock lines & order codes in `font-mono` (GeistMono).
- Icons: `lucide-react` only, `strokeWidth={1.75}`, sized 16–20 inline.
- All UI text in Vietnamese. Currency display via `formatUsdt` from `@webcatt/shared`. Dates via `new Date(x).toLocaleString('vi-VN')`.
- Reusable primitives in `components/ui.tsx`: `Button` (variants: primary black / outline / ghost / danger; sizes sm/md; loading state with spinner), `Input` + `Label` + `Field` (label + input + error), `Badge` (variants: solid black / outline / muted), `Card`, `Spinner`, `EmptyState` (icon + title + hint). Small `cn(...classes)` helper in `lib/cn.ts` (join truthy — no external deps).
- Icon map `components/icon-map.tsx`: maps icon-name strings (`KeyRound, AppWindow, Gift, Gamepad2, GraduationCap, Shield, BookOpen, Palette`) → lucide components, fallback `Package`. Product visual = icon centered in a `bg-neutral-100 rounded-lg` tile (use `image` <img> when set instead).

### 6.2 Data & auth plumbing

- `lib/api.ts`: `apiFetch<T>(path, {method?, body?, token?})` → `${NEXT_PUBLIC_API_URL}${path}` (browser) / `API_URL` (server: use `typeof window === 'undefined'`), JSON headers, Bearer when token. On !ok throw `ApiError(message, status)` — message from body `message` (string or array → join). `cache: 'no-store'` for server fetches.
- `lib/auth.tsx`: client `AuthProvider` + `useAuth()` — token in `localStorage('wc_token')`, on mount `GET /auth/me` (invalid → clear), exposes `{user, token, loading, login(), register(), logout()}`. login/register call API, store token, set user.
- Server components (home, product detail) fetch products directly; every page that fetches at request time declares `export const dynamic = 'force-dynamic'`. Wrap in try/catch → friendly `"Không kết nối được máy chủ. Vui lòng thử lại."` state.
- Next 15: route `params`/`searchParams` are **Promises** — `const { slug } = await params;` in server components; `use(params)` in client pages.

### 6.3 Pages (storefront agent)

- `app/layout.tsx` — metadata (title = SITE_NAME, description VN), fonts, `AuthProvider`, `<Header/>`, `{children}`, `<Footer/>`.
- `components/header.tsx` (client): sticky top, `bg-white/85 backdrop-blur border-b border-neutral-200`. Left: logo = black square (rounded) with white "C" + site name uppercase `tracking-widest font-semibold`. Right: link "Đơn hàng" (with `ReceiptText` icon, only when logged in), if admin → link "Quản trị" (icon `LayoutDashboard`), auth area: when logged out → "Đăng nhập" (outline) + "Đăng ký" (primary); when logged in → dropdown (name/email, "Đơn hàng của tôi", "Đăng xuất").
- `components/footer.tsx`: slim border-t, one row: "© {year} {SITE_NAME} — Giao hàng số tự động 24/7" + right side: "Thanh toán qua Binance Pay".
- **`app/page.tsx` — HOMEPAGE = PRODUCT LISTING** (server fetch + client filter component):
  - Row 1: h1 "Sản phẩm" + count muted ("{n} sản phẩm") — then a thin one-line trust strip (small, muted, 3 items with icons `Zap` "Giao tự động sau thanh toán", `ShieldCheck` "Bảo hành đổi mới", `Wallet` "Thanh toán USDT qua Binance Pay"). NO hero section.
  - Controls: search input (icon `Search`, placeholder "Tìm sản phẩm...") + category chips ("Tất cả" + distinct categories) — client-side filtering.
  - Grid `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`. `components/product-card.tsx`: icon tile, category tiny uppercase muted, name (medium, 2-line clamp), shortDescription muted line-clamp-2, bottom row: price bold + right side stock: `Badge` "Còn {n}" or muted "Hết hàng"; under it tiny "Đã bán {sold}". Whole card is a `<Link>` to `/san-pham/{slug}`. Out-of-stock: icon tile grayscale/50% opacity.
- **`app/san-pham/[slug]/page.tsx`** (server): breadcrumb (Trang chủ / {category} / {name}), 2-col `lg:grid-cols-[1fr_380px]`: left = big icon tile + description rendered as paragraphs (split \n\n; lines starting "- " → list); right = sticky buy box `components/buy-box.tsx` (client): price large, "Còn {n} sản phẩm | Đã bán {m}", quantity stepper (Minus/Plus buttons, input, max = availableStock), total, primary Button "Mua ngay" (icon `Zap`) → if !user redirect `/dang-nhap?next=...`; else `POST /orders` → router.push(`/thanh-toan/{code}`); error → red text under button. Out of stock → disabled "Hết hàng". Under button, small reassurance rows: `ShieldCheck` "Giao tự động ngay sau khi thanh toán", `Wallet` "Binance Pay — USDT".
- **`app/thanh-toan/[code]/page.tsx`** (client): fetch order detail (auth). If not PENDING → redirect to `/don-hang/{code}`. Card centered max-w-md: "Thanh toán đơn hàng" + order code mono + big amount + countdown `mm:ss` to expiresAt (on 0 → show expired state). MOCK mode: dashed-border notice "Chế độ thanh toán thử nghiệm" + primary Button "Mở trang thanh toán giả lập" → `/mock-pay/{code}`. BINANCE mode: show `<img src={qrcodeLink}>` QR + Button "Mở Binance Pay" (checkoutUrl, new tab, icon `ExternalLink`). Poll `POST /orders/{code}/check-payment` every 4s; when status PAID/DELIVERED → router.push(`/don-hang/{code}?paid=1`). Secondary ghost buttons: "Kiểm tra thanh toán" (manual), "Hủy đơn" (danger outline, confirm(), then cancel + router.push('/')).
- **`app/mock-pay/[code]/page.tsx`** (client): styled like an external gateway ("Binance Pay — Môi trường thử nghiệm" mono aesthetic, dark panel allowed here: black card on neutral-100 page): shows amount + merchant + order code, big button "Xác nhận đã thanh toán" → `POST /payments/mock/confirm {code}` → success check (emerald) → auto-redirect `/don-hang/{code}?paid=1` after 1.5s. Also "Hủy" link back.
- **`app/don-hang/page.tsx`** (client, requires auth → redirect login): h1 "Đơn hàng của tôi", table (Mã đơn mono / Ngày / Sản phẩm (firstProductName + " +n khác") / Tổng / Trạng thái Badge / chevron link). Empty → EmptyState (icon `PackageOpen`, "Chưa có đơn hàng nào", link "Mua sắm ngay").
- **`app/don-hang/[code]/page.tsx`** (client): if `?paid=1` → top emerald success banner "Thanh toán thành công! Sản phẩm của bạn ở bên dưới." Status Badge + created/paid times + total. If PENDING → button "Tiếp tục thanh toán" → `/thanh-toan/{code}`. Per item: name + unitPrice ×qty; when deliveredLines present → **delivery block**: header "Sản phẩm đã giao ({n} dòng)" + buttons "Sao chép tất cả" (Copy icon) and "Tải .txt" (Download icon — Blob download named `{code}.txt`); lines listed in `font-mono text-sm` rows on `bg-neutral-50 rounded-lg border`, each row with hover copy button (Copy→Check swap 1.5s). If PAID but some lines missing → amber-free notice (muted): "Một phần đơn hàng đang chờ bổ sung kho — chúng tôi sẽ giao ngay khi có hàng."
- **`app/dang-nhap/page.tsx`** + **`app/dang-ky/page.tsx`** (client): centered card max-w-sm, title, fields (email, mật khẩu, [tên for register]), primary submit full-width with loading, error red text, cross-links ("Chưa có tài khoản? Đăng ký" / reverse). On success: `router.push(searchParams.next || '/')`. Wrap `useSearchParams` usage in `<Suspense>`.
- `app/not-found.tsx`: minimal EmptyState "Không tìm thấy trang" + link home.
- Loading states: product grid skeleton (`animate-pulse` neutral-100 blocks) via `app/loading.tsx`; buttons use Spinner.

### 6.4 Admin pages (admin agent) — `app/admin/**`

- `app/admin/layout.tsx` (client): guard — useAuth; loading → spinner; !user or role !== 'ADMIN' → redirect '/'. Shell: left sidebar (w-60, border-r, white): brand mini, nav items with icons — "Tổng quan" `LayoutDashboard` `/admin`, "Sản phẩm" `Package` `/admin/san-pham`, "Đơn hàng" `ReceiptText` `/admin/don-hang`, divider, "Về cửa hàng" `Store` `/`. Active item: black bg white text rounded-lg. Content area: `bg-neutral-50 min-h-screen` with white content cards.
- `/admin` dashboard: 4 stat cards (Doanh thu (USDT) `Wallet`, Tổng đơn `ReceiptText`, Chờ thanh toán `Clock`, Đơn hôm nay `TrendingUp`) — big number + label; two panels: "Sắp hết hàng" table (name + availableStock badge + link to product) and note when empty "Kho ổn định ✓".
- `/admin/san-pham`: header + Button "Thêm sản phẩm" (icon `Plus`) → `/admin/san-pham/moi`. Table: icon tile sm / Tên (+slug muted) / Giá / Kho (AVAILABLE) / Đã bán / Trạng thái (Hiện/Ẩn badge) / actions (Sửa `Pencil` → `/admin/san-pham/{id}`, toggle active `Eye`/`EyeOff` via PATCH, Xóa `Trash2` with confirm — on 409 show alert message).
- `/admin/san-pham/moi` + `/admin/san-pham/[id]`: form card (Tên*, Slug (placeholder "tự tạo từ tên" on create), Giá USDT* number step 0.01, Danh mục, Icon (select from the 8 icon names + preview), Ảnh URL (optional), Mô tả ngắn, Mô tả (textarea 8 rows, hint "Xuống dòng 2 lần để tách đoạn, bắt đầu bằng '- ' cho gạch đầu dòng"), Hiển thị checkbox). Save → POST/PATCH → back to list.
  - Edit page ALSO has stock manager section: "Kho hàng — mỗi dòng là một sản phẩm" — textarea `font-mono` (placeholder "KEY-AAAA-BBBB\nKEY-CCCC-DDDD\n..."), checkbox "Bỏ qua dòng trùng" (default on), Button "Thêm vào kho" → POST stock → result line "Đã thêm {added}, bỏ qua {skipped} • Tồn kho: {total}". Below: tabs (Còn hàng / Đang giữ / Đã bán) → paginated table of lines (content mono truncated, ngày, orderCode when sold, delete icon for AVAILABLE only).
- `/admin/don-hang`: filter tabs (Tất cả + 5 statuses), search input (mã đơn / email), paginated table: Mã (mono) / Khách (email) / Ngày / Tổng / Trạng thái badge / link detail.
- `/admin/don-hang/[code]`: order info card (code, email, times, total, status badge), items with ALL delivered lines visible (mono list), payment card (mode, merchantTradeNo, prepayId, status). If status PAID and some item lines < quantity → warning + Button "Giao bù ngay" → `POST /admin/orders/{code}/deliver` → refresh.
- Admin fetches all go through `lib/api.ts` with token from useAuth. Reuse `components/ui.tsx` primitives; admin-specific composites → `components/admin/*`.

## 6.5 Deployment — Docker (added after v1)

Images are built from the repo root as build context (pnpm workspace needs the lockfile + all manifests).

- `apps/api/Dockerfile` — stages: `base` (node:22-alpine + openssl + pnpm) → `deps` (full install, `--filter @webcatt/api...`) → `builder` (build shared + api; also compiles `prisma/seed.ts` → `dist-seed/seed.js` with a standalone `tsc` call so the runtime image needs no `tsx`) → `prod-deps` (`--prod` install, ~166 pkgs instead of 421) → `runner` (non-root `node` user, healthcheck on `/api/health`).
  - `prisma` is a **runtime** dependency (not dev) because the container runs `prisma migrate deploy` on start.
  - `docker-entrypoint.sh`: `migrate deploy` → optional seed when `SEED_ON_START=true` (idempotent) → `exec node dist/main.js`. CRLF is stripped at build time so Windows clones still work.
- `apps/web/Dockerfile` — Next.js `output: 'standalone'` with `outputFileTracingRoot` at the monorepo root. Runner copies `.next/standalone` → `/app`, plus `.next/static` and `public` into `/app/apps/web/`. Entry: `node apps/web/server.js`.
  - **`NEXT_PUBLIC_*` are baked at build time** → passed as `ARG`/`--build-arg`; changing them requires a rebuild, not just a restart.
- `docker-compose.yml` — `postgres` (UTF-8 initdb) → `api` (waits for db healthy) → `web` (waits for api healthy), plus an optional `proxy` profile (nginx, single origin, `NEXT_PUBLIC_API_URL=/api`). Config comes from a root `.env` created from `.env.docker.example`; `JWT_SECRET` is mandatory (`${JWT_SECRET:?...}`).
- `docker-compose.dev.yml` — database only, for running the apps on the host.
- Schema is now managed by **Prisma migrations** (`prisma/migrations/0_init`), not `db push`. The existing dev database was baselined with `prisma migrate resolve --applied 0_init`.
- `.dockerignore` excludes `node_modules`, build output, `apps/api/pgdata` and **all `.env` files** (secrets are never baked into an image).
- Turbo caching excludes `.next/standalone/**` (deep pnpm symlinks exceed the Windows path limit when the cache is written).

## 6.6 Routes & i18n (added after v1)

**All routes are English** — `/` (products), `/products/[slug]`, `/login`, `/register`, `/orders`, `/orders/[code]`, `/checkout/[code]`, `/mock-pay/[code]`, `/admin`, `/admin/products`, `/admin/products/new`, `/admin/products/[id]`, `/admin/orders`, `/admin/orders/[code]`. The API generates matching URLs (`mockPayUrl`, Binance `returnUrl`/`cancelUrl`).

**Three languages: `vi` (default), `en`, `zh`.**
- Web: `apps/web/lib/i18n/` — `config.ts` (locales, cookie `wc_locale`, `Accept-Language` parsing), `dictionaries/{vi,en,zh}.ts`, `server.ts` (`getServerDictionary()` for server components — reads cookie then falls back to `Accept-Language`), `client.tsx` (`I18nProvider` / `useI18n()` → `{ locale, t, setLocale, formatDate }`). The `Dictionary` type is inferred from `vi.ts`, so a missing key in `en`/`zh` is a compile error. Interpolated strings are functions: `t.home.count(n)`.
- Switching language writes the cookie and calls `router.refresh()` so server-rendered pages re-render in the new language.
- Status labels (order/stock/payment) live in the dictionaries, not in `@webcatt/shared`. `OrderStatusBadge` moved to its own client component (`components/order-status-badge.tsx`) so `ui.tsx` stays importable from server components.
- API: `apps/api/src/i18n/` — services and DTO validators throw **message keys** (`K.productNotFound`, …); a global `I18nExceptionFilter` translates them per request using `Accept-Language`. Parameterised messages use `{ key, params }` when thrown directly, or `withParams(key, params)` inside class-validator decorators. The Binance webhook FAIL body stays untranslated (machine-to-machine).
- `apiFetch` sends the current locale as `Accept-Language` automatically (from the cookie in the browser, explicit `locale` option on the server).

## 6.7 Variants, announcement, auto-translation, logo (v2 — CURRENT WORK)

Prisma schema + migration are **already applied and frozen** (`prisma/migrations/20260809_variants_translations_announcement`). Shared types in `packages/shared/src/index.ts` are **already updated and frozen**. Build from those; do not change either.

### 6.7.1 Product variants — price and stock moved off Product

- `Product` no longer has `price`. Every product has **1..n `ProductVariant`** rows (`name`, `price`, `sortOrder`, `active`), and **`StockItem` belongs to a variant** (`variantId`, no more `productId`). `OrderItem` gained `variantId` (nullable, `SetNull`) + `variantName` (snapshot, `@default("")`).
- `ProductDto` exposes `minPrice`/`maxPrice` (over **active** variants; `0` when none), aggregate `availableStock`/`sold`, and `variants: ProductVariantDto[]`.
- Public endpoints return only **active variants**, ordered `sortOrder asc, createdAt asc`. Admin endpoints return **all** variants.
- Stock counting helper must group by `variantId` and roll up to product level.

### 6.7.2 API endpoint changes

PUBLIC
- `GET /api/products`, `GET /api/products/:slug` — unchanged paths; response now the new `ProductDto`. **Localized** (see 6.7.4).
- `GET /api/announcement` → `AnnouncementDto`. Localized. Returns `{active:false,title:'',body:''}` when disabled.

ORDERS (auth) — **breaking**
- `POST /api/orders` body is now `{ items: [{ variantId: string, quantity: int>=1 }] }` (was `productId`). Reservation locks stock **by variantId**; the out-of-stock message uses `"{product} – {variant}"` as the name. `OrderItemDto` gained `variantName`.

ADMIN (`/api/admin`, JWT+ADMIN)
- `POST /admin/products` — keeps `price` in the body; it creates the product **and** its first variant named `"Mặc định"` at that price. `PATCH /admin/products/:id` no longer accepts `price`.
- `POST /admin/products/:id/variants` `{name, price, sortOrder?, active?}` → `ProductVariantDto`
- `PATCH /admin/variants/:id` `{name?, price?, sortOrder?, active?}` → `ProductVariantDto`
- `DELETE /admin/variants/:id` → 409 `admin.variant_has_orders` if it has orderItems; 400 `admin.variant_last` if it is the product's only variant
- `POST /admin/variants/:id/stock` `{content, dedupe?}` → `AddStockResponse` (was per product)
- `GET /admin/variants/:id/stock?status=&page=&limit=` → `Paginated<StockItemDto>` (was per product)
- `DELETE /admin/stock/:id` — unchanged
- `GET /admin/announcement` → `AdminAnnouncementDto`; `PUT /admin/announcement` `{active, title, body, translations?}` → `AdminAnnouncementDto`
- `POST /admin/announcement/translate` → `AdminAnnouncementDto` (dịch vi → en+zh, lưu lại)
- `POST /admin/products/:id/translate` → `ProductDto` (dịch sản phẩm + mọi tên loại, lưu lại)
- `GET /admin/translation/status` → `TranslationStatusDto`
- `AdminStatsDto.lowStock` entries are now **per variant** (`productId`, `variantId`, `name`, `variantName`, `availableStock`).

### 6.7.3 Auto-translation (Claude API)

`apps/api/src/translation/` — `TranslationService` using `@anthropic-ai/sdk` (already installed).

- Client: `new Anthropic()` (reads `ANTHROPIC_API_KEY`). If the key is missing, `isConfigured` is false and translate endpoints throw 400 with message key `admin.translation_not_configured`.
- Model **`claude-opus-5`**, `max_tokens: 16000`, `output_config: { effort: 'low', format: { type: 'json_schema', schema } }` for a guaranteed-shape JSON reply, and `betas: ['server-side-fallback-2026-07-01']` + `fallbacks: 'default'` on `client.beta.messages.create`. Do **not** send `temperature`/`top_p`/`budget_tokens` (they 400). Check `stop_reason === 'refusal'` before reading `content`.
- One call translates the whole product at once: input is `{name, shortDescription, description, category, variants:[{id,name}]}` in Vietnamese; output is `{ en: {...}, zh: {...} }` where each side has the product fields plus `variants: [{id, name}]`. System prompt: professional e-commerce translator, keep product/brand names and codes (e.g. "Windows 11 Pro", "USDT") untranslated, preserve the paragraph/`- ` bullet layout of `description`, return only the requested fields.
- Persist with upsert on `(productId, locale)` and `(variantId, locale)`.
- **After a product create/update, kick off translation in the background** (`void this.translation.translateProductSafe(id)`, never awaited, failures only logged) so saving stays instant. The explicit endpoints above await and report errors.

### 6.7.4 Serving translated content

`resolveLocaleFromHeader(req.headers['accept-language'])` already exists in `src/i18n/locale.ts`. For `vi` return the original columns. For `en`/`zh`, include `translations: { where: { locale } }` and override `name`/`shortDescription`/`description`/`category` (and each variant's `name`) **only when a translation row exists and its field is non-empty**; otherwise fall back to Vietnamese. Admin endpoints always return Vietnamese originals **plus** the full `translations` maps.

### 6.7.5 Web changes

- **Homepage**: delete the `<h1>Sản phẩm</h1>` + product-count row **and** the 3-item trust strip. In their place render `components/announcement.tsx` — shown only when `active` and `title`/`body` non-empty: monochrome card (`rounded-xl border border-neutral-200 bg-neutral-50 p-4`), `Megaphone` icon, title `font-medium`, body with `whitespace-pre-line`. Nothing renders when disabled (grid moves up).
- **Product card / detail**: price shows `minPrice` when all variants share a price, otherwise `Từ {minPrice}` (`t.product.priceFrom`). Detail page has a **variant selector** (radio-style list of buttons: name + price + stock badge; disabled when a variant has no stock) that drives the buy box price, total and max quantity. Buying posts `variantId`.
- **Order pages** show `variantName` next to the product name when non-empty.
- **Admin**: announcement editor page (`/admin/announcement`, sidebar entry with `Megaphone`), variant manager on the product edit page (add / edit / delete, stock textarea + line table **per variant**), and a "Dịch tự động (EN + ZH)" button on the product form showing the resulting translations read-only. Disable translate buttons with a hint when `GET /admin/translation/status` reports `configured:false`.
- **Logo**: `public/logo.png` (full) and `public/logo-mark.png` (square mark) already exist, plus `app/icon.png` favicon. Replace the black "C" square with `<img src="/logo-mark.png">` in `components/header.tsx` and `components/admin/sidebar.tsx`; show the full `logo.png` (h-12, `mx-auto`) at the top of the login/register cards. Use plain `<img>` (next/image is unoptimized here).
- All new user-facing text goes through the dictionaries in `apps/web/lib/i18n/dictionaries/{vi,en,zh}.ts` — `vi.ts` defines the type, so every key must exist in all three.

## 6.8 Admin v3 — customers, audit log, dashboard, roles (CURRENT WORK)

Schema + migration `20260809_admin_roles_audit` are **applied and frozen**: `Role` gained `SUPERADMIN`, `User.lockedAt DateTime?`, new `AuditLog` model (`actorId?/actorEmail/actorCode/action/entityType?/entityId?/details Json?/createdAt`, indexes on createdAt/actorId/action). Shared types are **updated and frozen**: `isAdminRole()`, `AdminCustomerDto`, `AuditLogDto` + `AUDIT_ACTIONS`, `RevenuePointDto`, `AdminStatsDto` gained `customersTotal`/`customersNew30d`/`topProducts`, `AdminOrderDetailDto` gained `userId`.

### 6.8.1 Roles, locking, password

- **SUPERADMIN** = shop owner. Seed promotes the `ADMIN_EMAIL` user to SUPERADMIN (idempotent update). `AdminGuard` accepts ADMIN **or** SUPERADMIN (use `isAdminRole`). New `SuperAdminGuard` for admin-management endpoints → 403 key `admin.superadmin_required`.
- **Locking**: `lockedAt != null` ⇒ login returns 403 `auth.account_locked`, and `JwtAuthGuard` rejects with the same key (guard already loads the user per request, so existing tokens die immediately).
- **Change password** (all users): `POST /api/auth/change-password` (auth) `{currentPassword, newPassword, confirmPassword}` — wrong current → 400 `auth.current_password_wrong`; new password reuses `PASSWORD_MIN_LENGTH` + `Match`. → `{success: true}`.

### 6.8.2 Customers (`/api/admin`, AdminGuard)

- `GET /admin/customers?q=&page=1&limit=20` → `Paginated<AdminCustomerDto>`, newest first. `q` matches email (contains, insensitive) or numeric code (strip leading `#`). `ordersCount` = all orders; `totalSpent` = Σ `totalAmount` of PAID+DELIVERED (compute for the page's users via one `groupBy`, not N+1).
- `GET /admin/customers/:id` → `AdminCustomerDto` (404 `admin.customer_not_found`).
- `POST /admin/customers/:id/lock` — 400 `admin.cannot_lock_self` when target is the caller; 400 `admin.cannot_lock_admin` when target is ADMIN/SUPERADMIN. Audit `customer.lock`.
- `POST /admin/customers/:id/unlock` — audit `customer.unlock`.
- `POST /admin/customers/:id/grant-admin` (SuperAdminGuard) — target must be role USER (else 400 `admin.cannot_modify_superadmin` for SUPERADMIN / no-op error for ADMIN → use 400 `admin.already_admin`), must not be locked (400 `admin.cannot_grant_locked`). → role ADMIN, audit `admin.grant`.
- `POST /admin/customers/:id/revoke-admin` (SuperAdminGuard) — target must be ADMIN; SUPERADMIN target → 400 `admin.cannot_modify_superadmin`. → role USER, audit `admin.revoke`.
- `OrdersQueryDto` gains optional `userId` — `GET /admin/orders?userId=` filters (customer detail page uses it). `AdminOrderDetailDto.userId` now returned.

### 6.8.3 Audit log

- `AuditService.log(actor, action, entity?, details?)` — **never throws** (catch + logger.warn). `actor` is the authenticated admin (`@CurrentUser()`); snapshot `actorEmail`/`actorCode`.
- Log every admin mutation: product create/update/delete/translate, variant create/update/delete, stock add/delete, order redeliver, **order cancel**, announcement update/translate, customer lock/unlock, admin grant/revoke. Use the exact `AuditAction` keys from shared. `details` stays small and useful: `{name}` for creates/deletes; updates add a `changes` object with `{field: {from, to}}` for changed scalar fields (price/name/active at minimum); stock add: `{variantName, productName, added}`.
- `GET /admin/audit?action=&page=1&limit=50` → `Paginated<AuditLogDto>`, newest first, optional exact-action filter (validate against AUDIT_ACTIONS → 400 `admin.audit_action_invalid`).

### 6.8.4 Admin cancels a pending order

`POST /admin/orders/:code/cancel` — PENDING only (else 400 `order.cannot_cancel`); reuse `fulfillment.cancelOrderInternal` (CANCELLED + release reserved stock + payment FAILED); returns the refreshed `AdminOrderDetailDto`; audit `order.cancel` with `{code}`.

### 6.8.5 Dashboard data

- `GET /admin/stats` additionally returns `customersTotal` (role USER), `customersNew30d`, and `topProducts` = top 5 by revenue over the last 30 days from OrderItems of PAID/DELIVERED orders (`revenue` = Σ unitPrice×quantity, `sold` = Σ quantity; `name` = current product name, falling back to the `productName` snapshot when the product was deleted).
- `GET /admin/stats/series?days=7|30` (default 7, anything else → 400 `admin.series_days_invalid`) → `RevenuePointDto[]` with **one point per calendar day** (server tz), zero-filled; `revenue`/`orders` from orders with `paidAt` in that day and status PAID/DELIVERED. Dates `YYYY-MM-DD`.

### 6.8.6 Web

- **Role checks**: replace every `role === 'ADMIN'` with `isAdminRole(role)` (header nav + dropdown, admin layout guard). SUPERADMIN-only UI (grant/revoke) checks `user.role === 'SUPERADMIN'`.
- **Sidebar**: after "Đơn hàng" add "Khách hàng" (`Users` icon → /admin/customers) and "Nhật ký" (`ScrollText` icon → /admin/audit).
- **/admin/customers**: search box (mã # hoặc email, debounced 400ms), paginated table: mã (mono #100001) | email | vai trò badge (Khách/Admin/Chủ shop — SUPERADMIN solid, ADMIN outline, USER muted) | đơn | tổng chi (USDT) | ngày tạo | trạng thái (badge "Đã khóa" when locked) | thao tác. Actions per row: khóa/mở khóa (confirm; hidden for admins & self), and for SUPERADMIN viewer: cấp/thu hồi quyền admin (confirm). Row click → detail.
- **/admin/customers/[id]**: info card (mã, email, vai trò, ngày tạo, trạng thái + the same actions) and the customer's orders table via `GET /admin/orders?userId=` (reuse the admin orders table pattern; rows link to order detail).
- **/admin/audit**: action filter (select or tabs: Tất cả + grouped options), table: thời gian | người thao tác (email + #code mono) | hành động (localized label from a `Record<AuditAction, string>` in the dictionaries) | chi tiết (render `details.name`, and `changes` as "field: from → to" lines; fall back to entityId). Limit 50 + pagination.
- **Dashboard** (`/admin`): stat cards now 5 (add "Khách hàng" card: total + "+n / 30 ngày" hint) — keep the grid responsive; **revenue chart card** + **top products card** side by side above the existing low-stock/store panels.
- **Revenue chart** `components/admin/revenue-chart.tsx` — inline SVG, no chart lib. Rules (from the dataviz method, monochrome system):
  - Bar chart, single series ⇒ **no legend** (card title "Doanh thu" names it) with a 7/30-day toggle (reuse `Tabs`), refetching `/admin/stats/series`.
  - Bars: `fill` = neutral-900 ink, rounded **top** only (~2px), anchored to the baseline, ≥2px gap between bars; hovered bar → neutral-950, others unchanged.
  - Grid: 3–4 **horizontal** lines only, neutral-200, behind bars; y tick labels text-[11px] neutral-500 (compact numbers), x labels dd/MM — every day at 7d, every 5th day at 30d.
  - **No second y-axis**: the orders count lives in the tooltip only.
  - Hover: an invisible full-height hit `rect` per day (hit target larger than the bar); tooltip = absolutely-positioned div (date, "Doanh thu: X USDT", "Đơn: n") clamped to the card; numbers in text tokens, never colored.
  - All-zero/empty series → centered muted "Chưa có dữ liệu" line (no fake bars). Chart height ~160–200px, width 100% (viewBox + preserveAspectRatio none for x; compute bar positions from data length).
- **Admin order detail**: customer code links to `/admin/customers/{userId}`; PENDING orders get a danger "Hủy đơn" button (confirm) → `POST /admin/orders/:code/cancel`, then refresh.
- **Change password**: storefront page `/account/password` (auth-guarded like /orders): 3 PasswordInput fields, client validation mirrors register, submit → change-password endpoint, success state + redirect back. Header dropdown gains "Đổi mật khẩu" (`KeyRound` icon) above "Đăng xuất".
- All new strings in the 3 dictionaries; audit action labels live under `admin.auditActions` as a `Record<AuditAction, string>`.

## 6.9 User account area (CURRENT WORK)

Already done and frozen: rounded favicon (`app/icon.png`), `OrderItemDto.productSlug` (shared rebuilt; API mappers return it).

### 6.9.1 `/account` page (auth-guarded like /orders; redirect to /login?next=/account)

- **Profile card**: avatar tile = `logo-mark-rounded.png`? No — use `UserRound` icon tile; rows: email, mã khách hàng (mono `#100001` + copy button reusing the copy pattern), vai trò (badge — only shown for ADMIN/SUPERADMIN: "Quản trị viên"/"Chủ cửa hàng"), thành viên từ (formatDate of `user.createdAt`).
- **Stats row** (3 stat tiles, computed client-side from `GET /orders`): tổng đơn hàng; đơn thành công (PAID+DELIVERED count); tổng chi tiêu (Σ totalAmount of PAID+DELIVERED, formatUsdt).
- **Quick links list**: Đơn hàng của tôi (`ReceiptText` → /orders), Đổi mật khẩu (`KeyRound` → /account/password), Trang quản trị (`LayoutDashboard` → /admin, admins only), Đăng xuất (`LogOut`, red, logout + push '/').
- Header dropdown: add "Tài khoản" entry (`UserRound` icon) at the TOP of the menu → /account.

### 6.9.2 `/orders` — status filter

Status tabs above the table (reuse admin `Tabs`): Tất cả + PENDING/PAID/DELIVERED/CANCELLED/EXPIRED, client-side filtering of the already-fetched list (labels from `t.orderStatus`). Tab shows count suffix e.g. "Tất cả (12)" — count computed from data. Empty filtered state → small muted line (not the big EmptyState).

### 6.9.3 `/orders/[code]` — receipt download + buy again + timing

- Info grid: when PENDING also show "Hết hạn lúc" (`expiresAt`, formatDate).
- New button in the header row next to the status badge (or under the card on mobile): **"Tải đơn hàng (.txt)"** (`FileDown` icon, outline) — builds a plain-text receipt client-side and reuses the existing `downloadTxt` helper, filename `don-hang-{code}.txt`. Content (localized via dictionaries):
  ```
  CATT STORE (NEXT_PUBLIC_SITE_NAME)
  ================================
  Mã đơn: DH-XXXXXX      Trạng thái: <t.orderStatus[...]>
  Khách hàng: email (#code)          ← from useAuth().user
  Ngày tạo: <datetime>   Thanh toán: <datetime|—>

  1. <productName> — <variantName> | SL 2 × 15.00 = 30.00 USDT
     KEY-AAAA
     KEY-BBBB
  ...
  --------------------------------
  Tổng cộng: 58.00 USDT
  ```
  (exact layout free-form but must include all of the above; keys only when present).
- Per item where `deliveredLines` shown (or always): small "Mua lại" ghost link (`RotateCcw` icon) → `/products/{productSlug}`.

### 6.9.4 Dictionaries

All new strings in vi/en/zh (`account.*`, `orders.filter*`, `orderDetail.download*`, `orderDetail.buyAgain`, receipt labels). vi defines the type.

## 6.10 Crypto payments (BEP20/TRC20) + payment methods + store settings (CURRENT WORK)

Frozen (built, migrated, tested — never edit): schema (`Payment.crypto*`, `StoreSetting`, `User.code` now random-assigned in app code), migration `20260809_random_code_crypto_settings`, shared types (`PaymentMode`+`CRYPTO`, `PaymentMethod`, `CryptoNetwork`, `PaymentMethodDto`, `AdminStoreSettingDto`, `BinanceStatusDto`, `PaymentInfoDto.crypto*`, `AUDIT_ACTIONS`+`settings.update`), and **`src/binance-exchange/`** (`BinanceExchangeService` with `isConfigured`/`getStatus`/`getUsdtFreeBalance`/`listUsdtDeposits(startMs)`/`findDepositByTxId`, `deposit-matcher.ts` with `matchDeposits`/`buildUniqueCryptoAmount`/`NETWORK_TO_BINANCE`/`binanceNetworkToLabel`, and `BinanceExchangeModule` which is `@Global`). Import and use these — do not reimplement Binance signing or matching.

### 6.10.1 Random customer code

`User.code` no longer autoincrements. Add a helper that generates a random 8-digit code (10000000–99999999) with a uniqueness retry against the DB, and use it in **both** `auth.service.register` and `prisma/seed.ts` when creating users (seed: only when creating; keep existing codes). Register the `BinanceExchangeModule` and `SettingsModule` in `app.module.ts`.

### 6.10.2 Store settings + payment methods

- `SettingsService` over the `StoreSetting` singleton (id `"main"`; create-on-read if missing). `getEnabledMethods()` → `PaymentMethodDto[]`:
  - `mock` when `mockEnabled`;
  - `binance_pay` when `binancePayEnabled` **and** `BINANCE_PAY_API_KEY` env is set;
  - `crypto_bep20` when `cryptoEnabled` **and** `bep20Address` non-empty (include `address`);
  - `crypto_trc20` when `cryptoEnabled` **and** `trc20Address` non-empty (include `address`).
  Order: mock, binance_pay, crypto_bep20, crypto_trc20. If none enabled, fall back to `[{method:'mock'}]` so checkout never dead-ends in dev.
- `GET /api/payment-methods` (public) → `PaymentMethodDto[]`.
- Admin (AdminGuard): `GET /admin/settings` → `AdminStoreSettingDto`; `PUT /admin/settings` `{mockEnabled,binancePayEnabled,cryptoEnabled,bep20Address,trc20Address}` (booleans + trimmed strings; validate addresses are plausible when the matching crypto toggle is on — non-empty) → `AdminStoreSettingDto`, audit `settings.update` with a `changes` diff. `GET /admin/binance/status` → `BinanceStatusDto` (delegates to `BinanceExchangeService.getStatus()`).

### 6.10.3 Choosing a method on the checkout page

Order creation stays backward-compatible; method is chosen/switched on the checkout page.
- `POST /orders` (unchanged body `{items}`) creates the order + a Payment configured for the **first enabled method** (via the shared prepare logic below). `merchantTradeNo` still always generated.
- `POST /orders/:code/select-payment` (auth, own order, **PENDING only** else 400 `order.cannot_cancel`) body `{method: PaymentMethod}` — method must be enabled (else 400 `payment.method_unavailable`) — reconfigures the order's Payment and returns the refreshed `OrderDetailDto`.
- **Prepare logic** (shared by create + select-payment), by method:
  - `mock` → `mode:'MOCK'`; null out crypto + binance-pay-session fields.
  - `binance_pay` → `mode:'BINANCE'`; create the Binance Pay session (existing code in `orders.service`) and store session fields; on failure throw 502 `payment.session_failed` (do **not** cancel the order — leave it PENDING so the user can pick another method).
  - `crypto_bep20`/`crypto_trc20` → `mode:'CRYPTO'`, `cryptoNetwork` `BEP20`/`TRC20`, `cryptoAddress` from settings, `cryptoAmount` = `buildUniqueCryptoAmount(Number(order.totalAmount), <cryptoAmounts of other PENDING CRYPTO payments on the same network>, randomInt)`; null out pay-session fields. If `buildUniqueCryptoAmount` returns null (exhausted) throw 503 `payment.crypto_amount_unavailable`.
- `order.mapper` `toPaymentInfoDto`: for `CRYPTO` fill `cryptoNetwork`, `cryptoAddress`, `cryptoAmount` (Number), `cryptoTxId`; `mockPayUrl` only for MOCK; keep `merchantTradeNo` everywhere.

### 6.10.4 Confirming crypto payment (auto + manual)

- Extend `checkPayment` (called by `POST /orders/:code/check-payment`): when the order is PENDING and payment mode is `CRYPTO`, call `reconcileCryptoOrder(order)` — fetch `listUsdtDeposits(order.createdAt - 10min)`, build the one-element pending list, `matchDeposits(..., usedTxIds)` where `usedTxIds` = all non-null `cryptoTxId` across payments; on a match set `payment.cryptoTxId` + `payment.status=SUCCESS` then `fulfillment.markPaidAndDeliver({orderId})`. Keep the existing BINANCE (Pay) branch. Never throw from the Binance call — log and return current status.
- Manual: `POST /orders/:code/submit-tx` (auth, own, PENDING, CRYPTO mode) `{txId}` → `findDepositByTxId`; validate: found (else 400 `payment.tx_not_found`), `status===1`, network label === payment.cryptoNetwork (else 400 `payment.tx_network_mismatch`), amount ≥ `Number(order.totalAmount)` and within 0.01 of `cryptoAmount` OR ≥ totalAmount (accept an over-payment of the base; else 400 `payment.tx_amount_mismatch`), txId not already used (else 400 `payment.tx_already_used`) → set cryptoTxId + markPaidAndDeliver → return `CheckPaymentDto`.
- **Background poller** `CryptoReconcileService` (in the orders module): on `onModuleInit`, if `BinanceExchangeService.isConfigured`, `setInterval` every 60s → find all PENDING CRYPTO orders; if any, one `listUsdtDeposits(min createdAt - 10min)` call, `matchDeposits` across all of them, mark each matched order paid. A re-entrancy guard skips a tick already running. Clear the interval in `onModuleDestroy`. Never let it throw.

### 6.10.5 Web

- **Checkout page** (`/checkout/[code]`): add a **payment-method chooser** when >1 method is enabled (fetch `GET /payment-methods`). Selecting a method calls `POST /orders/:code/select-payment` and re-renders. Render per `payment.mode`:
  - MOCK → existing sandbox block.
  - BINANCE → existing QR + "Mở Binance Pay".
  - CRYPTO → a card showing: network badge (BEP20/TRC20), the **exact amount** `cryptoAmount` (mono, big, with a copy button and an explicit "gửi CHÍNH XÁC số này" warning), the deposit `cryptoAddress` (mono, wrap, copy button), a note "chỉ gửi USDT trên đúng mạng", and a **manual TxID** form (input + "Tôi đã chuyển" button → `POST /orders/:code/submit-tx`, shows the returned error message on failure). The existing 4s `check-payment` poll continues to auto-detect.
- **Admin settings page** `/admin/settings` (sidebar entry, `Settings` icon, after "Nhật ký"): toggles for the 3 methods, address inputs for BEP20/TRC20 (shown when crypto on), save via `PUT /admin/settings`; plus a **Binance status panel** from `GET /admin/binance/status` — connected/not, USDT balance, and a red warning when `canWithdraw` is true ("Khóa API đang có quyền rút tiền — hãy dùng khóa chỉ-đọc"). Disable the crypto toggle with a hint when Binance is not configured.
- **Admin order detail**: when payment mode is CRYPTO show network, address, expected amount, and txId (when present).
- All new strings in the 3 dictionaries (vi defines the type): checkout method labels, crypto instructions, submit-tx button/errors, admin settings labels, Binance status labels. Audit-action label for `settings.update` under `admin.auditActions`.

## 6.11 Coupons, anti-spam registration, admin password reset (BUILT & TESTED)

Migration `20260809_coupons_password_reset`. All of the below is implemented and verified (56 live assertions).

### Coupons
- `Coupon` (code uppercase-unique, `PERCENT|FIXED`, `value`, `minAmount`, `maxUses`, `usedCount`, `perUserLimit`, `startsAt`, `expiresAt`, `active`, `note`). `Order` gains `subtotalAmount`, `discountAmount`, `couponId` (SetNull), `couponCode` (snapshot).
- Discount math lives in **`calcDiscount(subtotal, type, value)` in `packages/shared`** so web preview and API always agree; floors to 2 decimals and never exceeds the subtotal.
- `POST /api/coupons/preview` (auth) `{code, items}` → `CouponPreviewDto`. Subtotal is always recomputed from DB prices — client numbers are never trusted.
- `POST /api/orders` accepts optional `couponCode`. Validation runs **before** the transaction (fail fast, no locks held); the usage slot is **reserved inside** it via `updateMany({where: {usedCount: {lt: maxUses}}, data: {increment: 1}})` — atomic, so concurrent orders can never exceed `maxUses` (proven: 5 simultaneous orders on a 1-use code → exactly 1 succeeded).
- Slots are returned by `FulfillmentService.releaseCoupons` on expire / cancel / internal cancel.
- A 100 % coupon produces a 0 USDT order, which skips payment configuration and is delivered immediately.
- Admin CRUD `GET/POST /api/admin/coupons`, `PATCH|DELETE /api/admin/coupons/:id`; audit `coupon.create|update|delete`. In `UpdateCouponDto`, `undefined` = unchanged and `null` = clear the limit.

### Anti-spam registration
- `src/security/`: `CaptchaService` (in-memory, 5-min TTL, **single-use**, answer never leaves the server; +, −, × with small numbers) and `RateLimitService` (sliding window; `clientIp(req)` helper). Module is `@Global`.
- `GET /api/auth/captcha` → `{id, question}`. `POST /api/auth/register` requires `captchaId` + `captchaAnswer`.
- Limits: register 5/hour/IP, login 10/15 min per IP **and** per email (reset on success), captcha 40/10 min/IP. Over limit → 429 with a localized message.

### Password reset (no email — by design)
- `User.passwordChangedAt`; `JwtAuthGuard` rejects any token whose `iat` predates it (1 s slack for clock flooring).
- `POST /api/admin/customers/:id/reset-password` → `{password}` (12 chars, ambiguous glyphs removed), shown **once** in the admin UI. Blocks self-reset and SUPERADMIN targets; a plain ADMIN cannot reset another admin. Audit `customer.reset_password`.
- `POST /api/auth/change-password` now also stamps `passwordChangedAt` and returns a **fresh `accessToken`** so the current session survives; the web calls `replaceToken()`.
- `StoreSetting.supportContact` + public `GET /api/store-info` power the "Forgot your password?" block on the sign-in page.

### Binance key permissions (correction)
`BinanceStatusDto.canWithdraw` is **gone**. `/api/v3/account`'s `canWithdraw` describes the ACCOUNT, not the key. Real key rights come from `/sapi/v1/account/apiRestrictions` → `BinanceStatusDto.permissions {read, withdraw, trade, ipRestricted}`, rendered as a permission table in `/admin/settings`.

## 6.12 Brand wordmark, rich-text announcement, support channels (BUILT & TESTED)

Migration `20260809_support_channels_rich_announcement`. 35 live assertions pass.

- **Wordmark** — `apps/web/components/wordmark.tsx`. Splits `NEXT_PUBLIC_SITE_NAME` into first word (white on a black rounded chip) + rest (letter-spaced black), sizes `sm|md|lg`; the chip lightens under a parent `.group` hover. Used in the header, the login and register cards (with `logo-mark.png` above it), and the mock-pay page. `wordmarkText()` renders `C A T T   S T O R E` for the `.txt` receipt.
- **Announcement is HTML.** Admin authors it with `components/admin/rich-text-editor.tsx` — a `contentEditable` box plus an `execCommand` toolbar (bold / italic / underline / strike / H3 / quote / bullet + numbered list / align L-C-R / link / unlink / clear) that pastes as plain text and shows a live storefront preview. **The API is the security boundary**: `src/announcement/sanitize-announcement.ts` runs `sanitize-html` with a tag allowlist, `style` limited to `text-align`, schemes limited to http/https/mailto, and `target`/`rel` forced on links (both must be in `allowedAttributes.a` or the transform's own output is stripped). It runs on admin saves **and** on machine-translated bodies. The translation prompt requires tags to be reproduced byte-for-byte. `.wc-prose` in `globals.css` styles the editor, the preview and the public box identically.
- **Support channels** — `StoreSetting.supportChannels` (JSON array of `{label, value, url?}`, max `SUPPORT_CHANNELS_MAX` = 6) and `supportNote` replace the single `supportContact` string (migrated into the first entry, then dropped). Admin edits an add/remove row list in `/admin/settings`; `GET /api/store-info` is public and the login page's "Forgot password?" block renders the note (falling back to the dictionary sentence) plus each channel, linked when `url` is set. Links are restricted to `http|https|mailto` server-side.
- Shop owner account is `ADMIN_EMAIL` in `apps/api/.env`; changing it there only affects seeding — the live row must be updated in the DB too.

## 6.13 Admin dashboard + products redesign (BUILT & TESTED)

No schema change. 19 live assertions pass.

- **`GET /api/admin/stats/series` now accepts `days` 7 | 14 | 30 | 60.** The chart asks for *double* the selected window in one call, plots the second half, and compares totals against the first half.
- **`RevenueChart`** leads with the period total as the page's biggest number plus a `+N% / −N%` badge and "so với N ngày trước đó"; when the previous window earned nothing it says so instead of showing a meaningless percentage. Bars, grid, tooltip and the 7/30 tabs are unchanged.
- **`StatCard`** gained `accent` (inverted black tile) and moved the icon to the top-right corner so the number reads first.
- **Dashboard IA**: page-header quick actions → 4 KPI tiles (revenue accented; each carries a hint: today's orders, new customers, low-stock count) → revenue chart at `lg:col-span-2` beside a **"Cần xử lý"** panel (pending orders + low-stock options as linked rows with counts, or an all-clear state) → top products **with relative-share bars** + the low-stock list. The redundant "store summary" card is gone.
- **Products page**: search (name / slug / category), status tabs with counts, sort (newest / name / lowest stock / best selling), and a **grid ⇄ table** toggle persisted in `localStorage` (`wc_admin_products_view`). Stock is a three-state badge — out of stock (solid) / low ≤ `LOW_STOCK_THRESHOLD` (outline) / normal (muted) — in both views. Filtering that matches nothing shows its own message, distinct from the empty-catalogue state.
- **Wordmark** letter-spacing tightened to 0.06–0.08em (was 0.22–0.3em).

### 6.13.1 Second pass on the dashboard (after review)

Three defects found by reading the *rendered data*, not the code:
1. **Two different numbers both labelled "Doanh thu"** — the all-time KPI and the 7-day chart total sat side by side. Now `statRevenueAllTime` ("Tổng doanh thu" + hint "Tất cả thời gian") vs `revenueTitleDays(n)` ("Doanh thu N ngày qua").
2. **The low-stock count appeared three times** (KPI hint, attention row, its own card). The standalone low-stock card and the KPI hint are gone; the **attention panel now lists the actual variants** (name + option + stock badge, out-of-stock first) with a "còn N loại nữa" link past `MAX_STOCK_ALERTS` = 4.
3. **No order-level activity anywhere** — added a **"Đơn hàng gần đây"** panel (`GET /admin/orders?limit=6`): code, status badge, `#customer · date`, amount, each row linking to the order; loads independently so its failure cannot break the page.

Final layout: 4 KPI tiles → chart (2/3) + attention (1/3) → recent orders + top products (1/2 each) → low-stock threshold footnote.

Test data created while verifying earlier features (the "Test live match" product, 6 cancelled/expired test orders, the 0-USDT `FREE100` order) was purged from the dev database; its stock lines were returned to `AVAILABLE`.

## 7. Verification (each agent must do before finishing)

- API agent: `pnpm --filter @webcatt/api typecheck` then `pnpm --filter @webcatt/api build` → zero errors.
- Web agents: `pnpm --filter @webcatt/web typecheck` → zero errors (storefront agent also runs `pnpm --filter @webcatt/web build` if time permits; admin agent runs full `build` at the end).
- NEVER run `pnpm install`, never edit package.json/tsconfig/schema.prisma/shared. If something seems impossible without a new dependency, implement it with Node/React built-ins instead.
