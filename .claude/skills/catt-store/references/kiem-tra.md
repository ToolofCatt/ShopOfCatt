# Kiểm tra trước khi commit, phát hành, triển khai

Ba mức, dùng đúng mức cần thiết.

---

## Mức 1 — Trước mỗi commit

```bash
pnpm typecheck && pnpm test && pnpm build
```

Cả ba phải xanh. Nếu `pnpm build` treo lâu bất thường: dừng dev server trước
(`next dev` giữ khoá thư mục `.next` trên Windows), build sạch chỉ mất ~35 giây.

Đụng tới tiền/kho/thanh toán thì thêm phần kiểm chứng chạy thật ở
`tien-va-kho.md` mục 7.

---

## Mức 2 — Kiểm tra toàn hệ thống

Chạy bản production, không phải dev server:

```bash
pnpm build
(cd apps/api && node dist/main.js) &
pnpm --filter @webcatt/web start &
```

Rồi kiểm những nhóm sau. Mọi mục phải đạt:

**Sống và công khai**
- `GET /api/health` → `{"status":"ok","database":"up"}`
- `GET /api/products`, `/api/payment-methods`, `/api/store-info`,
  `/api/announcement` → 200
- `GET /api/legal/terms|refund|privacy` → 200 (chỉ có ba slug này; slug lạ → 400)

**Chặn quyền**
- `GET /api/admin/stats` không token → **401**
- `GET /api/admin/orders/export` không token → **401**
- `POST /api/payments/mock/confirm` không token → **401**
- Token khách thường gọi endpoint quản trị → **403**

**Header bảo mật**
- API: `x-content-type-options: nosniff`, không có `x-powered-by`
- Web: `x-frame-options: DENY`, có `content-security-policy`, có
  `strict-transport-security`, không có `x-powered-by`

**Trang web**
- `/`, `/login`, `/register`, `/legal/terms`, `/robots.txt`, `/sitemap.xml` → 200
- `robots.txt` chặn `/admin`, `/orders`, `/checkout`, `/account`
- Tiêu đề trang **khác nhau** giữa các trang (không phải mọi trang đều
  "Catt Store")

---

## Mức 3 — Trước khi bán đơn đầu tiên

Danh sách đầy đủ nằm ở `docs/TRIEN-KHAI.md`. Những mục dễ bỏ sót nhất:

- [ ] **Mở `/admin` xem dải cảnh báo đỏ đầu trang tổng quan — phải trống.** Còn
      cảnh báo nghĩa là khách chưa đặt hàng được: chưa bật phương thức thanh
      toán, chưa có sản phẩm, hoặc hết kho. Cửa hàng mới cài **không bật sẵn
      phương thức nào**, đó là chủ ý.
- [ ] `JWT_SECRET`, `POSTGRES_PASSWORD`, `ADMIN_PASSWORD` do chủ shop tự sinh.
      Mật khẩu Postgres **chỉ dùng chữ và số** — nó nằm giữa chuỗi kết nối
      `postgresql://user:MẬT_KHẨU@postgres:5432/...` nên `@ : / ? # %` sẽ cắt
      đứt chuỗi.
- [ ] `PAYMENT_MOCK=false` **và** công tắc giả lập trong `/admin/settings` đã tắt.
- [ ] Khoá Binance hiện **Rút tiền: Không** trong bảng quyền.
- [ ] `https://` hoạt động, `http://` tự chuyển sang `https://`.
- [ ] Đã **diễn tập khôi phục** một bản sao lưu (`./docker/restore.sh`). Chưa thử
      khôi phục thì coi như chưa có sao lưu.
- [ ] Đã soạn Điều khoản / Hoàn tiền / Bảo mật và điền kênh liên hệ hỗ trợ — đây
      cũng là đường **duy nhất** để khách quên mật khẩu tìm được chủ shop.
- [ ] Đặt thử một đơn giá trị nhỏ **bằng tiền thật** và xác nhận nhận được key.

---

## Kiểm cấu hình Docker khi không có Docker

Không chạy được `docker compose up` thì vẫn soi được bằng tay:

- Mọi biến `${VAR}` trong compose đều có mặc định hoặc `:?` — script đối chiếu ở
  cuối `them-tinh-nang.md`.
- `depends_on: condition: service_healthy` chỉ dùng được khi image đích **có**
  `HEALTHCHECK`. Cả `apps/api/Dockerfile` và `apps/web/Dockerfile` đều có.
- Web dùng Next standalone thì phải đặt `ENV HOSTNAME=0.0.0.0`, nếu không Docker
  gán `HOSTNAME` = container id và server chỉ nghe trên IP container, healthcheck
  gọi `127.0.0.1` sẽ hỏng.
- Mọi `COPY` trong Dockerfile phải trỏ tới đường dẫn **có thật** (ví dụ
  `apps/web/public` phải tồn tại, nếu không build hỏng).
- `docker/backup.sh` là vòng lặp chạy **bên trong container** — đừng gọi thẳng
  trên máy chủ. Ép sao lưu ngay bằng `docker compose restart backup`.

---

## Nguyên tắc báo cáo

Nói đúng cái đã kiểm chứng và cái chưa. Ví dụ đúng cách:

> `pnpm typecheck`, `pnpm test` (38 test), `pnpm build` đều xanh. Kiểm 28 mục
> trên bản production: 27 đạt, 1 mục hỏng là do **bài kiểm tra sai** — tôi giả
> định có trang `/legal/contact`, thực tế hệ thống chỉ có `terms/refund/privacy`
> và API từ chối slug lạ bằng 400, đúng thiết kế. Chưa chạy được
> `docker compose up` vì máy này chưa cài Docker.

Đừng viết "đã kiểm tra kỹ" mà không nói kiểm cái gì, và đừng im lặng bỏ qua phần
không làm được.
