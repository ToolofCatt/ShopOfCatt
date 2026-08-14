import { describe, expect, it } from 'vitest';
import {
  binanceNetworkToLabel,
  buildUniqueCryptoAmount,
  matchDeposits,
  NETWORK_TO_BINANCE,
  type BinanceDeposit,
  type PendingCryptoPayment,
} from './deposit-matcher';

/**
 * Đây là phần quan trọng nhất về tiền trong cả hệ thống: một khoản nạp on-chain
 * không mang mã đơn, nên hệ thống chỉ có (mạng + số tiền duy nhất + thời điểm)
 * để quyết định ai được nhận hàng. Từng có nhánh "deposit.amount >= total" cho
 * phép khai bất kỳ khoản nạp nào lớn hơn tiền đơn — lấy TxID của người khác trên
 * BscScan là nhận hàng miễn phí. Các test dưới đây canh đúng chỗ đó.
 */

const T0 = 1_760_000_000_000; // mốc thời gian cố định, không dùng Date.now()

function pending(over: Partial<PendingCryptoPayment> = {}): PendingCryptoPayment {
  return {
    orderId: 'order-1',
    network: 'BEP20',
    expected: 12.3456,
    createdAtMs: T0,
    ...over,
  };
}

function deposit(over: Partial<BinanceDeposit> = {}): BinanceDeposit {
  return {
    txId: 'tx-1',
    network: 'BSC',
    amount: 12.3456,
    insertTimeMs: T0 + 60_000,
    status: 1,
    ...over,
  };
}

describe('binanceNetworkToLabel', () => {
  it('chỉ nhận đúng hai mạng đang hỗ trợ', () => {
    expect(binanceNetworkToLabel('BSC')).toBe('BEP20');
    expect(binanceNetworkToLabel('TRX')).toBe('TRC20');
  });

  it('mạng khác trả null — không được đoán bừa', () => {
    // Nạp USDT qua ETH/SOL vẫn vào cùng một ví Binance. Đoán bừa sang BEP20 là
    // khớp sai đơn.
    expect(binanceNetworkToLabel('ETH')).toBeNull();
    expect(binanceNetworkToLabel('SOL')).toBeNull();
    expect(binanceNetworkToLabel('')).toBeNull();
    expect(binanceNetworkToLabel('bsc')).toBeNull();
  });

  it('khớp vòng với NETWORK_TO_BINANCE', () => {
    for (const label of ['BEP20', 'TRC20'] as const) {
      expect(binanceNetworkToLabel(NETWORK_TO_BINANCE[label])).toBe(label);
    }
  });
});

describe('matchDeposits — đường đúng', () => {
  it('khớp khi cùng mạng, đúng số tiền, nạp sau khi tạo đơn', () => {
    const matches = matchDeposits([pending()], [deposit()], new Set());
    expect(matches).toEqual([
      { orderId: 'order-1', txId: 'tx-1', amount: 12.3456, network: 'BEP20' },
    ]);
  });

  it('chấp nhận sai số trong khoảng epsilon (nửa bước 0.0001)', () => {
    const matches = matchDeposits(
      [pending({ expected: 12.3456 })],
      [deposit({ amount: 12.34564 })],
      new Set(),
    );
    expect(matches).toHaveLength(1);
  });

  it('khớp TRC20 độc lập với BEP20', () => {
    const matches = matchDeposits(
      [pending({ network: 'TRC20' })],
      [deposit({ network: 'TRX' })],
      new Set(),
    );
    expect(matches[0]?.network).toBe('TRC20');
  });
});

