import type { CryptoNetwork } from '@webcatt/shared';

/**
 * Logic khớp giao dịch nạp — hàm THUẦN (không I/O) để dễ kiểm thử.
 * Đây là phần quan trọng nhất về tiền: một khoản nạp on-chain không mang mã đơn,
 * nên ta khớp theo (mạng + số tiền duy nhất + thời điểm). Mỗi khoản nạp chỉ khớp
 * đúng MỘT đơn, và txId đã dùng thì không bao giờ dùng lại.
 */

/** Mã mạng Binance trả về ↔ nhãn nội bộ. BEP20 = "BSC", TRC20 = "TRX". */
export const NETWORK_TO_BINANCE: Record<CryptoNetwork, string> = {
  BEP20: 'BSC',
  TRC20: 'TRX',
};

export function binanceNetworkToLabel(network: string): CryptoNetwork | null {
  if (network === 'BSC') return 'BEP20';
  if (network === 'TRX') return 'TRC20';
  return null;
}

export interface PendingCryptoPayment {
  orderId: string;
  network: CryptoNetwork;
  /** Số USDT duy nhất khách phải gửi (đã gồm phần lẻ). */
  expected: number;
  /** Thời điểm tạo đơn (ms) — chỉ khớp khoản nạp SAU thời điểm này (trừ dung sai). */
  createdAtMs: number;
}

export interface BinanceDeposit {
  txId: string;
  /** Mã mạng của Binance: BSC | TRX | ETH ... */
  network: string;
  amount: number;
  insertTimeMs: number;
  /** 1 = đã ghi có thành công. */
  status: number;
}

export interface DepositMatch {
  orderId: string;
  txId: string;
  amount: number;
  network: CryptoNetwork;
}

export interface MatchOptions {
  /** Sai số cho phép khi so số tiền (USDT). Mặc định 0.00005. */
  epsilon?: number;
  /** Khoản nạp được tính nếu tạo sau (createdAt - slack). Mặc định 10 phút. */
  slackMs?: number;
}

/**
 * Ghép các khoản nạp Binance với các đơn đang chờ.
 * @param pending   đơn CRYPTO đang chờ thanh toán
 * @param deposits  lịch sử nạp lấy từ Binance
 * @param usedTxIds txId đã được ghi nhận trước đó (không dùng lại)
 */
export function matchDeposits(
  pending: PendingCryptoPayment[],
  deposits: BinanceDeposit[],
  usedTxIds: ReadonlySet<string>,
  options: MatchOptions = {},
): DepositMatch[] {
  const epsilon = options.epsilon ?? 0.00005;
  const slackMs = options.slackMs ?? 10 * 60_000;

  const matches: DepositMatch[] = [];
  const claimedOrders = new Set<string>();
  const consumedTx = new Set<string>(usedTxIds);

  // Khoản nạp cũ trước, mới sau — ưu tiên gán khoản đến trước cho đơn phù hợp.
  const ordered = [...deposits]
    .filter((d) => d.status === 1 && d.txId)
    .sort((a, b) => a.insertTimeMs - b.insertTimeMs);

  for (const deposit of ordered) {
    if (consumedTx.has(deposit.txId)) continue;
    const label = binanceNetworkToLabel(deposit.network);
    if (!label) continue;

    // Đơn khớp: cùng mạng, đúng số tiền, tạo trước khi nạp (trừ dung sai), chưa bị gán.
    const candidates = pending.filter(
      (p) =>
        !claimedOrders.has(p.orderId) &&
        p.network === label &&
        Math.abs(deposit.amount - p.expected) <= epsilon &&
        deposit.insertTimeMs >= p.createdAtMs - slackMs,
    );
    /*
     * NHIỀU HƠN MỘT đơn khớp thì BỎ QUA, không đoán.
     *
     * Số tiền của đơn nay đúng bằng giá bán, nên hai khách mua cùng sản phẩm sẽ
     * chuyển hai khoản giống hệt nhau. Đoán bừa là giao hàng cho người chưa trả
     * và bỏ rơi người đã trả. Trường hợp này khách tự dán TxID để chỉ rõ khoản
     * nào của mình, hoặc chủ shop đối soát tay.
     */
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];

    claimedOrders.add(candidate.orderId);
    consumedTx.add(deposit.txId);
    matches.push({
      orderId: candidate.orderId,
      txId: deposit.txId,
      amount: deposit.amount,
      network: label,
    });
  }

  return matches;
}
