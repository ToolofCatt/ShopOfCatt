# Bot Telegram bán hàng — thiết kế và lộ trình

> Trạng thái: **Giai đoạn 2 (duyệt hàng) đã xong.** Bố cục theo mẫu chủ shop
> chốt (kiểu bot "Piggy AI Premium"): /start → tin "Thông báo từ Admin" (từ hộp
> thông báo trang chủ) + tin chào; sản phẩm là NÚT BẤM inline — nhãn
> `{tên} | {giá} | 📦 {tồn kho}` — bấm vào là chi tiết (các loại, giá neo theo
> ngôn ngữ, tồn kho) sửa tại chỗ bằng editMessageText, có phân trang. Lõi dựng
> chuỗi nằm ở `telegram/catalog-view.ts` (thuần, có unit test); giá đi đúng
> đường giá neo của web (vi→VND, en→USD, zh→CNY — `CURRENCY_BY_LANG` phải khớp
> `CURRENCY_BY_LOCALE` của web). GĐ1 đã chốt: khách Telegram = `User` có
> `telegramChatId` (email null), key giao trong chat.
> Tiếp theo: Giai đoạn 3 (đặt đơn + thanh toán).

Mục tiêu: khách duyệt sản phẩm, đặt đơn, thanh toán và **nhận key ngay trong
Telegram** — một kênh bán song song với web, dùng chung kho, chung luồng tiền.

---

## Kết luận review: cái gì dùng lại được, cái gì phải xây

### Dùng lại nguyên vẹn (không sửa)

Lõi tiền/kho **đã** tách khỏi HTTP — đây là phát hiện quan trọng nhất:

| Việc | Đã có sẵn | Ghi chú |
|---|---|---|
| Đặt đơn + giữ kho | `OrdersService.create(user, dto)` | Nhận `User` object, không nhận request |
| Chọn phương thức | `selectPayment(userId, code, dto)` | Trả đủ dữ liệu dựng hướng dẫn trả tiền |
| Kiểm tra đã trả chưa | `checkPayment(userId, code)` | Bot gọi khi khách bấm "Tôi đã chuyển" |
| Khách nộp TxID | `submitTx(userId, code, dto)` | Đối soát qua `matchDeposits`, giữ nguyên |
| Giao hàng | `FulfillmentService` | Idempotent, khoá đúng thứ tự — **không đụng vào** |
| Đơn kẹt tự lành | `DeliverySweeperService` | Chạy nền, không phân biệt kênh |
| Dịch lỗi API | `translate(key, lang)` trong `i18n/messages.ts` | Bot bắt exception rồi tự dịch K key |
| Giá neo | `cheapestAnchored` + các hàm trong `@webcatt/shared` | Bot hiện giá giống hệt web |

Bot sẽ là một **module trong `apps/api`** gọi thẳng các service trên (in-process),
không đi qua HTTP — nên không đụng `JwtAuthGuard`, không cần cấp token.

### Ba phương thức thanh toán đều dựng lại được trong chat

| Phương thức | Trong chat hiện thế nào |
|---|---|
| SePay (VietQR) | `sepayQrUrl()` trả **URL ảnh công khai** (`qr.sepay.vn`) → `sendPhoto` bằng URL, xong |
| Binance ID | `binanceQr` là data URI ảnh chủ shop tải lên → giải mã rồi upload multipart |
| Crypto BEP20/TRC20 | `cryptoAddressQr()` trả **SVG** — Telegram không nhận SVG. Gửi địa chỉ dạng chữ (bấm giữ để copy) hoặc render lại PNG bằng chính gói `qrcode` đã có |

### Phải xây / phải quyết

1. **Khách Telegram là ai trong CSDL?** — quyết định lớn nhất, chặn mọi thứ khác.
   `Order.userId` bắt buộc, `User.email` bắt buộc + unique, đăng ký cần captcha.
   Hai phương án:

   - **A. Tài khoản bóng:** mỗi chat tạo một `User` với email giả
     `tg-<chatId>@bot.local` + mật khẩu ngẫu nhiên. Nhanh, không sửa auth.
     Nhược: trang Khách hàng đầy email giả, dữ liệu "email" mất nghĩa.
   - **B. (khuyên dùng) `email` cho phép null + thêm cột `telegramChatId String? @unique`.**
     Postgres cho nhiều NULL trong unique index nên không vướng. Việc phải sửa:
     migration, chỗ hiển thị khách hàng bên admin (rơi về tên Telegram), và soát
     lại `auth.service.ts` — đăng nhập/đăng ký web không đổi vì khách Telegram
     không bao giờ có mật khẩu. Sạch về lâu dài; A chuyển sang B sau này là một
     lần backfill nữa, tốn hơn làm B ngay.

2. **Giao key qua đâu?** Khách Telegram không đăng nhập web được (không mật
   khẩu), nên key **phải** gửi trong chat. Chấp nhận: key đi qua máy chủ
   Telegram. Giảm nhẹ: gửi trong thẻ spoiler, kèm cảnh báo tự xoá. Ghi rõ điều
   này cho chủ shop trước khi bật.

3. **Nhận update: long-polling, không webhook.** `getUpdates` timeout ~25s trong
   vòng lặp tự lên lịch (theo mẫu sweeper: `unref()`, chống chạy chồng). Lý do:
   không phải mở thêm endpoint công khai không xác thực, không phụ thuộc
   `SITE_DOMAIN`, chạy được cả khi dev local. Webhook chỉ đáng cân nhắc khi có
   nhiều instance — hiện chỉ có một container api.

