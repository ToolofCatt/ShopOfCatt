# Triển khai Catt Store lên máy chủ thật

Hướng dẫn này dành cho: **một VPS riêng + Docker + một tên miền**. Làm theo đúng
thứ tự, mỗi bước đều có cách tự kiểm chứng.

> **Đọc mục [Trước khi bán đơn đầu tiên](#trước-khi-bán-đơn-đầu-tiên) trước khi
> nhận tiền thật.** Có vài công tắc mà bật sai là phát hàng miễn phí.

---

## 0. Chuẩn bị

| Thứ cần có | Ghi chú |
|---|---|
| VPS | 2 GB RAM là đủ cho cửa hàng nhỏ (Postgres 1 GB + API 768 MB + Web 512 MB) |
| Tên miền | Đã trỏ bản ghi **A** về IP của VPS. Kiểm: `dig +short shop.cua-ban.com` |
| Docker + Docker Compose | `curl -fsSL https://get.docker.com \| sh` |
| Cổng 80 và 443 mở | Caddy cần cả hai để xin chứng chỉ Let's Encrypt |
| Khoá Binance **chỉ đọc** | Nếu bán bằng USDT on-chain — xem mục 4 |

---

## 1. Lấy mã nguồn

```bash
git clone <kho-git-cua-ban> /opt/catt-store
cd /opt/catt-store
```

Chưa đẩy lên Git? Làm ngay — không có bản sao mã nguồn ngoài máy là rủi ro lớn
nhất của cả dự án:

```bash
git remote add origin git@github.com:tai-khoan/catt-store.git
git push -u origin master
```

---

## 2. Tạo file cấu hình

```bash
cp .env.docker.example .env
```

Mở `.env` và **bắt buộc** đặt các giá trị sau — thiếu là stack không khởi động
(đã cố tình làm vậy để không ai chạy nhầm cấu hình mặc định):

```env
POSTGRES_PASSWORD=<chỉ chữ và số — xem ghi chú bên dưới>
JWT_SECRET=<chuỗi ngẫu nhiên ít nhất 32 ký tự>
ADMIN_EMAIL=ban@vidu.com
ADMIN_PASSWORD=<mật khẩu chủ shop>

SITE_DOMAIN=shop.cua-ban.com
ACME_EMAIL=ban@vidu.com
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_SITE_URL=https://shop.cua-ban.com
WEB_URL=https://shop.cua-ban.com
API_PUBLIC_URL=https://shop.cua-ban.com

PAYMENT_MOCK=false
SEED_DEMO=false
```

Sinh cả ba bí mật một lượt:

```bash
echo "JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '\n')"
```

> **`POSTGRES_PASSWORD` chỉ được dùng chữ và số.** Mật khẩu này nằm giữa chuỗi
> kết nối `postgresql://postgres:MẬT_KHẨU@postgres:5432/webcatt`, nên các ký tự
> `@ : / ? # %` sẽ cắt đứt chuỗi và API không nối được vào CSDL. `openssl rand
> -hex 24` ở trên luôn an toàn.

> API và seed sẽ **từ chối khởi động** nếu ba giá trị này còn để trống hoặc còn
> là giá trị mẫu — vì giá trị mẫu nằm công khai trong mã nguồn, ai đọc được
> repo cũng đăng nhập được vào cửa hàng của bạn.

> `NEXT_PUBLIC_*` được **nhúng vào bundle lúc build**. Đổi tên miền về sau thì
> phải chạy lại `docker compose up -d --build`, không phải chỉ khởi động lại.

---

## 3. Khởi động

```bash
docker compose config                       # kiểm cú pháp trước
docker compose up -d --build
docker compose ps                           # cả 5 dịch vụ phải "healthy"/"running"
docker compose logs -f api                  # xem migration chạy xong chưa
```

Kiểm chứng:

```bash
curl -I https://shop.cua-ban.com            # phải 200 và có chứng chỉ hợp lệ
curl -s https://shop.cua-ban.com/api/health # {"status":"ok",...}
curl -I https://shop.cua-ban.com | grep -i strict-transport   # HSTS có mặt
```

Đăng nhập `https://shop.cua-ban.com/login` bằng `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

---

## 4. Bật phương thức thanh toán

Vào **Quản trị → Cấu hình**. Cửa hàng khởi động với **không phương thức nào** —
đặt hàng sẽ báo lỗi rõ ràng cho tới khi bạn bật ít nhất một cái.

### USDT on-chain (BEP20 / TRC20)

Cần khoá API Binance **chỉ có quyền đọc**:

1. Binance → **API Management** → Create API
2. Chỉ tick **Enable Reading**. **KHÔNG** bật Withdrawals, không bật Trading
3. Giới hạn theo IP của VPS
4. Điền vào `.env`: `BINANCE_API_KEY`, `BINANCE_SECRET_KEY` → `docker compose up -d`
5. Trang Cấu hình sẽ hiện bảng **Quyền của khoá API**. Nếu dòng *Rút tiền* = **Có**
   thì xoá khoá đó và tạo lại — hệ thống chỉ cần quyền đọc

Điền địa chỉ ví nhận USDT (lấy trong ví Binance của bạn) rồi bật.

### Chuyển khoản ngân hàng

Điền ngân hàng, số tài khoản, tên chủ tài khoản và **tỉ giá USDT → VND**. Thiếu
bất kỳ thứ gì thì hệ thống từ chối bật (vì không sinh nổi số tiền trên QR).

Khách chuyển xong bấm *"Tôi đã chuyển"*; bạn đối chiếu sao kê rồi vào đơn bấm
**"Đánh dấu đã thanh toán"**. Nội dung chuyển khoản chính là mã đơn.

### Binance Pay (merchant)

Cần tài khoản **Binance Merchant** riêng. Luồng code đã có nhưng **chưa từng
chạy thử với tài khoản merchant thật** — hãy thử một đơn giá trị nhỏ trước.

---

## 5. Sao lưu — làm TRƯỚC khi bán

Mỗi dòng trong kho **chính là hàng hoá**. Mất cơ sở dữ liệu là mất sạch key,
không có cách nào dựng lại.

Dịch vụ `backup` chạy sẵn, đổ file vào `./backups` mỗi 24 giờ, giữ 14 bản.

**Diễn tập khôi phục một lần — đừng đợi đến lúc cần:**

```bash
ls -lh backups/                             # phải có ít nhất 1 file .sql.gz
./docker/restore.sh backups/webcatt-*.sql.gz   # gõ YES để xác nhận
docker compose logs api | tail              # kiểm tra khởi động lại bình thường
```

Chép bản sao lưu **ra khỏi VPS** (đĩa hỏng là mất cả máy lẫn backup):

```bash
# Trên máy của bạn, thêm vào crontab
rsync -az vps:/opt/catt-store/backups/ ~/catt-store-backups/
```

---

## Trước khi bán đơn đầu tiên

Chạy hết danh sách này. Mỗi dòng đều đã từng là một lỗi thật.

- [ ] `PAYMENT_MOCK=false` trong `.env`, và **Thanh toán giả lập** đã TẮT trong
      trang Cấu hình. Bật nhầm = ai cũng lấy hàng miễn phí
- [ ] `JWT_SECRET` là chuỗi ngẫu nhiên riêng của bạn (≥32 ký tự). API tự dừng
      nếu bạn để nguyên giá trị mẫu — nhưng đừng dựa vào đó, hãy tự sinh
- [ ] `POSTGRES_PASSWORD` do bạn tự sinh, **chỉ gồm chữ và số**
- [ ] Mở `/admin` — **dải cảnh báo đỏ ở đầu trang tổng quan phải trống**. Còn
      cảnh báo nghĩa là khách vẫn chưa đặt hàng được (chưa có phương thức thanh
      toán, chưa có sản phẩm, hoặc hết kho)
- [ ] Đổi mật khẩu chủ shop sau lần đăng nhập đầu (**Tài khoản → Đổi mật khẩu**)
- [ ] Khoá Binance hiện **Rút tiền: Không** trong bảng quyền
- [ ] `https://` hoạt động, và `http://` tự chuyển sang `https://`
- [ ] Đã chạy **một lần** diễn tập khôi phục sao lưu
- [ ] Đã soạn **Điều khoản**, **Chính sách hoàn tiền**, **Bảo mật**
      (Quản trị → Chính sách) — bán hàng số thì tranh chấp là chuyện thường ngày
- [ ] Đã điền **kênh liên hệ hỗ trợ** (Quản trị → Cấu hình) — đây cũng là đường
      duy nhất để khách quên mật khẩu tìm được bạn
- [ ] Đặt thử **một đơn giá trị nhỏ bằng tiền thật** và xác nhận nhận được key
- [ ] `curl https://shop.cua-ban.com/robots.txt` chặn `/admin` và `/orders`

---

## Vận hành hằng ngày

| Việc | Ở đâu |
|---|---|
| Xem đơn cần xử lý | Trang tổng quan → **Cần xử lý** |
| Khách chuyển khoản xong | Đơn hàng → **Đánh dấu đã thanh toán** (ghi chú nguồn tiền) |
| Khách quên mật khẩu | Khách hàng → **Đặt lại mật khẩu** (mật khẩu hiện MỘT lần) |
| Nhập thêm kho | Sản phẩm → chọn loại → dán danh sách key |
| Xem ai đã làm gì | Nhật ký |

Đơn đã thanh toán mà chưa giao được (hết kho) sẽ **tự giao lại** khi bạn nhập
thêm kho — bộ quét chạy mỗi 2 phút.

---

## Cập nhật phiên bản

```bash
cd /opt/catt-store
docker compose restart backup   # ép sao lưu ngay (dịch vụ dump luôn khi khởi động)
ls -lt backups | head -3        # xác nhận có bản mới trước khi đụng vào gì
git pull
docker compose up -d --build
docker compose logs -f api      # migration chạy tự động lúc khởi động
```

> `docker/backup.sh` là tiến trình chạy nền **bên trong container** (vòng lặp vô
> hạn) — đừng gọi thẳng trên máy chủ.

---

## Sự cố thường gặp

**Container `api` khởi động lại liên tục**
`docker compose logs api`. Thường là thiếu biến bắt buộc trong `.env`
(`JWT_SECRET`, `POSTGRES_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`) — thông báo
lỗi nói rõ thiếu cái nào.

**Khách bấm đặt hàng thì báo lỗi, hoặc không ai đặt được đơn nào**
Mở `/admin` và đọc dải cảnh báo đỏ ở đầu trang tổng quan — nó nói thẳng đang
thiếu gì (chưa bật phương thức thanh toán, chưa có sản phẩm, hết kho). Cửa hàng
mới cài **không bật sẵn phương thức nào**, đó là chủ ý.

**Từ ngoài Internet không vào được, nhưng `curl localhost:3000` trên máy chủ thì được**
Đúng thiết kế: web và api chỉ nghe trên `127.0.0.1`, mọi truy cập đi qua
`proxy`. Kiểm `docker compose ps proxy` và `docker compose logs proxy`. Chỉ đổi
`APP_BIND` khi bạn thật sự chấp nhận chạy HTTP không mã hoá.

**Không xin được chứng chỉ HTTPS**
Tên miền chưa trỏ đúng IP, hoặc cổng 80 bị chặn. `dig +short ten-mien` và
`docker compose logs proxy`.

**Trang web tải nhưng không gọi được API**
`NEXT_PUBLIC_API_URL` sai. Chạy qua proxy thì phải là `/api`, và **phải build
lại** sau khi sửa.

**Khách chuyển USDT mà đơn không tự nhận**
Kiểm `BINANCE_API_KEY` đã truyền vào container chưa
(`docker compose exec api printenv | grep BINANCE`). Trang Cấu hình phải báo
*Đã kết nối*. Trong lúc chờ, vẫn xử lý được bằng **Đánh dấu đã thanh toán**.

**Cần xem số liệu theo giờ Việt Nam**
`TZ=Asia/Ho_Chi_Minh` đã đặt sẵn trong compose. Nếu thống kê lệch, kiểm biến này.
