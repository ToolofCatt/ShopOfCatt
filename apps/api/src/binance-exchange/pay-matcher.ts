/**
 * Khớp giao dịch Binance Pay (khách chuyển thẳng tới Binance ID của chủ shop)
 * với các đơn đang chờ.
 *
 * Cùng một bài toán như khoản nạp on-chain: giao dịch KHÔNG mang mã đơn, nên ta
 * khớp theo (số tiền duy nhất + thời điểm). Mỗi giao dịch chỉ trả cho MỘT đơn,
 * và mã giao dịch đã dùng thì không bao giờ dùng lại.
 *
 * Hàm THUẦN, không I/O — để kiểm được mọi đường từ chối mà không cần gọi Binance.
 */

export interface PendingPayPayment {
  orderId: string;
  /** Số USDT duy nhất khách phải chuyển. */
  expected: number;
  /** Thời điểm tạo đơn (ms) — chỉ khớp giao dịch SAU mốc này (trừ dung sai). */
  createdAtMs: number;
}

/** Một dòng trong `/sapi/v1/pay/transactions`, đã chuẩn hoá. */
export interface BinancePayTransfer {
  transactionId: string;
  /** Dương = tiền VÀO tài khoản, âm = tiền ra. */
  amount: number;
  currency: string;
  transactionTimeMs: number;
  /** Binance ID của bên nhận, nếu API trả về. */
  receiverBinanceId?: string;
}

export interface PayMatch {
  orderId: string;
  transactionId: string;
  amount: number;
}

export interface PayMatchOptions {
  /** Sai số cho phép khi so tiền (USDT). Mặc định 0.00005 — nửa bước 0.0001. */
  epsilon?: number;
  /** Giao dịch được tính nếu đến sau (createdAt - slack). Mặc định 10 phút. */
  slackMs?: number;
  /**
   * Binance ID của cửa hàng. Truyền vào thì chỉ nhận giao dịch có bên nhận đúng
   * ID này — chặn trường hợp lịch sử Pay của tài khoản có cả tiền vào từ nguồn
   * khác (hoàn tiền, thưởng…) vô tình trùng số.
   */
  receiverBinanceId?: string;
}

export function matchPayTransfers(
  pending: PendingPayPayment[],
  transfers: BinancePayTransfer[],
  usedTransactionIds: ReadonlySet<string>,
  options: PayMatchOptions = {},
): PayMatch[] {
  const epsilon = options.epsilon ?? 0.00005;
  const slackMs = options.slackMs ?? 10 * 60_000;
  const wantedReceiver = options.receiverBinanceId?.trim();

  const matches: PayMatch[] = [];
  const claimedOrders = new Set<string>();
  const consumed = new Set<string>(usedTransactionIds);

  const ordered = [...transfers]
    // `amount > 0` là tiền VÀO. Bỏ qua tiền ra, nếu không một khoản chi 5 USDT
    // của chủ shop có thể bị khớp thành một đơn 5 USDT của khách.
    .filter(
      (t) =>
        t.transactionId &&
        t.amount > 0 &&
        t.currency.toUpperCase() === 'USDT' &&
        (!wantedReceiver ||
          !t.receiverBinanceId ||
          t.receiverBinanceId === wantedReceiver),
    )
    .sort((a, b) => a.transactionTimeMs - b.transactionTimeMs);

  for (const transfer of ordered) {
    if (consumed.has(transfer.transactionId)) continue;

    const candidate = pending.find(
      (p) =>
        !claimedOrders.has(p.orderId) &&
        Math.abs(transfer.amount - p.expected) <= epsilon &&
        transfer.transactionTimeMs >= p.createdAtMs - slackMs,
    );
    if (!candidate) continue;

    claimedOrders.add(candidate.orderId);
    consumed.add(transfer.transactionId);
    matches.push({
      orderId: candidate.orderId,
      transactionId: transfer.transactionId,
      amount: transfer.amount,
    });
  }

  return matches;
}
