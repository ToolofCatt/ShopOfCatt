import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaymentInfoDto, PaymentMethodDto } from '@webcatt/shared';
import { createPaymentCheckGate, getPaymentUi } from './payment-ui';

const methods: PaymentMethodDto[] = [{ method: 'sepay' }, { method: 'binance_id', qr: 'id-qr' }];

// Giả lập payload còn sót trường của phiên cũ: mode mới không được mở lại link/QR đó.
function payment(mode: string, extra: Partial<PaymentInfoDto> = {}): PaymentInfoDto {
  return {
    mode: mode as PaymentInfoDto['mode'], status: 'PENDING',
    checkoutUrl: 'https://pay.example/old-session', mockPayUrl: '/mock-pay/old-session',
    cryptoQr: 'crypto-qr', qrcodeLink: 'merchant-qr', sepayQrUrl: 'bank-qr',
    ...extra,
  };
}

const unavailableFields = { method: null, qrSrc: null, checkoutUrl: null, mockPayUrl: null, canCheckPayment: false };

describe('payment UI fail-closed session policy', () => {
  it.each(['INITIALIZING', 'FUTURE_GATEWAY', '', 'BALANCE'])('never exposes payment actions or stale URLs for %s', (mode) => {
    expect(getPaymentUi(payment(mode), methods, 'DH-TEST')).toMatchObject(unavailableFields);
  });

  it('distinguishes waiting, unknown and balance without claiming a successful payment', () => {
    expect(getPaymentUi(payment('INITIALIZING'), methods, 'DH-TEST').kind).toBe('INITIALIZING');
    expect(getPaymentUi(null, methods, 'DH-TEST')).toMatchObject({ kind: 'INITIALIZING', ...unavailableFields });
    expect(getPaymentUi(payment('FUTURE_GATEWAY'), methods, 'DH-TEST').kind).toBe('UNAVAILABLE');
    expect(getPaymentUi(payment('BALANCE'), methods, 'DH-TEST').kind).toBe('BALANCE');
  });

  it.each([
    ['MOCK', {}, 'mock', null, '/mock-pay/old-session', null],
    ['BINANCE', {}, 'binance_pay', 'merchant-qr', null, 'https://pay.example/old-session'],
    ['BINANCE_ID', {}, 'binance_id', 'id-qr', null, null],
    ['SEPAY', {}, 'sepay', 'bank-qr', null, null],
    ['CRYPTO', { cryptoNetwork: 'BEP20' }, 'crypto_bep20', 'crypto-qr', null, null],
    ['CRYPTO', { cryptoNetwork: 'TRC20' }, 'crypto_trc20', 'crypto-qr', null, null],
  ] as const)('selects only URLs belonging to %s', (mode, extra, method, qrSrc, mockPayUrl, checkoutUrl) => {
    expect(getPaymentUi(payment(mode, extra), methods, 'DH-TEST')).toEqual({
      kind: mode, method, qrSrc, mockPayUrl, checkoutUrl, canCheckPayment: true,
    });
  });

  it('does not infer BEP20 from missing or unknown crypto networks', () => {
    for (const cryptoNetwork of [undefined, 'FUTURE_CHAIN'] as const) {
      expect(getPaymentUi(payment('CRYPTO', { cryptoNetwork: cryptoNetwork as PaymentInfoDto['cryptoNetwork'] }), methods, 'DH-TEST'))
        .toMatchObject({ kind: 'UNAVAILABLE', ...unavailableFields });
    }
  });

  it('only constructs a sandbox fallback for an explicitly MOCK session', () => {
    expect(getPaymentUi({ mode: 'MOCK', status: 'PENDING' }, [], 'DH-TEST').mockPayUrl).toBe('/mock-pay/DH-TEST');
    expect(getPaymentUi(null, [], 'DH-TEST').mockPayUrl).toBeNull();
  });
});

describe('shared automatic/manual payment check gate', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('keeps a 5-minute burst of automatic and manual attempts below 60 requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const gate = createPaymentCheckGate();
    const sentAt: number[] = [];
    const request = async () => { sentAt.push(Date.now()); };
    const interval = setInterval(() => { void gate.run(request); }, 3000);
    for (let elapsed = 0; elapsed < 300_000; elapsed += 1000) {
      await gate.run(request);
      await vi.advanceTimersByTimeAsync(1000);
    }
    clearInterval(interval);
    expect(sentAt.length).toBeGreaterThan(0);
    expect(sentAt.length).toBeLessThanOrEqual(60);
    expect(sentAt.every((time, index) => index === 0 || time - sentAt[index - 1] >= 6000)).toBe(true);
  });

  it('never overlaps a slow request, even after the normal interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const gate = createPaymentCheckGate();
    let finish!: () => void;
    let calls = 0;
    const pending = gate.run(() => { calls += 1; return new Promise<void>((resolve) => { finish = resolve; }); });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await gate.run(async () => { calls += 1; })).toBe(false);
    expect(calls).toBe(1);
    finish();
    expect(await pending).toBe(true);
    expect(await gate.run(async () => { calls += 1; })).toBe(true);
    expect(calls).toBe(2);
  });

  it('invalidates a pending refresh when selecting a new session without resetting the request budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const gate = createPaymentCheckGate();
    let finish!: () => void;
    let displayedSession = 'INITIALIZING';
    const pending = gate.run(async (isCurrent) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      if (isCurrent()) displayedSession = 'INITIALIZING';
    });
    gate.invalidate();
    displayedSession = 'SEPAY';
    finish();
    await pending;
    expect(displayedSession).toBe('SEPAY');
    expect(await gate.run(async () => {})).toBe(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await gate.run(async (isCurrent) => { expect(isCurrent()).toBe(true); })).toBe(true);
  });

  it('counts failed requests toward the cooldown and releases the in-flight lock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const gate = createPaymentCheckGate();
    await expect(gate.run(async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    let calls = 0;
    expect(await gate.run(async () => { calls += 1; })).toBe(false);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await gate.run(async () => { calls += 1; })).toBe(true);
    expect(calls).toBe(1);
  });
});
