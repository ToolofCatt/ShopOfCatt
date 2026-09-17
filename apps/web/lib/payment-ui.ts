import type { PaymentInfoDto, PaymentMethod, PaymentMethodDto, PaymentMode } from '@webcatt/shared';

interface PaymentUi {
  kind: PaymentMode | 'UNAVAILABLE';
  method: PaymentMethod | null;
  qrSrc: string | null;
  checkoutUrl: string | null;
  mockPayUrl: string | null;
  canCheckPayment: boolean;
}

export function getPaymentUi(payment: PaymentInfoDto | null, methods: PaymentMethodDto[] | null, code: string): PaymentUi {
  const unavailable: PaymentUi = {
    kind: 'UNAVAILABLE', method: null, qrSrc: null, checkoutUrl: null,
    mockPayUrl: null, canCheckPayment: false,
  };
  if (!payment) return { ...unavailable, kind: 'INITIALIZING' };

  // Không suy ra cổng từ URL/QR còn sót: phiên chưa tạo hoặc mode lạ phải đóng.
  switch (payment.mode) {
    case 'INITIALIZING':
    case 'BALANCE':
      return { ...unavailable, kind: payment.mode };
    case 'MOCK':
      return { ...unavailable, kind: 'MOCK', method: 'mock', canCheckPayment: true, mockPayUrl: payment.mockPayUrl || `/mock-pay/${code}` };
    case 'BINANCE':
      return { ...unavailable, kind: 'BINANCE', method: 'binance_pay', canCheckPayment: true, checkoutUrl: payment.checkoutUrl ?? null, qrSrc: payment.qrcodeLink ?? null };
    case 'BINANCE_ID':
      return { ...unavailable, kind: 'BINANCE_ID', method: 'binance_id', canCheckPayment: true, qrSrc: methods?.find((entry) => entry.method === 'binance_id')?.qr ?? null };
    case 'SEPAY':
      return { ...unavailable, kind: 'SEPAY', method: 'sepay', canCheckPayment: true, qrSrc: payment.sepayQrUrl ?? null };
    case 'CRYPTO':
      if (payment.cryptoNetwork !== 'BEP20' && payment.cryptoNetwork !== 'TRC20') return unavailable;
      return { ...unavailable, kind: 'CRYPTO', method: payment.cryptoNetwork === 'TRC20' ? 'crypto_trc20' : 'crypto_bep20', canCheckPayment: true, qrSrc: payment.cryptoQr ?? null };
    default:
      return unavailable;
  }
}

// API giới hạn 60 lần/5 phút. Chừa dư với 6 giây, kể cả nút kiểm tra thủ công.
export const PAYMENT_POLL_INTERVAL_MS = 6000;

export function createPaymentCheckGate() {
  let inFlight = false;
  let nextCheckAt = 0;
  let generation = 0;
  return {
    // Đổi phương thức/unmount không được cho response phiên cũ ghi đè phiên mới.
    invalidate() { generation += 1; },
    async run(request: (isCurrent: () => boolean) => Promise<void>): Promise<boolean> {
      const now = Date.now();
      if (inFlight || now < nextCheckAt) return false;
      inFlight = true;
      nextCheckAt = now + PAYMENT_POLL_INTERVAL_MS;
      const requestGeneration = generation;
      try {
        await request(() => requestGeneration === generation);
        return true;
      } finally {
        inFlight = false;
      }
    },
  };
}
