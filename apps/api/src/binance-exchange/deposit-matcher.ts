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

    // Tìm đơn khớp: cùng mạng, đúng số tiền, tạo trước khi nạp (trừ dung sai), chưa bị gán.
    const candidate = pending.find(
      (p) =>
        !claimedOrders.has(p.orderId) &&
        p.network === label &&
        Math.abs(deposit.amount - p.expected) <= epsilon &&
        deposit.insertTimeMs >= p.createdAtMs - slackMs,
    );
    if (!candidate) continue;

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

/**
 * Sinh số tiền USDT DUY NHẤT cho một đơn: giá gốc + phần lẻ k×0.0001, với k là
 * bước NHỎ NHẤT còn trống. Trả null khi hết chỗ (k > 999).
 *
 * Vì sao phần lẻ phải tồn tại: giao dịch on-chain lẫn Binance Pay đều KHÔNG mang
 * mã đơn. Số tiền chính là mã đơn — bỏ nó đi thì hai khách cùng mua một sản phẩm
 * sẽ gửi hai khoản giống hệt nhau và hệ thống không có cách nào biết ai là ai.
 *
 * Vì sao lấy bước nhỏ nhất chứ không bốc ngẫu nhiên như trước: ngẫu nhiên trong
 * 1..999 cộng trung bình +0.05 USDT và tối đa +0.0999 — khách nhìn vào tưởng bị
 * thu phí. Lấy tuần tự thì cửa hàng ít đơn chờ gần như luôn ra +0.0001, tức một
 * phần vạn USDT, coi như bằng không.
 *
 * Đoán trước được số tiền KHÔNG phải lỗ hổng: kẻ gửi đúng số tiền của đơn người
 * khác chỉ đang tự bỏ tiền ra để người kia được nhận hàng.
 */
export function buildUniqueCryptoAmount(
  base: number,
  takenAmounts: readonly number[],
): number | null {
  const taken = new Set(takenAmounts.map((a) => Math.round(a * 1_000_000)));
  const baseUnits = Math.round(base * 1_000_000);

  for (let k = 1; k <= 999; k++) {
    const units = baseUnits + k * 100; // k × 0.0001 USDT = k×100 micro-USDT
    if (!taken.has(units)) return units / 1_000_000;
  }
  return null;
}
