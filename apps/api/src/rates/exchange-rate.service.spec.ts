import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExchangeRateService } from './exchange-rate.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SettingsService } from '../settings/settings.service';

/**
 * `vndPerUsdt` vừa dùng để HIỆN giá vừa dùng để dựng SỐ TIỀN CHUYỂN KHOẢN, nên
 * ghi một con số sai vào đó là khách chuyển sai tiền hàng loạt. Mọi nhánh từ
 * chối ở đây phải GIỮ NGUYÊN tỉ giá cũ, không được ghi đè.
 */

interface Boi {
  service: ExchangeRateService;
  update: ReturnType<typeof vi.fn>;
}

function build(options: { markup?: number; rateAuto?: boolean } = {}): Boi {
  const update = vi.fn().mockResolvedValue({});
  const prisma = { storeSetting: { update } } as unknown as PrismaService;
  const settings = {
    getSetting: vi.fn().mockResolvedValue({
      id: 'main',
      rateMarkupPercent: options.markup ?? 0,
      rateAuto: options.rateAuto ?? true,
      rateUpdatedAt: null,
    }),
  } as unknown as SettingsService;
  return { service: new ExchangeRateService(prisma, settings), update };
}

/** Giả `fetch` toàn cục — dịch vụ gọi ra Internet bằng fetch trần. */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ExchangeRateService.refresh — đường thành công', () => {
  it('ghi đúng tỉ giá khi không có biên', async () => {
    stubFetch({ result: 'success', rates: { VND: 26_053.431334, CNY: 6.739393 } });
    const b = build({ markup: 0 });

    const kq = await b.service.refresh();

    expect(kq.ok).toBe(true);
    expect(kq.vndPerUsdt).toBe(26_053.43);
    expect(kq.cnyPerUsdt).toBe(6.7394);
    expect(b.update).toHaveBeenCalledTimes(1);
  });

  it('cộng biên cho CẢ VND và CNY', async () => {
    stubFetch({ result: 'success', rates: { VND: 26_000, CNY: 7 } });
    const b = build({ markup: 2 });

    const kq = await b.service.refresh();

    expect(kq.vndPerUsdt).toBe(26_520); // 26000 × 1.02
    expect(kq.cnyPerUsdt).toBe(7.14); //     7 × 1.02
  });

  it('ghi lại giá trị thô và biên vào rateSource để soi lại', async () => {
    stubFetch({ result: 'success', rates: { VND: 26_000, CNY: 7 } });
    const b = build({ markup: 1.5 });

    await b.service.refresh();

    const data = b.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(String(data.rateSource)).toContain('26000');
    expect(String(data.rateSource)).toContain('1.5%');
    expect(data.rateUpdatedAt).toBeInstanceOf(Date);
  });
});

describe('ExchangeRateService.refresh — GIỮ tỉ giá cũ', () => {
  it('nguồn trả HTTP lỗi → không ghi gì', async () => {
    stubFetch({}, { ok: false, status: 503 });
    const b = build();

    const kq = await b.service.refresh();

    expect(kq.ok).toBe(false);
    expect(kq.reason).toContain('503');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('mạng lỗi → không ghi gì', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ETIMEDOUT')));
    const b = build();

    const kq = await b.service.refresh();

    expect(kq.ok).toBe(false);
    expect(b.update).not.toHaveBeenCalled();
  });

  it('phản hồi thiếu VND → không ghi gì', async () => {
    stubFetch({ result: 'success', rates: { CNY: 7 } });
    const b = build();

    expect((await b.service.refresh()).ok).toBe(false);
    expect(b.update).not.toHaveBeenCalled();
  });

  it('nguồn báo result khác success → không ghi gì', async () => {
    stubFetch({ result: 'error', rates: { VND: 26_000, CNY: 7 } });
    const b = build();

    expect((await b.service.refresh()).ok).toBe(false);
    expect(b.update).not.toHaveBeenCalled();
  });

  it('VND quá NHỎ (nguồn đổi đơn vị) → không ghi gì', async () => {
    stubFetch({ result: 'success', rates: { VND: 26, CNY: 7 } });
    const b = build();

    const kq = await b.service.refresh();
    expect(kq.ok).toBe(false);
    expect(kq.reason).toContain('VND');
    expect(kq.rawVnd).toBe(26);
    expect(b.update).not.toHaveBeenCalled();
  });

  it('VND quá LỚN (thừa ba số 0) → không ghi gì', async () => {
    stubFetch({ result: 'success', rates: { VND: 26_000_000, CNY: 7 } });
    const b = build();

    expect((await b.service.refresh()).ok).toBe(false);
    expect(b.update).not.toHaveBeenCalled();
  });

  it('CNY ngoài khoảng → không ghi gì, dù VND hợp lệ', async () => {
    stubFetch({ result: 'success', rates: { VND: 26_000, CNY: 700 } });
    const b = build();

    const kq = await b.service.refresh();
    expect(kq.ok).toBe(false);
    expect(kq.reason).toContain('CNY');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('VND = 0 → không ghi gì (0 sẽ TẮT nhận chuyển khoản)', async () => {
    stubFetch({ result: 'success', rates: { VND: 0, CNY: 7 } });
    const b = build();

    expect((await b.service.refresh()).ok).toBe(false);
    expect(b.update).not.toHaveBeenCalled();
  });

  it('VND không phải số → không ghi gì', async () => {
    stubFetch({ result: 'success', rates: { VND: 'nhieu lam', CNY: 7 } });
    const b = build();

    expect((await b.service.refresh()).ok).toBe(false);
    expect(b.update).not.toHaveBeenCalled();
  });
});
