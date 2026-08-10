---
name: catt-store
description: Hướng dẫn làm việc an toàn trên mã nguồn Catt Store — cửa hàng bán key/sản phẩm số có giao hàng tự động. Dùng khi sửa đơn hàng, thanh toán, kho key, mã giảm giá, trang quản trị, đa ngôn ngữ, migration CSDL, hoặc khi chuẩn bị triển khai. Chứa các ràng buộc về tiền và kho mà nếu phá vỡ sẽ mất tiền thật, cùng danh sách kiểm cho từng loại thay đổi.
---

# Làm việc trên Catt Store

Mỗi dòng `StockItem` **là một món hàng đã mua bằng tiền**. Giao trùng, giao nhầm,
hay nhận nhầm thanh toán đều là thiệt hại thật và không hoàn tác được. Skill này
gom lại những chỗ dễ sai nhất, phần lớn viết ra từ lỗi đã thực sự xảy ra.

## Trước tiên: xác định loại việc

| Bạn đang làm gì | Đọc tiếp |
|---|---|
| Sửa đơn hàng, thanh toán, kho, mã giảm giá | `references/tien-va-kho.md` — **bắt buộc** |
| Thêm/đổi tính năng, chữ hiển thị, schema, endpoint | `references/them-tinh-nang.md` |
| Sắp commit, sắp phát hành, sắp lên VPS | `references/kiem-tra.md` |

Việc không chạm vào ba nhóm trên (sửa CSS, đổi bố cục, viết tài liệu) thì làm
bình thường theo `CLAUDE.md` ở gốc repo.

## Luật chung, áp dụng cho mọi thay đổi

**1. Chạy thử thật, đừng chỉ đọc code.**
Ở dự án này những lỗi nặng nhất đều lọt qua vòng đọc code và chỉ lộ ra khi gọi
endpoint thật: cổng thanh toán giả lập không xác thực, `submitTx` nhận bất kỳ
khoản nạp nào lớn hơn tiền đơn, hai request cùng TxID cùng được giao hàng. Cách
kiểm chứng: dựng dữ liệu bằng API quản trị, gọi endpoint, đọc kết quả trả về.

```bash
# Đăng nhập lấy token rồi gọi endpoint — mẫu dùng lại được
node -e "
const B='http://localhost:3001/api';
(async()=>{
  const t=(await (await fetch(B+'/auth/login',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:'...',password:'...'})})).json()).accessToken;
  const r=await fetch(B+'/admin/stats',{headers:{authorization:'Bearer '+t}});
  console.log(r.status, JSON.stringify(await r.json()).slice(0,300));
})();"
```

**2. Dọn sạch dữ liệu kiểm thử.**
Cửa hàng này đang chuẩn bị bán thật. Tạo sản phẩm/đơn để thử thì phải xoá đi và
trả cấu hình về nguyên trạng, rồi xác nhận lại bằng số đếm (`order.count()`,
`product.count()`, `stockItem.count()`).

**3. Ba ràng buộc chủ shop đã chốt — không tự ý đổi.**
- **Không email tự động.** Quên mật khẩu = khách liên hệ admin qua kênh hỗ trợ.
- Khoá Binance **chỉ đọc**. Không thêm lệnh gọi cần quyền rút tiền/giao dịch.
- Thanh toán **fail-closed**: không có phương thức nào thì báo lỗi rõ ràng, tuyệt
  đối không âm thầm quay về cổng giả lập.

**4. Chú thích giải thích *tại sao*, bằng tiếng Việt.**
Chú thích trong repo này phần lớn là bằng chứng của một sự cố. Khi sửa một lỗi
thật, ghi lại lỗi đó là gì — người sau (kể cả agent khác) cần biết vì sao đoạn
code trông "thừa" kia lại không được xoá.

**5. Báo cáo trung thực.**
Test hỏng thì nói hỏng kèm output. Bỏ bước nào thì nói rõ bỏ bước nào và vì sao.
Nếu chính bài kiểm tra của mình sai chứ không phải hệ thống sai, cũng nói thẳng.

## Lệnh hay dùng

```bash
pnpm typecheck                  # bắt buộc xanh trước khi commit
pnpm test                       # 38 test
pnpm build
pnpm db:embedded                # PostgreSQL nhúng :5433, giữ cửa sổ mở
pnpm --filter @webcatt/api db:migrate    # tạo migration mới sau khi đổi schema
```

Dừng dev server trước khi `pnpm build` — trên Windows `next dev` giữ khoá thư mục
`.next` và build sẽ treo thay vì báo lỗi.
