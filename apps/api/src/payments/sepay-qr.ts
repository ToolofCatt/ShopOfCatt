/**
 * Địa chỉ ảnh VietQR do SePay dựng.
 *
 * KHÔNG tự dựng VietQR: chuỗi EMVCo cần đúng BIN ngân hàng và CRC16, sai một
 * byte là khách quét ra tài khoản không tồn tại — hoặc tệ hơn, tài khoản của
 * người khác. Đây là tiền thật, nên để phía SePay tính.
 *
 * Ảnh nằm ở host ngoài (`qr.sepay.vn`) nhưng CSP của web đã cho `img-src https:`
 * nên không phải mở thêm gì.
 */

const QR_BASE = 'https://qr.sepay.vn/img';

export interface SepayQrInput {
  accountNumber: string;
  /** Tên ngắn ("Vietcombank") hoặc mã BIN. */
  bank: string;
  /** Số tiền VND, số nguyên. */
  amountVnd: number;
  /** Nội dung chuyển khoản — ở cửa hàng này luôn là mã đơn. */
  description: string;
  accountHolder?: string;
}

/**
 * Dựng địa chỉ ảnh QR đã kèm SỐ TIỀN và NỘI DUNG.
 *
 * Khác hẳn QR crypto (chỉ chứa địa chỉ ví): app ngân hàng điền sẵn cả số tiền
 * lẫn nội dung, nên khách không tự gõ và không gõ sai mã đơn — đúng chỗ hay
 * sai nhất của luồng chuyển khoản.
 */
export function sepayQrUrl(input: SepayQrInput): string {
  const params = new URLSearchParams({
    acc: input.accountNumber,
    /*
     * BỎ DẤU CÁCH trong tên ngân hàng: chủ shop gõ "MB Bank" là qr.sepay.vn
     * trả về HTML "Ngân hàng này không được hỗ trợ" với status 200 — ảnh QR
     * chết im lặng cả trên web lẫn bot (đã gặp thật). Tên ngắn của SePay
     * không bao giờ chứa dấu cách ("MBBank", "VPBank", "Vietcombank"…).
     */
    bank: input.bank.replace(/\s+/g, ''),
    amount: String(Math.round(input.amountVnd)),
    des: input.description,
    template: 'compact',
  });
  if (input.accountHolder && input.accountHolder.trim() !== '') {
    params.set('holder', input.accountHolder.trim());
  }
  return `${QR_BASE}?${params.toString()}`;
}

/**
 * Đổi USDT sang VND, LÀM TRÒN LÊN tới đồng.
 *
 * Làm tròn lên chứ không xuống: ngân hàng không chuyển được số lẻ nhỏ hơn đồng,
 * mà bộ khớp đòi số tiền đúng tuyệt đối — làm tròn xuống là cửa hàng nhận thiếu
 * một chút ở mọi đơn, và số đó không bao giờ khớp lại được.
 */
export function usdtToVnd(usdt: number, vndPerUsdt: number): number {
  return Math.ceil(usdt * vndPerUsdt);
}
