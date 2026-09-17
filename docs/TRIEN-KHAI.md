# Triển khai Digital Store lên máy chủ thật

Hướng dẫn này dành cho: **một VPS riêng + Docker + một tên miền**. Làm theo đúng
thứ tự, mỗi bước đều có cách tự kiểm chứng.

> **Đọc mục [Trước khi bán đơn đầu tiên](#trước-khi-bán-đơn-đầu-tiên) trước khi
> nhận tiền thật.** Có vài công tắc mà bật sai là phát hàng miễn phí.

---

## Cảnh báo khi cập nhật bản vá vận hành

- **Không chạy lại `install.sh` để cập nhật hoặc chữa lỗi khởi động.** Installer
  từ chối nếu còn `.env`, container hoặc volume `webcatt`; không xoay mật khẩu/JWT.
  Nếu lần cài đầu bị ngắt, giữ nguyên `.env` rồi tiếp tục bằng Compose của **đúng
  deployment** sau khi kiểm tra lỗi. Mất `.env` nhưng còn volume: tìm lại cấu hình
  gốc từ bản lưu an toàn; không sinh mật khẩu Postgres mới, không xóa volume.
- Heartbeat chuyển từ `backups/.last-success.json` sang
  `backup-status/.last-success.json`. Dump và volume PostgreSQL **không đổi vị
  trí/tên**. Xem mục 5 trước khi recreate API/backup; không mở quyền dump để chữa
  lỗi API không đọc được heartbeat.
- Restore mặc định là thao tác **phá hủy target** sau diễn tập. Dùng
  `--rehearsal` khi chỉ muốn kiểm backup và `--no-start` khi cần giữ writer dừng
  để đối soát. Chỉ nhận dump tin cậy của chính shop, không SQL từ nguồn lạ.

## 0. Chuẩn bị

| Thứ cần có | Ghi chú |
|---|---|
| VPS | Tính cả OS, build và các dịch vụ khác: riêng giới hạn Postgres + API + web đã khoảng 2,25 GB. Chạy staging cùng máy chỉ khi còn đủ RAM/đĩa; không ép máy 2 GB chạy cả hai stack |
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

### Biến thể: máy chủ đã có sẵn nginx phục vụ trang khác

Đây là cách một deployment dùng chung proxy ngoài có thể chạy. Máy đó còn phục vụ vài trang khác,
nên **không được bật service `proxy` (Caddy)** — Caddy giành cổng 80/443 là hạ
hết những trang kia.

```bash
# Dựng mọi thứ TRỪ proxy
docker compose up -d --build postgres api web backup
```

Trong `.env` đổi cổng để không đụng dịch vụ có sẵn, và chỉ mở trên máy nội bộ:

```env
APP_BIND=127.0.0.1     # container không được lộ ra LAN/WAN
WEB_PORT=18100
API_PORT=18101
POSTGRES_PORT=5433
```

Rồi thêm một file vhost **riêng** trong `/etc/nginx/sites-available/` — tuyệt đối
không sửa file của trang khác. Ba điểm dễ sai:

- **`client_max_body_size` phải ≥ 4m.** Ảnh sản phẩm được nén trong trình duyệt
  rồi gửi lên dạng data URI trong JSON, vượt mặc định 1m của nginx.
- **Khối `location /.well-known/acme-challenge/` phải đứng trước lệnh 301** ở vhost
  cổng 80, nếu không certbot gia hạn sẽ hỏng.
- **Đừng thêm `add_header Strict-Transport-Security`** — Next.js đã gửi sẵn trong
  `next.config.ts`. `add_header` của nginx là *thêm* chứ không thay thế, hai header
  trùng tên làm trình duyệt chỉ đọc cái đầu tiên.

Chứng chỉ xin bằng webroot, và **phải có hook nạp lại nginx**:

```bash
certbot certonly --webroot -w /var/www/html -d shop.cua-ban.com -d www.shop.cua-ban.com

# Không có hook này thì sau lần gia hạn đầu (~60 ngày) certbot thay file trên đĩa
# nhưng nginx vẫn phục vụ chứng chỉ cũ trong bộ nhớ → trình duyệt báo hết hạn.
printf '#!/bin/sh\nnginx -t && systemctl reload nginx\n' \
  > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
certbot renew --dry-run     # mất vài phút, phải báo "all simulated renewals succeeded"
```

Nếu máy chạy Tailscale thì nó đã giữ `<ip-tailscale>:443`, nên vhost phải
`listen <ip-lan>:443 ssl;` chứ không phải `listen 443 ssl;` — bind wildcard sẽ
hỏng với "Address already in use".

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

### Binance Pay (merchant)

Cần tài khoản **Binance Merchant** riêng. Luồng code đã có nhưng **chưa từng
chạy thử với tài khoản merchant thật** — hãy thử một đơn giá trị nhỏ trước.

---

## 5. Sao lưu — làm TRƯỚC khi bán

Mỗi dòng trong kho **chính là hàng hoá**. Mất cơ sở dữ liệu là mất sạch key,
không có cách nào dựng lại.

Dịch vụ `backup` chạy sẵn, đổ file vào `./backups` mỗi 24 giờ, giữ 14 bản.
`./storectl backup` chạy **một lần** và trả exit code thật; không coi container
`running` hay lệnh restart thành công là bằng chứng backup đã xong. Worker dùng
khóa `backups/.backup.lock` để tránh hai backup ghi heartbeat/retention chồng nhau.
Nếu báo đang có lock, chờ lượt hiện tại; sau crash/kill cứng, chỉ xóa thư mục lock
rỗng khi đã xác minh cả worker định kỳ lẫn container `run --once` đều dừng. Không
xóa lock tự động để ép chạy. File SQL tạm private còn lại sau kill cứng cũng chỉ
dọn sau khi xác minh không còn worker.

### Tách heartbeat khỏi dump khi nâng cấp

Dump chứa key/email/hash: thư mục `backups` mode **700**, bản mới mode **600**.
Chỉ metadata (`completedAt`, tên file, số byte) nằm trong `backup-status` mode
**755**, heartbeat **644**; API user `node` chỉ mount thư mục này read-only.

Thực hiện trong cửa sổ bảo trì đã cho phép, từ thư mục deployment cũ:

```bash
# Không đổi webcatt_pgdata, tên container hay nơi chứa dump.
mkdir -p backup-status
chmod 755 backup-status
chmod 700 backups
# Cập nhật đúng source/image đã kiểm chứng trước khi recreate.
docker compose up -d --no-deps api backup
./storectl backup
./storectl doctor --json
```

Không cần copy heartbeat cũ: worker sẽ ghi bản mới sau backup thành công. Không
mount lại `backups` vào API, không `chmod -R 777`. Các dump cũ vẫn được bảo vệ bởi
thư mục 700; có thể siết riêng từng file cũ về 600. Git Bash/NTFS không chứng minh
quyền POSIX: xác nhận trên Linux rằng UID `node` đọc được heartbeat nhưng không
có mount `/backups`.

### Diễn tập và phục hồi

Chọn **một tên file cụ thể**, không dùng wildcard khớp nhiều bản. Chỉ chạy các
lệnh dưới đây trên máy/stack đã được phép; ví dụ tên file chỉ là minh họa:

```bash
# Kiểm gzip + giải nén một lần + end marker + SQL vào database tạm.
# Không stop/start writer, không thay đổi target. Có CREATE/DROP database tạm.
./storectl restore --rehearsal backups/webcatt-20260917-010000-AbCd1234.sql.gz

# Chỉ khi thực sự cần thay target, sau khi được phép downtime/rollback.
./storectl restore --no-start backups/webcatt-20260917-010000-AbCd1234.sql.gz
```

`--no-start` vẫn cần gõ `YES`. Script kiểm rehearsal trước, rồi dừng
`api web backup`, dùng lại `backup.sh --once` lấy backup cuối của target, thay
schema và nạp **cùng file SQL private bất biến** trong một transaction. So sánh
counts `StockItem|Order|User` với rehearsal trước khi báo thành công. Counts
không thay kiểm ledger/stock/settlement invariants của bản phát hành.

Bất kỳ lỗi gzip/giải nén/end marker/SQL rehearsal: target chưa bị sửa và không
stop writer. Lỗi sau stop: **không tự start**. Không khởi động API để "xem thử"
khi chưa đối soát. Lỗi DROP database tạm được báo rõ; không xóa database khác để
vượt lỗi. Dump phải do `pg_dump --no-owner --no-acl` của worker tạo, không có
`--create`; yêu cầu dung lượng cho file nén private, SQL giải nén, DB rehearsal
và backup target. SQL dump có thể chứa lệnh psql: rehearsal **không phải sandbox**
để kiểm file không tin cậy.

Mặc định không có flag sẽ start lại `api web backup` **chỉ sau mọi bước thành
công**; dùng `--no-start` trong cutover. Nếu còn writer bên ngoài Compose (process
Node chạy tay, service khác), phải dừng chúng theo runbook trước restore; ba
service Compose không bao quát writer ngoài. Database production cần diễn tập
migration: chỉ PostgreSQL cách ly, không API/bot, không xuất key/raw dump khỏi host.

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

## Staging và cập nhật phiên bản

### Staging synthetic độc lập

`docker-compose.staging.yml` là manifest **độc lập**, không override manifest
production. Không có `container_name`, image `latest`, proxy production hay
external volume. Mỗi `STAGING_ID` tạo project/images/network/volumes riêng;
các cổng mặc định chỉ loopback `15433`, `18401`, `18400`. Tổng giới hạn RAM runtime
khoảng **1,4 GB**, chưa tính Docker/OS/build; kiểm tài nguyên thật trước khi chạy
cùng production. `internal: true`, gateway mode `isolated` (IPv4/IPv6) và DNS
loopback chặn egress runtime, đồng thời bỏ IP bridge để container không gọi dịch
vụ host qua gateway. Cần Docker Engine hỗ trợ gateway modes: **không tự hạ về
`nat`** để chạy cho được. Trước khi bật app phải xác minh trên Linux external
IP/DNS, host gateway/metadata đều không tới được và published loopback ports còn
hoạt động; nếu engine không hỗ trợ, dừng staging để thiết kế lại ingress, không
nới egress. Build/pull không được cô lập bằng network runtime này.
[Hành vi gateway modes của Docker](https://docs.docker.com/engine/network/port-publishing/#gateway-modes).

Tạo env-file riêng **ngoài repo**, mode 600, không copy `.env` production. Cần:
`STAGING_ID` (tag chữ-số/dấu gạch riêng), `STAGING_POSTGRES_PASSWORD` (chữ/số),
`STAGING_JWT_SECRET` (ngẫu nhiên ≥32 ký tự), `STAGING_ADMIN_EMAIL`,
`STAGING_ADMIN_PASSWORD` (ngẫu nhiên, không mẫu công khai). Có thể đổi
`STAGING_POSTGRES_PORT`, `STAGING_API_PORT`, `STAGING_WEB_PORT` khi cổng đã bận.
Không nhúng giá trị bí mật vào lệnh, repo hay log `compose config` đầy đủ.

Ví dụ chỉ chạy sau approval, từ snapshot source candidate đã kiểm chứng:

```bash
# Kiểm manifest, không in cấu hình chứa secrets.
docker compose --env-file /secure/catt-stage.env -f docker-compose.staging.yml config --quiet
# Mặc định CHỈ PostgreSQL. API/web/backup cần bật profile app một cách tường minh.
docker compose --env-file /secure/catt-stage.env -f docker-compose.staging.yml up -d postgres
# Chỉ với database rỗng synthetic mới, chưa từng restore production.
docker compose --env-file /secure/catt-stage.env -f docker-compose.staging.yml --profile app up -d --build
```

Secret provider đều rỗng; mock thanh toán off, seed demo off. DB mới có
`rateAuto=false`, bot token/recipient/SePay key rỗng theo default schema. Provider
fixture nếu cần phải bổ sung **nội bộ** mạng isolated, không nối mạng production.
Không import settings thật rồi mới tắt: worker/outbox có thể chạy ngay lúc boot,
maintenance UI không chặn worker. Chỉ user/order/key `TEST-*`; kiểm auth/CSP bản
build, mua/mark-paid và ledger invariants bằng fixture được phép, không tiền/key thật.
Rehearsal dữ liệu production phải dùng project **chỉ PostgreSQL khác**, không bật
profile app trên volume từng chứa dữ liệu production.

Khi chạy restore với manifest staging, truyền `COMPOSE_FILE` và
`COMPOSE_ENV_FILES` trỏ manifest/env-file staging; `POSTGRES_DB=stage_store`,
`POSTGRES_USER=stage_user` phải khớp. Không gọi `storectl` production để suy đoán
project staging. Fixture shell dùng Docker giả lập không thay Linux rehearsal.

### Gate trước cutover

1. Pin candidate image và image/config cũ, lưu SHA-256 source đã kiểm chứng.
   `scripts/release.mjs` chỉ đóng gói HEAD sạch; khi chưa commit, ZIP HEAD cũ
   **không chứa bản vá**. Không deploy nhầm ZIP đó thay snapshot candidate.
2. Staging Linux xanh; kiểm backup/restore rehearsal và migration riêng trước.
   Không sửa credentials hoặc chạy installer lại.
3. Dừng admission/writers theo kế hoạch downtime thật (không chỉ maintenance UI),
   lấy final backup bằng `./storectl backup`, kiểm gzip + rehearsal, rồi migrate
   một lần và bật đúng image candidate. Lệnh Compose tự migrate khi API boot,
   nên không bật API trước bước migration/cutover được duyệt.
4. Health/readiness và read-only smoke đã xét side effect. Trang `/admin` phải
   hết cảnh báo launch. GET orders có thể cleanup expiry nên không mặc định an toàn.
5. Trước khi mở writer có thể rollback snapshot đã xác minh. **Sau khi mở bán,
   không restore snapshot cũ** mà chưa đối soát giao dịch mới. Với schema claim
   tiền mới, image cũ không tự nhiên tương thích; giữ writer dừng để forward-fix
   nếu chưa có compatibility image đã kiểm chứng.

> `docker/backup.sh` chạy **bên trong container**; không gọi daemon trực tiếp
> trên host. `./storectl backup` dùng `--once` và báo lỗi thật.

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
