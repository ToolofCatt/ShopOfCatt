# Giảm giá theo phương thức thanh toán

Vào **Quản trị → Cấu hình → Thanh toán → Giảm giá theo phương thức thanh toán**.
Đặt phần trăm riêng cho Binance Pay merchant, Binance ID, ngân hàng, BEP20 và
TRC20. Nhập `0` để tắt; chấp nhận tối đa hai chữ số thập phân, từ 0 đến 99%.
Cấu hình ưu đãi không tự bật cổng thanh toán. Các bản cài hiện có mặc định 0%.

Ưu đãi chỉ áp dụng cho đơn mua hàng, sau mã giảm giá. Ví dụ tiền hàng 10 USDT,
coupon giảm 20%, Binance Pay giảm 10%: khách trả 7,2 USDT. Giảm theo phương thức
được làm tròn xuống sáu chữ số USDT; ngân hàng chốt VND theo cơ chế hiện có.
Không áp dụng ưu đãi này cho nạp ví, giả lập hoặc trả bằng số dư.

Máy chủ tính từ dữ liệu đã chốt của đơn; không nhận số tiền giảm do khách gửi.
Khi đổi phương thức, bỏ mức giảm cũ rồi tính mức mới, không giảm chồng lặp.
Sửa phần trăm trong admin không đổi giá phiên thanh toán đã phát hành; mức mới
áp dụng khi tạo/chọn một phương thức khác. Tiền đến từ phiên cũ được đối chiếu
với snapshot của phiên đó và ghi nhận đúng tổng/ưu đãi khi thanh toán thành công.
Nếu tạo link thanh toán mới thất bại, hóa đơn hiện tại giữ nguyên giá.

Web và Telegram hiển thị phần trăm trên lựa chọn phương thức. Sau khi chọn,
số phải trả lấy từ Payment/Order máy chủ. Simulator quản trị dùng cùng renderer.

## English

Configure each method under **Admin → Settings → Payments → Payment method
discounts**. Use 0 to disable, or 0–99% with at most two decimal places. Offers
apply after coupons to purchases only, excluding wallet funding and balance/mock
payments. Existing issued sessions keep their quoted amount. Switching methods
recalculates from the amount after the coupon; discounts never compound on retry.
Late payments use the original session snapshot. New installations and upgrades
start with no payment discounts. Setting a discount does not enable a gateway.
