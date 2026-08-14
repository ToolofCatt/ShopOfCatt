import { HttpException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsController } from './payments.controller';
import type { BinanceService } from './binance.service';
import type { PaymentsService } from './payments.service';

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
  handleBinanceWebhook: ReturnType<typeof vi.fn>;
  verifyWebhookSignature: ReturnType<typeof vi.fn>;
  controller: PaymentsController;
}

function build(options: { mock?: boolean; signatureValid?: boolean } = {}): Stubs {
  const handleBinanceWebhook = vi.fn().mockResolvedValue(undefined);
  const verifyWebhookSignature = vi
    .fn()
    .mockResolvedValue(options.signatureValid ?? true);

  const payments = {
    isMockMode: options.mock ?? false,
    handleBinanceWebhook,
  } as unknown as PaymentsService;
  const binance = { verifyWebhookSignature } as unknown as BinanceService;

  return {
    handleBinanceWebhook,
    verifyWebhookSignature,
    controller: new PaymentsController(payments, binance),
  };
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
