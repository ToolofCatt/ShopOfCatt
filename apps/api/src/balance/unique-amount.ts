/**
 * Chọn số USDT DUY NHẤT cho một mã nạp crypto / Binance ID — hàm THUẦN.
 *
 * On-chain không có chỗ ghi mã nạp, nên SỐ TIỀN là thứ duy nhất chỉ ra khoản
 * nào của ai. Bộ đối soát (matchDeposits/matchPayTransfers) cố ý KHÔNG đoán:
 * hai khoản chờ trùng số tiền là nó từ chối khớp cả hai. Vì vậy mỗi mã nạp
 * được cộng thêm bước 0.0001 USDT cho tới khi cách MỌI khoản đang chờ (cả mã
 * nạp lẫn đơn crypto) tối thiểu UNIQUE_GAP — gấp 4 lần epsilon 0.00005 của
 * matcher, để một giao dịch không bao giờ lọt vào vùng sai số của hai khoản.
 */

/** Bước cộng thêm — 0.0001 USDT ≈ 2,6 ₫, khách không cảm nhận được. */
export const UNIQUE_STEP_USDT = 0.0001;
/** Khoảng cách tối thiểu giữa hai khoản chờ (4 × epsilon của matcher). */
export const UNIQUE_GAP_USDT = 0.0002;
/** Tối đa cộng thêm 200 bước = 0.02 USDT (~520 ₫) rồi bỏ cuộc. */
const MAX_TRIES = 200;

export function pickUniqueUsdt(
  base: number,
  taken: readonly number[],
): number | null {
  for (let k = 0; k < MAX_TRIES; k++) {
    // toFixed(6) rồi Number lại: cột CSDL là Decimal(18,6) — số phải nằm gọn
    // trong 6 chữ số lẻ, không được mang đuôi nhị phân 5.000100000000001.
    const candidate = Number((base + k * UNIQUE_STEP_USDT).toFixed(6));
    const clash = taken.some(
      (t) => Math.abs(t - candidate) < UNIQUE_GAP_USDT - 1e-9,
    );
    if (!clash) return candidate;
  }
  return null;
}
