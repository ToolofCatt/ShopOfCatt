import { HttpException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsController } from './payments.controller';
import type { BinanceService } from './binance.service';
import type { PaymentsService } from './payments.service';
import type { SettingsService } from '../settings/settings.service';

/**
 * Webhook Binance là đường DUY NHẤT bên ngoài có thể tự đánh dấu một đơn đã
 * thanh toán. Ba hàng rào của nó — chặn khi đang ở chế độ giả lập, hạn thời gian,
 * và chữ ký RSA — phải được canh, vì mất một cái là phát hàng miễn phí.
 */

function makeRequest(
  headers: Record<string, string>,
  body: unknown = { bizStatus: 'PAY_SUCCESS' },
): RawBodyRequest<Request> {
  const raw = JSON.stringify(body);
  return {
    headers,
    body,
    rawBody: Buffer.from(raw, 'utf8'),
  } as unknown as RawBodyRequest<Request>;
}

function validHeaders(timestamp: number): Record<string, string> {
  return {
    'binancepay-timestamp': String(timestamp),
    'binancepay-nonce': 'n'.repeat(32),
    'binancepay-signature': 'c2lnbmF0dXJl',
  };
}

interface Stubs {
  handleSepayWebhook: ReturnType<typeof vi.fn>;
  handleBinanceWebhook: ReturnType<typeof vi.fn>;
  verifyWebhookSignature: ReturnType<typeof vi.fn>;
  controller: PaymentsController;
}

function build(
  options: {
    mock?: boolean;
    signatureValid?: boolean;
    /** Khoá API SePay đã lưu trong cấu hình; rỗng = chưa cấu hình. */
    sepayApiKey?: string;
    sepayWebhookSecret?: string;
    sepayResult?: string;
  } = {},
): Stubs {
  const handleBinanceWebhook = vi.fn().mockResolvedValue(undefined);
  const verifyWebhookSignature = vi
    .fn()
    .mockResolvedValue(options.signatureValid ?? true);
  const handleSepayWebhook = vi
    .fn()
    .mockResolvedValue(options.sepayResult ?? 'da khop don DH-TEST');

  const payments = {
    isMockMode: options.mock ?? false,
    handleBinanceWebhook,
    handleSepayWebhook,
  } as unknown as PaymentsService;
  const binance = { verifyWebhookSignature } as unknown as BinanceService;
  const settings = {
    getSepayConfig: vi.fn().mockResolvedValue({
      ready: true,
      accountNumber: '0010000000355',
      bank: 'Vietcombank',
      accountHolder: 'NGUYEN VAN A',
      vndPerUsdt: 26_000,
      apiKey: options.sepayApiKey ?? SEPAY_KEY,
      webhookSecret: options.sepayWebhookSecret ?? '',
    }),
  } as unknown as SettingsService;

  return {
    handleBinanceWebhook,
    verifyWebhookSignature,
    handleSepayWebhook,
    controller: new PaymentsController(payments, binance, settings),
  };
}

const SEPAY_KEY = 'khoa-sepay-kiem-thu';

/** Request giả cho webhook SePay — controller chỉ đọc headers + rawBody + body. */
function sepayReq(options: {
  authorization?: string;
  signature?: string;
  timestamp?: string;
  body?: Record<string, unknown>;
} = {}): RawBodyRequest<Request> {
  const body = options.body ?? {
    id: 777,
    transferType: 'in',
    transferAmount: 92_000,
    content: 'CT DEN DH-TEST',
    accountNumber: '0010000000355',
  };
  const raw = JSON.stringify(body);
  return {
    headers: {
      authorization: options.authorization ?? `Apikey ${SEPAY_KEY}`,
      ...(options.signature ? { 'x-sepay-signature': options.signature } : {}),
      ...(options.timestamp ? { 'x-sepay-timestamp': options.timestamp } : {}),
    },
    rawBody: Buffer.from(raw, 'utf8'),
    body,
  } as unknown as RawBodyRequest<Request>;
}

