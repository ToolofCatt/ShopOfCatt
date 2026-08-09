import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, createVerify } from 'node:crypto';
import { generateNonce } from '../common/codes';
import { K } from '../i18n/messages';

interface BinanceApiEnvelope<T> {
  status?: string;
  code?: string;
  errorMessage?: string;
  data?: T;
}

export interface BinanceCreateOrderInput {
  merchantTradeNo: string;
  orderAmount: number;
  currency: string;
  description: string;
  goods: Array<{ productId: string; name: string; unitPrice: number }>;
  returnUrl: string;
  cancelUrl: string;
  webhookUrl: string;
  orderExpireTime: number;
}

export interface BinanceCreateOrderResult {
  prepayId: string;
  checkoutUrl: string;
  qrcodeLink: string;
  deeplink: string;
  universalUrl: string;
}

interface BinanceCertificate {
  certSerial: string;
  certPublic: string;
}

/**
 * Tích hợp Binance Pay merchant API: ký HMAC-SHA512 cho request,
 * tạo đơn (v3), truy vấn đơn (v2), xác minh chữ ký RSA của webhook
 * (certificate được cache trong bộ nhớ).
 */
@Injectable()
export class BinanceService {
  private readonly logger = new Logger(BinanceService.name);
  private cachedCertPublic: string | null = null;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (
      this.config.get<string>('BINANCE_PAY_BASE_URL') ??
      'https://bpay.binanceapi.com'
    );
  }

  private get apiKey(): string {
    return this.config.get<string>('BINANCE_PAY_API_KEY') ?? '';
  }

  private get apiSecret(): string {
    return this.config.get<string>('BINANCE_PAY_API_SECRET') ?? '';
  }

  /** UPPERCASE hex của HMAC-SHA512(timestamp + "\n" + nonce + "\n" + body + "\n"). */
  private sign(timestamp: string, nonce: string, jsonBody: string): string {
    return createHmac('sha512', this.apiSecret)
      .update(`${timestamp}\n${nonce}\n${jsonBody}\n`)
      .digest('hex')
      .toUpperCase();
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    if (!this.apiKey || !this.apiSecret) {
      throw new BadGatewayException(
        K.binanceNotConfigured,
      );
    }
    const timestamp = Date.now().toString();
    const nonce = generateNonce(32);
    const jsonBody = JSON.stringify(body);
    const signature = this.sign(timestamp, nonce, jsonBody);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'BinancePay-Timestamp': timestamp,
        'BinancePay-Nonce': nonce,
        'BinancePay-Certificate-SN': this.apiKey,
        'BinancePay-Signature': signature,
      },
      body: jsonBody,
    });

    if (!response.ok) {
      throw new BadGatewayException({
        key: K.binanceHttpError,
        params: { status: response.status },
      });
    }
    const envelope = (await response.json()) as BinanceApiEnvelope<T>;
    if (envelope.status !== 'SUCCESS' || envelope.data === undefined) {
      this.logger.warn(
        `Binance Pay ${path} thất bại: ${envelope.code ?? ''} ${envelope.errorMessage ?? ''}`,
      );
      throw new BadGatewayException(
        envelope.errorMessage || K.binanceRejected,
      );
    }
    return envelope.data;
  }

  /** Tạo phiên thanh toán — POST /binancepay/openapi/v3/order. */
  async createOrder(
    input: BinanceCreateOrderInput,
  ): Promise<BinanceCreateOrderResult> {
    const body = {
      env: { terminalType: 'WEB' },
      merchantTradeNo: input.merchantTradeNo,
      orderAmount: input.orderAmount,
      currency: input.currency,
      description: input.description,
      goodsDetails: input.goods.map((g) => ({
        goodsType: '02',
        goodsCategory: 'Z000',
        referenceGoodsId: g.productId,
        goodsName: g.name,
        goodsUnitAmount: { currency: input.currency, amount: g.unitPrice },
      })),
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      webhookUrl: input.webhookUrl,
      orderExpireTime: input.orderExpireTime,
    };
    return this.request<BinanceCreateOrderResult>(
      '/binancepay/openapi/v3/order',
      body,
    );
  }

  /**
   * Truy vấn trạng thái đơn — POST /binancepay/openapi/v2/order/query.
   * Trả về `data.status` (PAID / CANCELED / EXPIRED / INITIAL / PENDING…).
   */
  async queryOrderStatus(merchantTradeNo: string): Promise<string> {
    const data = await this.request<{ status?: string }>(
      '/binancepay/openapi/v2/order/query',
      { merchantTradeNo },
    );
    return data.status ?? '';
  }

  /**
   * Xác minh chữ ký webhook: payload = timestamp + "\n" + nonce + "\n" + rawBody + "\n",
   * chữ ký RSA-SHA256 (base64) với public key lấy từ endpoint certificates (cache).
   */
  async verifyWebhookSignature(
    timestamp: string,
    nonce: string,
    rawBody: string,
    signatureBase64: string,
  ): Promise<boolean> {
    const publicKey = await this.getCertPublic();
    const payload = `${timestamp}\n${nonce}\n${rawBody}\n`;
    const verifier = createVerify('RSA-SHA256');
    verifier.update(payload);
    verifier.end();
    return verifier.verify(publicKey, signatureBase64, 'base64');
  }

  private async getCertPublic(): Promise<string> {
    if (this.cachedCertPublic) return this.cachedCertPublic;
    const certificates = await this.request<BinanceCertificate[]>(
      '/binancepay/openapi/certificates',
      {},
    );
    const certPublic = certificates?.[0]?.certPublic;
    if (!certPublic) {
      throw new BadGatewayException(
        K.binanceCertFailed,
      );
    }
    this.cachedCertPublic = toPem(certPublic);
    return this.cachedCertPublic;
  }
}

/** Bọc key base64 thô vào định dạng PEM nếu cần. */
function toPem(certPublic: string): string {
  if (certPublic.includes('BEGIN PUBLIC KEY')) return certPublic;
  const chunks = certPublic.replace(/\s+/g, '').match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${chunks.join('\n')}\n-----END PUBLIC KEY-----`;
}
