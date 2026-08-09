import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { BinanceKeyPermissions, BinanceStatusDto } from '@webcatt/shared';
import type { BinanceDeposit } from './deposit-matcher';

const DEFAULT_BASE = 'https://api.binance.com';
const RECV_WINDOW = '10000';

interface RawDeposit {
  amount?: string;
  coin?: string;
  network?: string;
  status?: number;
  txId?: string;
  insertTime?: number;
}

interface RawAccount {
  balances?: Array<{ asset: string; free: string; locked: string }>;
}

/**
 * `/sapi/v1/account/apiRestrictions` — quyền THẬT của khóa API.
 * Đừng nhầm với `canWithdraw` của `/api/v3/account`: trường đó nói tài khoản
 * có được phép rút hay không, KHÔNG phải khóa này có quyền rút hay không.
 */
interface RawApiRestrictions {
  enableReading?: boolean;
  enableWithdrawals?: boolean;
  enableSpotAndMarginTrading?: boolean;
  ipRestrict?: boolean;
}

/**
 * Đọc dữ liệu tài khoản Binance (tài khoản thường, không phải Binance Pay Merchant):
 * số dư USDT và lịch sử nạp on-chain. CHỈ dùng quyền đọc — không có hàm rút/giao dịch.
 * Ký request bằng HMAC-SHA512? Không — Binance dùng HMAC-SHA256 cho REST API.
 */
@Injectable()
export class BinanceExchangeService {
  private readonly logger = new Logger(BinanceExchangeService.name);
  private readonly apiKey: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = (config.get<string>('BINANCE_API_KEY') ?? '').trim();
    this.secret = (config.get<string>('BINANCE_SECRET_KEY') ?? '').trim();
    this.baseUrl = (
      config.get<string>('BINANCE_API_BASE_URL') ?? DEFAULT_BASE
    ).trim();
  }

  get isConfigured(): boolean {
    return this.apiKey !== '' && this.secret !== '';
  }

  /** Gọi GET có chữ ký. Ném lỗi kèm thông báo của Binance khi không phải 200. */
  private async signedGet<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const query = new URLSearchParams({
      ...params,
      recvWindow: RECV_WINDOW,
      timestamp: Date.now().toString(),
    }).toString();
    const signature = createHmac('sha256', this.secret)
      .update(query)
      .digest('hex');
    const url = `${this.baseUrl}${path}?${query}&signature=${signature}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-MBX-APIKEY': this.apiKey },
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const body = JSON.parse(text) as { msg?: string; code?: number };
        detail = body.msg ? `${body.msg} (code ${body.code ?? '?'})` : text;
      } catch {
        // giữ nguyên text
      }
      throw new Error(`Binance ${path} HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }
    return JSON.parse(text) as T;
  }

  /** Quyền thật của khóa API. null nếu không đọc được (không ném). */
  private async readKeyPermissions(): Promise<BinanceKeyPermissions | null> {
    try {
      const raw = await this.signedGet<RawApiRestrictions>(
        '/sapi/v1/account/apiRestrictions',
      );
      return {
        read: raw.enableReading === true,
        withdraw: raw.enableWithdrawals === true,
        trade: raw.enableSpotAndMarginTrading === true,
        ipRestricted: raw.ipRestrict === true,
      };
    } catch (error) {
      this.logger.warn(
        `Không đọc được quyền của khóa Binance: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** Trạng thái kết nối + số dư USDT + quyền của khóa. Không bao giờ ném. */
  async getStatus(): Promise<BinanceStatusDto> {
    if (!this.isConfigured) {
      return {
        configured: false,
        connected: null,
        usdtBalance: null,
        permissions: null,
        error: null,
      };
    }
    try {
      const account = await this.signedGet<RawAccount>('/api/v3/account');
      const usdt = (account.balances ?? []).find((b) => b.asset === 'USDT');
      const balance = usdt ? Number(usdt.free) + Number(usdt.locked) : 0;
      return {
        configured: true,
        connected: true,
        usdtBalance: Number.isFinite(balance) ? balance : 0,
        permissions: await this.readKeyPermissions(),
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Không đọc được tài khoản Binance: ${message}`);
      return {
        configured: true,
        connected: false,
        usdtBalance: null,
        permissions: null,
        error: message,
      };
    }
  }

  /** Số dư USDT khả dụng (free). Ném khi lỗi. */
  async getUsdtFreeBalance(): Promise<number> {
    const account = await this.signedGet<RawAccount>('/api/v3/account');
    const usdt = (account.balances ?? []).find((b) => b.asset === 'USDT');
    return usdt ? Number(usdt.free) : 0;
  }

  /**
   * Lịch sử nạp USDT kể từ `startTimeMs`. Trả về danh sách đã chuẩn hoá kiểu số.
   * Binance chỉ trả tối đa 90 ngày / 1000 bản ghi mỗi lần — quá đủ cho việc đối soát.
   */
  async listUsdtDeposits(startTimeMs?: number): Promise<BinanceDeposit[]> {
    const params: Record<string, string> = { coin: 'USDT', limit: '1000' };
    if (startTimeMs) params.startTime = String(startTimeMs);
    const rows = await this.signedGet<RawDeposit[]>(
      '/sapi/v1/capital/deposit/hisrec',
      params,
    );
    return (Array.isArray(rows) ? rows : [])
      .filter((r) => typeof r.txId === 'string' && r.txId !== '')
      .map((r) => ({
        txId: r.txId as string,
        network: r.network ?? '',
        amount: Number(r.amount ?? 0),
        insertTimeMs: r.insertTime ?? 0,
        status: r.status ?? 0,
      }));
  }

  /** Tìm một giao dịch nạp theo TxID (khách nhập tay). null nếu chưa thấy. */
  async findDepositByTxId(txId: string): Promise<BinanceDeposit | null> {
    const wanted = txId.trim().toLowerCase();
    const deposits = await this.listUsdtDeposits();
    return (
      deposits.find((d) => d.txId.toLowerCase() === wanted) ?? null
    );
  }
}