4. **Thông báo "đã giao" KHÔNG được gọi Telegram trong transaction giao hàng.**
   Ràng buộc kiến trúc cứng: `deliverOrder` đang giữ khoá `Order` + `StockItem`;
   chèn một lệnh HTTP ra ngoài vào giữa là kéo dài khoá theo độ trễ mạng của
   Telegram, và lỗi mạng sẽ rollback một giao dịch tiền đã đúng. Làm theo mẫu
   sweeper: cột `telegramNotifiedAt` trên `Order` (hoặc bảng outbox), một vòng
   quét riêng gửi tin rồi đánh dấu — gửi trùng thì thà trùng còn hơn mất.

5. **Chống phá kho.** Web có captcha + phải đăng ký; Telegram tạo chat gần như
   miễn phí, mà **đơn PENDING giữ chỗ kho thật** tới khi hết hạn. Kẻ phá đặt
   loạt đơn không trả tiền = khoá sạch kho khỏi tay khách thật. Bắt buộc từ
   giai đoạn đầu: mỗi chat tối đa N đơn PENDING (đề xuất 2), throttle lệnh theo
   chat (RateLimitGuard là guard HTTP — bot phải tự làm), và nút huỷ đơn rõ ràng.

6. **Bộ chữ cho bot.** Bot nói ba thứ tiếng như web. Từ điển web nằm ở
   `apps/web` — bot không import được. Làm `apps/api/src/telegram/messages.ts`
   theo đúng mẫu `i18n/messages.ts` (vi/en/zh, thiếu khoá = lỗi biên dịch).
   Ngôn ngữ chọn theo `language_code` của Telegram, cho đổi bằng lệnh.

7. **Cấu hình & bí mật.** Theo đúng tiền lệ `sepayApiKey`/`aiApiKey`:
   - `StoreSetting`: `telegramBotEnabled Boolean`, `telegramBotToken String`
     (BÍ MẬT — không vào `AdminStoreSettingDto`, không vào nhật ký, chỉ trả
     `set/hint`), sửa được ở `/admin/settings`.
   - Fail-closed: bật mà thiếu token ⇒ bot không chạy + `getReadiness()` phải
     báo — đúng loại "lỗi im lặng" mà readiness sinh ra để bắt.
   - Token mẫu trong tài liệu/ví dụ phải vào danh sách chặn ở `auth.module.ts`
     + `prisma/seed.ts` (repo công khai).
   - Không cần thư viện mới: Bot API là HTTPS thuần, repo đã dùng `fetch` khắp nơi.

---

## Lộ trình theo giai đoạn

Mỗi giai đoạn tự đứng được, xanh `typecheck + test + build`, chạy thử thật rồi
mới sang giai đoạn sau.

- **GĐ 1 — Nền.** Quyết A/B ở mục 1 → migration (`User.telegramChatId`, cột
  `StoreSetting`, `Order.telegramNotifiedAt`); module `telegram/` khung: đọc
  token, `getMe` kiểm token lúc bật, vòng long-poll, `/start`; cài đặt admin +
  readiness; kiểm migration trên CSDL rỗng bằng shadow database.
- **GĐ 2 — Duyệt hàng.** Danh sách sản phẩm (nút bấm phân trang), chi tiết +
  chọn loại, giá neo theo ngôn ngữ. Chỉ đọc — chưa đụng tiền.
- **GĐ 3 — Đặt và trả.** Tạo đơn qua `OrdersService.create`, hướng dẫn trả tiền
  theo từng phương thức, nút "Tôi đã chuyển" → `checkPayment`, nhận TxID →
  `submitTx`, huỷ đơn, chống phá kho (mục 5). **Giai đoạn rủi ro nhất — bắt
  buộc chạy thử thật cả ba phương thức.**
- **GĐ 4 — Giao key.** Vòng quét gửi key (mục 4), thẻ spoiler, gửi lại khi
  khách yêu cầu, lịch sử đơn của chat.
- **GĐ 5 — Tuỳ chọn.** Báo chủ shop (đơn mới/kẹt/kho cạn) vào chat riêng; lệnh
  quản trị. Tách riêng vì đối tượng nhận khác (chủ shop ≠ khách).

## Chuỗi file phải sửa cùng nhau (theo checklist thêm-tính-năng)

| Đụng vào | Nhớ sửa đủ |
|---|---|
| Schema | `schema.prisma` → `pnpm --filter @webcatt/api db:migrate` → kiểm trên CSDL rỗng |
| Biến môi trường (nếu thêm) | `.env.docker.example` + `apps/api/.env.example` + `docker-compose.yml` + `docs/TRIEN-KHAI.md` |
| Cài đặt admin | `settings.service.ts` (`getReadiness` + che bí mật) + trang `/admin/settings` + đủ ba từ điển web |
| Lỗi mới từ API | `i18n/messages.ts` — khoá + đủ ba ngôn ngữ |
| Chữ bot | `telegram/messages.ts` — vi là nguồn chuẩn, en/zh khai kiểu để thiếu là lỗi biên dịch |

## Nhắc lại ràng buộc không được phá

Toàn bộ mục "Ràng buộc không được phá" trong `CLAUDE.md` áp dụng nguyên vẹn —
bot chỉ là một cái vỏ chat quanh các service sẵn có. Đặc biệt: **không** viết
đường tắt đối soát tiền riêng cho Telegram (mọi khớp tiền crypto vẫn chỉ đi qua
`matchDeposits`), và **không** nới hạn token hay thêm quyền gì cho khoá Binance.
