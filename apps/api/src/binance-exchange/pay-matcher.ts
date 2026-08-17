/**
 * Khớp giao dịch Binance Pay (khách chuyển thẳng tới Binance ID của chủ shop)
 * với các đơn đang chờ.
 *
 * Số tiền của đơn đúng bằng giá bán, nên số tiền MỘT MÌNH không đủ để biết khoản
 * nào của ai. Thứ tự ưu tiên: GHI CHÚ (khách ghi mã đơn khi chuyển) → nếu không
 * có ghi chú thì chỉ khớp khi đúng một đơn phù hợp về tiền và thời điểm.
 * Mỗi giao dịch chỉ trả cho MỘT đơn, và mã giao dịch đã dùng không dùng lại.
 *
 * Hàm THUẦN, không I/O — để kiểm được mọi đường từ chối mà không cần gọi Binance.
 */

export interface PendingPayPayment {
  orderId: string;
  /** Mã đơn — thứ khách được yêu cầu ghi vào phần ghi chú (memo) khi chuyển. */
  code: string;
  /** Số USDT khách phải chuyển (đúng bằng giá bán). */
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
  /** Ghi chú người gửi nhập khi chuyển (trường `note` của Binance). */
  note?: string;
}

export interface PayMatch {
  orderId: string;
  transactionId: string;
  amount: number;
  /** Khớp nhờ đâu — hiện trong nhật ký để đối soát về sau. */
  by: 'memo' | 'amount';
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

    const dungTien = (p: PendingPayPayment): boolean =>
      Math.abs(transfer.amount - p.expected) <= epsilon;
    const dungLuc = (p: PendingPayPayment): boolean =>
      transfer.transactionTimeMs >= p.createdAtMs - slackMs;
    const conTrong = (p: PendingPayPayment): boolean => !claimedOrders.has(p.orderId);

    /*
     * ƯU TIÊN GHI CHÚ (memo). Khách được yêu cầu ghi mã đơn khi chuyển; đó là
     * cách duy nhất chỉ đúng một đơn khi số tiền bằng đúng giá bán và hai khách
     * mua cùng sản phẩm chuyển hai khoản giống hệt nhau.
     *
     * Vẫn phải soát tiền và thời điểm: ghi chú do người gửi tự nhập nên không
     * được tin một mình. Ghi mã đơn của người khác cũng chẳng lợi gì — chỉ là tự
     * bỏ tiền cho người ta nhận hàng.
     */
    const theoMemo = (() => {
      const note = transfer.note?.trim().toUpperCase();
      if (!note) return null;
      const found = pending.filter(
        (p) => conTrong(p) && note.includes(p.code.toUpperCase()) && dungTien(p) && dungLuc(p),
      );
      return found.length === 1 ? found[0] : null;
    })();

    let candidate: PendingPayPayment | null = theoMemo;
    let by: PayMatch['by'] = 'memo';

    if (!candidate) {
      // Không có ghi chú (hoặc ghi chú không khớp đơn nào) → chỉ khớp theo số
      // tiền khi CHỈ CÓ MỘT đơn phù hợp. Hai đơn cùng số thì để chủ shop xử lý,
      // đoán bừa là giao hàng cho người chưa trả.
      const theoTien = pending.filter((p) => conTrong(p) && dungTien(p) && dungLuc(p));
      if (theoTien.length !== 1) continue;
      candidate = theoTien[0];
      by = 'amount';
    }

    claimedOrders.add(candidate.orderId);
    consumed.add(transfer.transactionId);
    matches.push({
      orderId: candidate.orderId,
      transactionId: transfer.transactionId,
      amount: transfer.amount,
      by,
    });
  }

  return matches;
}