/** Lấy status + body của HttpException mà controller ném ra. */
async function catchHttp(
  run: () => Promise<unknown>,
): Promise<{ status: number; body: unknown }> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() };
    }
    throw error;
  }
  throw new Error('Mong đợi một HttpException nhưng không có ngoại lệ nào');
}

describe('POST /payments/binance/webhook', () => {
  it('chấp nhận webhook mới, chữ ký đúng', async () => {
    const { controller, handleBinanceWebhook } = build();

    const result = await controller.binanceWebhook(
      makeRequest(validHeaders(Date.now())),
    );

    expect(result).toEqual({ returnCode: 'SUCCESS', returnMessage: null });
    expect(handleBinanceWebhook).toHaveBeenCalledTimes(1);
  });

  it('từ chối khi đang ở chế độ thanh toán giả lập', async () => {
    // Ở chế độ giả lập không có gì xác thực được Binance thật, nên webhook phải
    // đóng hoàn toàn thay vì tin vào chữ ký của một cấu hình rỗng.
    const { controller, handleBinanceWebhook } = build({ mock: true });

    const { status } = await catchHttp(() =>
      controller.binanceWebhook(makeRequest(validHeaders(Date.now()))),
    );

    expect(status).toBe(403);
    expect(handleBinanceWebhook).not.toHaveBeenCalled();
  });

  it('từ chối webhook quá cũ (chống phát lại)', async () => {
    // Chữ ký RSA của Binance không hết hạn, nên một webhook hợp lệ bị ghi lại có
    // thể phát lại mãi mãi nếu không có cửa sổ thời gian.
    const { controller, handleBinanceWebhook, verifyWebhookSignature } = build();

    const { status, body } = await catchHttp(() =>
      controller.binanceWebhook(makeRequest(validHeaders(Date.now() - 10 * 60_000))),
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({ returnCode: 'FAIL' });
    expect(handleBinanceWebhook).not.toHaveBeenCalled();
    // Kiểm hạn phải chạy TRƯỚC khi xác minh chữ ký: rẻ hơn và không phải tải
    // chứng chỉ cho một loạt webhook phát lại.
    expect(verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it('từ chối webhook có thời điểm ở tương lai xa', async () => {
    const { controller } = build();

    const { status } = await catchHttp(() =>
      controller.binanceWebhook(makeRequest(validHeaders(Date.now() + 10 * 60_000))),
    );

    expect(status).toBe(400);
  });

  it('chấp nhận lệch giờ nhỏ giữa các máy chủ', async () => {
    const { controller, handleBinanceWebhook } = build();

    await controller.binanceWebhook(makeRequest(validHeaders(Date.now() - 60_000)));
    await controller.binanceWebhook(makeRequest(validHeaders(Date.now() + 60_000)));

    expect(handleBinanceWebhook).toHaveBeenCalledTimes(2);
  });

  it('từ chối khi thiếu hoặc sai định dạng timestamp', async () => {
    const { controller } = build();

    for (const value of ['', 'hom-qua', 'NaN']) {
      const headers = validHeaders(Date.now());
      headers['binancepay-timestamp'] = value;
      const { status } = await catchHttp(() =>
        controller.binanceWebhook(makeRequest(headers)),
      );
      expect(status).toBe(400);
    }
  });

  it('từ chối khi chữ ký không hợp lệ', async () => {
    const { controller, handleBinanceWebhook } = build({ signatureValid: false });

    const { status, body } = await catchHttp(() =>
      controller.binanceWebhook(makeRequest(validHeaders(Date.now()))),
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({ returnMessage: 'Invalid signature' });
    expect(handleBinanceWebhook).not.toHaveBeenCalled();
  });

  it('từ chối khi thiếu header chữ ký', async () => {
    const { controller, handleBinanceWebhook } = build();

    const headers = validHeaders(Date.now());
    delete headers['binancepay-signature'];
    const { status } = await catchHttp(() =>
      controller.binanceWebhook(makeRequest(headers)),
    );

    expect(status).toBe(400);
    expect(handleBinanceWebhook).not.toHaveBeenCalled();
  });

  it('xác minh chữ ký trên RAW BODY, không phải bản JSON dựng lại', async () => {
    // Chữ ký tính trên đúng chuỗi byte Binance gửi. Nếu ta ký lại
    // JSON.stringify(request.body) thì mọi khác biệt về khoảng trắng hay thứ tự
    // khoá đều làm chữ ký đúng bị coi là sai.
    const { controller, verifyWebhookSignature } = build();
    const raw = '{"bizStatus":"PAY_SUCCESS","data":"{}"}';
    const request = {
      headers: validHeaders(1_760_000_000_000),
      body: { khac: 'hoan toan' },
      rawBody: Buffer.from(raw, 'utf8'),
    } as unknown as RawBodyRequest<Request>;
    // Thời điểm cố định ở trên đã quá cũ so với hiện tại → dùng timestamp mới.
    request.headers['binancepay-timestamp'] = String(Date.now());

    await controller.binanceWebhook(request);

    expect(verifyWebhookSignature).toHaveBeenCalledWith(
      request.headers['binancepay-timestamp'],
      'n'.repeat(32),
      raw,
      'c2lnbmF0dXJl',
    );
  });
});

/**
 * Webhook SePay là đường thứ hai bên ngoài có thể đánh dấu đơn đã thanh toán.
 * Khoá API là hàng rào duy nhất, nên nhánh "chưa cấu hình khoá" phải từ chối
 * chứ không được cho qua.
 */
describe('PaymentsController — webhook SePay', () => {
  it('đúng khoá thì nhận và gọi bộ xử lý', async () => {
    const s = build();
    await expect(s.controller.sepayWebhook(sepayReq())).resolves.toEqual({
      success: true,
    });
    expect(s.handleSepayWebhook).toHaveBeenCalledTimes(1);
  });

  it('CHƯA cấu hình khoá thì trả 401, không gọi bộ xử lý', async () => {
    const s = build({ sepayApiKey: '' });
    const kq = await catchHttp(() => s.controller.sepayWebhook(sepayReq()));
    expect(kq.status).toBe(401);
    expect(s.handleSepayWebhook).not.toHaveBeenCalled();
  });

  it('sai khoá thì trả 401', async () => {
    const s = build();
    const kq = await catchHttp(() =>
      s.controller.sepayWebhook(sepayReq({ authorization: 'Apikey sai-be-bet' })),
    );
    expect(kq.status).toBe(401);
    expect(s.handleSepayWebhook).not.toHaveBeenCalled();
  });

  it('thiếu header Authorization thì trả 401', async () => {
    const s = build();
    const kq = await catchHttp(() =>
      s.controller.sepayWebhook(sepayReq({ authorization: '' })),
    );
    expect(kq.status).toBe(401);
  });

  it('phản hồi lỗi KHÔNG nói rõ sai ở bước nào', async () => {
    const s = build({ sepayApiKey: '' });
    const kq = await catchHttp(() => s.controller.sepayWebhook(sepayReq()));
    expect(JSON.stringify(kq.body)).not.toMatch(/chua-cau-hinh|apikey|khoa/i);
  });

  it('vẫn trả 200 khi giao dịch không khớp đơn nào — SePay khỏi gửi lại mãi', async () => {
    const s = build({ sepayResult: 'khong khop: khong-thay-ma-don' });
    await expect(s.controller.sepayWebhook(sepayReq())).resolves.toEqual({
      success: true,
    });
  });

  it('đã lưu khoá bí mật mà webhook thiếu chữ ký thì trả 401', async () => {
    const s = build({ sepayWebhookSecret: 'bi-mat' });
    const kq = await catchHttp(() => s.controller.sepayWebhook(sepayReq()));
    expect(kq.status).toBe(401);
    expect(s.handleSepayWebhook).not.toHaveBeenCalled();
  });

  it('truyền nguyên payload xuống bộ xử lý', async () => {
    const s = build();
    const body = {
      id: 999,
      transferType: 'in',
      transferAmount: 50_000,
      content: 'DH-ABC123',
    };
    await s.controller.sepayWebhook(sepayReq({ body }));
    expect(s.handleSepayWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 999, transferAmount: 50_000 }),
    );
  });
});
