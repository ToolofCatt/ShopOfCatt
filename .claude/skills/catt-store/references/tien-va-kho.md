# Tiền và kho — những chỗ không được phá

Đọc file này **trước khi** sửa `orders/`, `payments/`, `binance-exchange/`,
`coupons/`, hoặc bất cứ đâu đụng tới `StockItem`.

---

## 1. Giữ kho: `FOR UPDATE SKIP LOCKED`

`orders/fulfillment.service.ts` → `lockAvailableStock()`

```sql
SELECT "id" FROM "StockItem"
WHERE "variantId" = $1 AND "status" = 'AVAILABLE'
ORDER BY "createdAt" ASC
LIMIT $2
FOR UPDATE SKIP LOCKED
```

**Vì sao không thay bằng `findMany` rồi `updateMany`:** hai khách bấm mua cùng
lúc sẽ cùng đọc ra một tập dòng `AVAILABLE`, rồi cả hai cùng ghi — nhận trùng
key. `SKIP LOCKED` bảo đảm mỗi transaction lấy được một tập **rời nhau**.

`ORDER BY "createdAt" ASC` giữ nguyên: key nhập trước bán trước, và thứ tự cố
định giúp giảm tranh chấp khoá.

---

## 2. Giao hàng: khoá dòng `Order` TRƯỚC MỌI THỨ

`orders/fulfillment.service.ts` → `deliverOrder()`

```ts
await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
```

Dòng này trông vô dụng vì không dùng kết quả. **Không được xoá.** Nó làm hai việc:

1. **Chống giao gấp đôi.** `alreadySold` được đọc rồi mới ghi. Nếu hai lần "giao
   lại" chạy song song (admin bấm hai lần, hoặc hai tab), cả hai cùng đọc
   `alreadySold = 0`, rồi `SKIP LOCKED` cấp cho mỗi bên một tập dòng kho **khác
   nhau** → khách nhận gấp đôi số key. Khoá này bắt lần thứ hai xếp hàng, và khi
   tới lượt nó thấy hàng đã giao.
2. **Thống nhất thứ tự khoá.** `releaseExpiredOrders` khoá `Order` rồi mới tới
   `StockItem`. Nếu `deliverOrder` làm ngược lại thì hai bên ôm khoá của nhau và
   Postgres phải huỷ một bên (deadlock).

> **Luật:** mọi transaction đụng cả `Order` lẫn `StockItem` đều khoá theo thứ tự
> **Order → StockItem**. Không có ngoại lệ.

`deliverOrder` phải giữ tính **idempotent**: đếm số dòng đã `SOLD` trước, chỉ bù
phần còn thiếu. Gọi lại lần hai không được giao thêm.

---

## 3. Khớp tiền crypto: chỉ một đường duy nhất

`binance-exchange/deposit-matcher.ts` → `matchDeposits()` (hàm thuần, có test).

Mọi nơi cần đối chiếu khoản nạp USDT đều **gọi lại hàm này** — cả bộ đối soát nền
(`orders/crypto-reconcile.service.ts`) lẫn lúc khách tự nhập TxID
(`orders/orders.service.ts`).

**Đừng bao giờ viết lại nhánh riêng.** Đã từng có một nhánh "khoản nạp nào ≥ tổng
tiền đơn thì chấp nhận". Ví nhận của shop là công khai, nên bất kỳ ai cũng có thể
mở BscScan/Tronscan, lấy TxID của khách khác, và nhận hàng miễn phí — đồng thời
khách kia mất tiền.

Cơ chế khớp: mỗi đơn có một **số tiền duy nhất** `base + k × 0.0001`. Sai số cho
phép là `0.00005` — bằng nửa khoảng cách giữa hai mức, nên không thể trùng. Nới
sai số ra `0.01` là phá vỡ toàn bộ tính duy nhất.

Ràng buộc CSDL đi kèm: `Payment.cryptoTxId` là `@unique`. Nhờ đó N request cùng
gửi một TxID thì đúng một request thành công, phần còn lại vỡ ràng buộc. Đừng bắt
lỗi ràng buộc này rồi "thử lại" — hãy để nó từ chối.

---

## 4. Luôn tính lại tiền từ CSDL

Không tin bất kỳ số tiền nào client gửi lên. Đơn giá đọc từ `ProductVariant`,
giảm giá tính bằng `calcDiscount` trong `packages/shared`, tổng cộng bằng
`sumMoney`. Tiền dùng `Prisma.Decimal` — cộng số thực trực tiếp sẽ trôi số lẻ.

---

## 5. Đổi trạng thái phải chống gọi lại

Dùng `updateMany` kèm điều kiện trạng thái, hoặc CAS:

```ts
const { count } = await tx.order.updateMany({
  where: { id, status: 'PENDING' },   // ← điều kiện là phần quan trọng
  data: { status: 'PAID', paidAt: now },
});
if (count === 0) return; // ai đó đã xử lý rồi
```

Webhook Binance có thể gửi lại nhiều lần; bộ quét nền
(`orders/delivery-sweeper.service.ts`, mỗi 2 phút) cũng có thể chạy song song với
thao tác tay của admin. `update` trần sẽ cộng tiền hoặc giao hàng hai lần.

---

## 6. Mã giảm giá

- Giữ chỗ `maxUses` phải **nguyên tử** (tăng `usedCount` có điều kiện), không
  đọc-rồi-ghi.
- Huỷ đơn — dù khách tự huỷ hay hệ thống dọn đơn hết hạn — đều phải **trả lại
  lượt**. Từng có lỗi chỉ nhánh dọn tự động mới trả, nên khách đặt–huỷ lặp lại là
  làm cạn mã khuyến mãi.
- Đường huỷ đơn của khách gọi vào cùng một hàm với đường huỷ của hệ thống, đừng
  chép lại logic.

---

## 7. Cách tự kiểm chứng

Sửa xong phần nào ở trên thì phải chứng minh bằng chạy thật, tối thiểu:

| Sửa gì | Chứng minh thế nào |
|---|---|
| Giữ kho | N request đặt cùng một loại chỉ còn 1 key → đúng 1 thành công |
| Giao hàng | Gọi "giao lại" hai lần song song → tổng số key giao ra không đổi |
| Khớp crypto | Gửi TxID của đơn khác → bị từ chối; gửi khoản nạp cũ hơn đơn → bị từ chối |
| Chống trùng TxID | N request song song cùng TxID → đúng 1 thành công |
| Mã giảm giá | Đặt–huỷ 5 lần với mã `maxUses: 1` → `usedCount` về 0 |
| Đổi trạng thái | Gọi endpoint hai lần → số tiền và số key không nhân đôi |

Viết script tạm vào thư mục scratchpad, chạy, rồi **xoá dữ liệu vừa tạo**.