describe('matchDeposits — những khoản nạp PHẢI bị từ chối', () => {
  it('số tiền lớn hơn tiền đơn KHÔNG được khớp', () => {
    // Chính là lỗ hổng cũ: khách khai TxID của một khoản nạp lớn của người khác.
    const matches = matchDeposits(
      [pending({ expected: 12.3456 })],
      [deposit({ amount: 999 })],
      new Set(),
    );
    expect(matches).toEqual([]);
  });

  it('lệch quá epsilon thì từ chối, dù chỉ lệch một bước 0.0001', () => {
    expect(
      matchDeposits(
        [pending({ expected: 12.3456 })],
        [deposit({ amount: 12.3457 })],
        new Set(),
      ),
    ).toEqual([]);
  });

  it('thiếu tiền cũng từ chối', () => {
    expect(
      matchDeposits([pending()], [deposit({ amount: 12.3 })], new Set()),
    ).toEqual([]);
  });

  it('sai mạng thì từ chối dù số tiền trùng khít', () => {
    expect(
      matchDeposits(
        [pending({ network: 'BEP20' })],
        [deposit({ network: 'TRX' })],
        new Set(),
      ),
    ).toEqual([]);
  });

  it('mạng không hỗ trợ thì bỏ qua', () => {
    expect(
      matchDeposits([pending()], [deposit({ network: 'ETH' })], new Set()),
    ).toEqual([]);
  });

  it('khoản nạp chưa ghi có (status khác 1) thì bỏ qua', () => {
    // status 0 = đang chờ xác nhận on-chain. Giao hàng lúc này là giao trước khi
    // tiền thật sự vào, mà giao dịch vẫn còn có thể bị đảo.
    expect(
      matchDeposits([pending()], [deposit({ status: 0 })], new Set()),
    ).toEqual([]);
  });

  it('khoản nạp thiếu txId thì bỏ qua', () => {
    expect(
      matchDeposits([pending()], [deposit({ txId: '' })], new Set()),
    ).toEqual([]);
  });

  it('khoản nạp có TRƯỚC khi đơn được tạo (ngoài dung sai) thì từ chối', () => {
    // Nếu không chặn, khách tạo đơn mới rồi khai một khoản nạp cũ của mình để
    // trả tiền hai lần cho hai đơn.
    expect(
      matchDeposits(
        [pending({ createdAtMs: T0 })],
        [deposit({ insertTimeMs: T0 - 11 * 60_000 })],
        new Set(),
        { slackMs: 10 * 60_000 },
      ),
    ).toEqual([]);
  });

  it('nhưng vẫn nhận khoản nạp sớm hơn đơn trong phạm vi dung sai', () => {
    // Khách hay chuyển tiền trước rồi mới bấm đặt đơn; lệch giờ giữa các máy chủ
    // cũng nằm trong khoảng này.
    expect(
      matchDeposits(
        [pending({ createdAtMs: T0 })],
        [deposit({ insertTimeMs: T0 - 5 * 60_000 })],
        new Set(),
        { slackMs: 10 * 60_000 },
      ),
    ).toHaveLength(1);
  });

  it('txId đã dùng trước đó thì không dùng lại', () => {
    expect(
      matchDeposits([pending()], [deposit({ txId: 'tx-cu' })], new Set(['tx-cu'])),
    ).toEqual([]);
  });
});

