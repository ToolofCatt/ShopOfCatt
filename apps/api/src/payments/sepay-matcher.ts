/**
 * Khớp một giao dịch SePay với đơn đang chờ.
 *
 * Hàm THUẦN, không đụng CSDL — để kiểm được mọi nhánh bằng test đơn vị. Đây là
 * chỗ quyết định có giao hàng hay không, nên mọi luật phải nằm ở đúng một nơi.
 */

/** Phần payload webhook mà mã này thực sự đọc. */
export interface SepayTransaction {
  /** Id giao dịch của SePay — hàng rào chống dùng lại. */
  id: number | string;
  /** "in" = tiền vào. Tiền ra thì bỏ qua. */
  transferType: string;
  /** Số tiền, đơn vị VND. */
  transferAmount: number;
  /** Nội dung chuyển khoản — chỗ chứa mã đơn. */
  content: string;
  /** Mã thanh toán SePay tự tách được (có thể null). */
  code?: string | null;
  /** "YYYY-MM-DD HH:MM:SS" theo giờ máy chủ SePay. */
  transactionDate?: string;
  /** Số tài khoản nhận — dùng để chắc tiền vào đúng tài khoản của cửa hàng. */
  accountNumber?: string;
}

export interface PendingSepayPayment {
  orderId: string;
  /** Mã đơn, ví dụ "DH-YWD4UM" — thứ khách phải ghi vào nội dung chuyển. */
  code: string;
  /** Số VND phải chuyển, đã chốt lúc tạo đơn. */
  expectedVnd: number;
}

export type SepayReject =
  | 'khong-phai-tien-vao'
  | 'sai-tai-khoan'
  | 'khong-thay-ma-don'
  | 'nhieu-don-cung-khop'
  | 'sai-so-tien';

export interface SepayMatchResult {
  payment: PendingSepayPayment | null;
  /** Vì sao bị từ chối — để ghi log cho chủ shop tra, không hiện cho khách. */
  reason?: SepayReject;
  /** Số tiền lệch (VND): dương = khách chuyển thiếu. */
  shortfall?: number;
}

export interface SepayMatchOptions {
  /** Số tài khoản cửa hàng đang nhận. Bỏ trống = không kiểm. */
  expectedAccountNumber?: string;
}

/**
 * Bỏ mọi ký tự không phải chữ/số rồi in hoa.
 *
 * Ngân hàng cắt gọt nội dung chuyển khoản rất thoải mái: "DH-YWD4UM" có thể tới
 * dưới dạng "DHYWD4UM", "dh ywd4um", hay lẫn trong "CT DEN:... DH YWD4UM ...".
 * So khớp thô là trượt gần hết.
 */
export function normalizeMemo(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

/**
 * "YYYY-MM-DD HH:MM:SS" → mốc thời gian, ĐỌC THEO GIỜ VIỆT NAM (UTC+7).
 *
 * SePay không gửi kèm múi giờ. Chỉ dùng để GHI LẠI và ghi log, KHÔNG dùng làm
 * điều kiện chấp nhận — xem chú thích ở `matchSepayTransaction`.
 */
export function parseSepayDate(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  // Giờ Việt Nam là UTC+7 nên trừ đi 7 tiếng để về mốc thật.
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - 7 * 3_600_000;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Tìm đơn ứng với một giao dịch.
 *
 * Luật, theo thứ tự:
 * 1. Chỉ nhận tiền VÀO.
 * 2. Đúng tài khoản nhận của cửa hàng (nếu có truyền vào).
 * 3. MÃ ĐƠN phải có trong nội dung chuyển khoản. Đây là điều kiện BẮT BUỘC,
 *    không có nhánh "cứ đúng số tiền thì cho qua": hai khách mua cùng sản phẩm
 *    chuyển hai khoản giống hệt nhau, đoán bừa là giao hàng cho người chưa trả.
 * 4. Số tiền phải khớp TUYỆT ĐỐI. Chuyển thiếu thì từ chối kèm số còn thiếu để
 *    chủ shop xử lý tay — tuyệt đối không giao hàng khi thiếu tiền.
 *
 * KHÔNG có luật nào về thời gian. `transactionDate` của SePay không mang múi giờ
 * nên mọi phép so thời gian đều là phỏng đoán — mà ở đây nó cũng chẳng thêm gì:
 * mã đơn là duy nhất cho từng đơn, nên một giao dịch cũ không thể mang mã của
 * đơn mới; còn phát lại chính giao dịch đó thì đã bị chặn bởi `sepayRef @unique`.
 * Khác với đối soát crypto, nơi số tiền là dấu hiệu duy nhất và mốc thời gian
 * thật sự cần thiết.
 */
export function matchSepayTransaction(
  tx: SepayTransaction,
  pending: readonly PendingSepayPayment[],
  options: SepayMatchOptions = {},
): SepayMatchResult {
  if (tx.transferType !== 'in') {
    return { payment: null, reason: 'khong-phai-tien-vao' };
  }

  const taiKhoan = options.expectedAccountNumber?.trim();
  if (taiKhoan && (tx.accountNumber ?? '').trim() !== taiKhoan) {
    return { payment: null, reason: 'sai-tai-khoan' };
  }

  // `code` do SePay tách sẵn thì tin trước, nhưng vẫn dò cả `content` vì nhiều
  // ngân hàng nhồi mã đơn vào giữa một chuỗi dài và SePay không tách được.
  const noiDung = normalizeMemo(`${tx.code ?? ''} ${tx.content ?? ''}`);
  const ungVien = pending.filter((p) => noiDung.includes(normalizeMemo(p.code)));

  if (ungVien.length === 0) {
    return { payment: null, reason: 'khong-thay-ma-don' };
  }
  /*
   * Hai đơn cùng khớp nghĩa là mã đơn này là tiền tố của mã đơn kia (hoặc chủ
   * shop vừa đổi cách sinh mã). Không đoán — để chủ shop đối soát tay.
   */
  if (ungVien.length > 1) {
    return { payment: null, reason: 'nhieu-don-cung-khop' };
  }

  const don = ungVien[0];
  if (tx.transferAmount !== don.expectedVnd) {
    return {
      payment: null,
      reason: 'sai-so-tien',
      shortfall: don.expectedVnd - tx.transferAmount,
    };
  }

  return { payment: don };
}