describe('matchDeposits — không được giao trùng', () => {
  it('MỘT khoản nạp không trả được cho HAI đơn cùng số tiền', () => {
    const matches = matchDeposits(
      [
        pending({ orderId: 'order-A' }),
        pending({ orderId: 'order-B' }),
      ],
      [deposit()],
      new Set(),
    );
    expect(matches).toHaveLength(1);
  });

  it('HAI khoản nạp giống nhau trả cho HAI đơn khác nhau, mỗi đơn một lần', () => {
    const matches = matchDeposits(
      [pending({ orderId: 'order-A' }), pending({ orderId: 'order-B' })],
      [deposit({ txId: 'tx-1' }), deposit({ txId: 'tx-2' })],
      new Set(),
    );
    expect(matches).toHaveLength(2);
    expect(new Set(matches.map((m) => m.orderId))).toEqual(
      new Set(['order-A', 'order-B']),
    );
    expect(new Set(matches.map((m) => m.txId))).toEqual(new Set(['tx-1', 'tx-2']));
  });

  it('cùng một txId xuất hiện hai lần trong danh sách chỉ được tính một lần', () => {
    // Lịch sử nạp lấy từ API có thể trùng lặp khi hai lần quét gối đầu nhau.
    const matches = matchDeposits(
      [pending({ orderId: 'order-A' }), pending({ orderId: 'order-B' })],
      [deposit({ txId: 'tx-1' }), deposit({ txId: 'tx-1' })],
      new Set(),
    );
    expect(matches).toHaveLength(1);
  });

  it('khoản nạp đến TRƯỚC được ưu tiên (ai trả trước nhận trước)', () => {
    const matches = matchDeposits(
      [pending({ orderId: 'order-A' })],
      [
        deposit({ txId: 'tx-moi', insertTimeMs: T0 + 300_000 }),
        deposit({ txId: 'tx-cu', insertTimeMs: T0 + 60_000 }),
      ],
      new Set(),
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].txId).toBe('tx-cu');
  });

  it('không sửa mảng đầu vào và không sửa tập txId đã dùng', () => {
    const deposits = [deposit({ txId: 'tx-2', insertTimeMs: T0 + 2 }), deposit({ txId: 'tx-1', insertTimeMs: T0 + 1 })];
    const snapshot = deposits.map((d) => d.txId);
    const used = new Set<string>();
    matchDeposits([pending()], deposits, used);
    expect(deposits.map((d) => d.txId)).toEqual(snapshot);
    expect(used.size).toBe(0);
  });

  it('không có đơn nào chờ thì không khớp gì', () => {
    expect(matchDeposits([], [deposit()], new Set())).toEqual([]);
  });
});

describe('buildUniqueCryptoAmount', () => {
  /** randomInt tất định để test không phụ thuộc may mắn. */
  const fixedRandom = (value: number) => () => value;

  it('luôn cộng thêm phần lẻ, không bao giờ trả về đúng giá gốc', () => {
    const amount = buildUniqueCryptoAmount(12, [], fixedRandom(0));
    expect(amount).not.toBeNull();
    expect(amount).toBeGreaterThan(12);
    // k nhỏ nhất là 1 → +0.0001
    expect(amount).toBeCloseTo(12.0001, 6);
  });

  it('tránh những số tiền đã có đơn khác đang chờ', () => {
    // randomInt luôn trả 0 → thử k=1 trước; k=1 đã bị chiếm nên phải sang k=2.
    const amount = buildUniqueCryptoAmount(12, [12.0001], fixedRandom(0));
    expect(amount).toBeCloseTo(12.0002, 6);
  });

  it('so sánh theo micro-USDT nên không bị sai vì số thực', () => {
    // 0.1 + 0.2 !== 0.3 trong số thực; hàm phải quy về số nguyên trước khi so.
    const amount = buildUniqueCryptoAmount(0.3, [0.3001], fixedRandom(0));
    expect(amount).toBeCloseTo(0.3002, 6);
  });

  it('hết cả 999 chỗ thì trả null thay vì cấp số trùng', () => {
    // Cấp trùng nghĩa là hai đơn cùng số tiền → khoản nạp khớp sai đơn.
    const taken = Array.from({ length: 999 }, (_, i) => 12 + (i + 1) * 0.0001);
    expect(buildUniqueCryptoAmount(12, taken, fixedRandom(0))).toBeNull();
  });

  it('vẫn tìm ra chỗ trống dù ngẫu nhiên liên tục trỏ vào chỗ đã chiếm', () => {
    // Sau 40 lần thử ngẫu nhiên, hàm quét tuần tự 1..999 để chắc chắn tìm ra.
    const amount = buildUniqueCryptoAmount(12, [12.0007], fixedRandom(6));
    expect(amount).not.toBeNull();
    expect(amount).not.toBeCloseTo(12.0007, 6);
  });
});
