import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Tỉ giá USD → VND / CNY, lấy mỗi ngày từ một nguồn công khai.
 *
 * Vì sao cần: giá bán ghi bằng USDT, nhưng ngân hàng thu VND và khách Trung Quốc
 * muốn thấy CNY. Nhập tay thì tỉ giá cũ dần mà không ai để ý.
 *
 * Nguyên tắc: KHÔNG BAO GIỜ làm xấu đi tỉ giá đang dùng. Nguồn lỗi, trả rác, hay
 * trả số vô lý thì giữ nguyên giá trị cũ — vì `vndPerUsdt` vừa dùng để HIỆN giá
 * vừa dùng để dựng SỐ TIỀN CHUYỂN KHOẢN, ghi một số sai vào đó là khách chuyển
 * sai tiền hàng loạt.
 */

const NGUON = 'https://open.er-api.com/v6/latest/USD';
const TIMEOUT_MS = 15_000;
/** Lấy lại mỗi 24 giờ. */
const CHU_KY_MS = 24 * 60 * 60_000;
/** Chờ một chút sau khi khởi động rồi mới gọi ra ngoài. */
const CHO_KHOI_DONG_MS = 20_000;

/*
 * Khoảng hợp lệ — hàng rào chống "một con số vô lý đi thẳng vào giá bán".
 *
 * Không phải để đoán tỉ giá đúng, mà để bắt những sai lệch cỡ lớn: nguồn đổi
 * đơn vị, trả về 1, trả về số nhân thêm ba số 0, hay ta gọi sai base currency.
 * Biên rất rộng nên biến động thị trường bình thường không bao giờ đụng tới.
 */
const VND_MIN = 5_000;
const VND_MAX = 100_000;
const CNY_MIN = 3;
const CNY_MAX = 20;

export interface RateFetchResult {
  ok: boolean;
  /** Giá trị THÔ từ nguồn, chưa cộng biên. */
  rawVnd?: number;
  rawCny?: number;
  /** Giá trị đã cộng biên và đã ghi vào cấu hình. */
  vndPerUsdt?: number;
  cnyPerUsdt?: number;
  reason?: string;
}

@Injectable()
export class ExchangeRateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExchangeRateService.name);
  private timer: NodeJS.Timeout | null = null;
  private khoiDong: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    /*
     * Hẹn giờ bằng setInterval, giống CryptoReconcileService — repo không dùng
     * @nestjs/schedule và không đáng thêm một phụ thuộc chỉ cho một việc này.
     *
     * Vòng lặp luôn chạy, nhưng bên trong tự kiểm công tắc `rateAuto`: chủ shop
     * bật/tắt trong cài đặt là có hiệu lực ngay, không phải dựng lại máy chủ.
     */
    this.khoiDong = setTimeout(() => {
      void this.refreshIfDue();
    }, CHO_KHOI_DONG_MS);

    this.timer = setInterval(
      () => {
        void this.refreshIfDue();
      },
      // Kiểm mỗi giờ thay vì mỗi 24 giờ: máy chủ dựng lại thường xuyên hơn thế,
      // và nếu chỉ hẹn 24 giờ thì mỗi lần dựng lại là đồng hồ về 0.
      60 * 60_000,
    );
    this.logger.log('Tự cập nhật tỉ giá: kiểm mỗi giờ, lấy lại mỗi 24 giờ');
  }

  onModuleDestroy(): void {
    if (this.khoiDong) clearTimeout(this.khoiDong);
    if (this.timer) clearInterval(this.timer);
  }

  /** Chỉ lấy lại khi đang bật tự động VÀ lần gần nhất đã quá 24 giờ. */
  private async refreshIfDue(): Promise<void> {
    try {
      const setting = await this.settings.getSetting();
      if (!setting.rateAuto) return;
      const lanCuoi = setting.rateUpdatedAt?.getTime() ?? 0;
      if (Date.now() - lanCuoi < CHU_KY_MS) return;
      await this.refresh();
    } catch (error) {
      this.logger.warn(`Không kiểm được tỉ giá: ${moTaLoi(error)}`);
    }
  }

  /**
   * Lấy tỉ giá và ghi vào cấu hình. Gọi được cả từ nút bấm trong trang quản trị.
   *
   * Cộng biên cho CẢ VND và CNY để giá quy đổi ở mọi ngôn ngữ tương đương nhau —
   * lệch nhau là cùng một sản phẩm có hai giá tuỳ ngôn ngữ khách chọn.
   */
  async refresh(): Promise<RateFetchResult> {
    const setting = await this.settings.getSetting();
    const bien = Number(setting.rateMarkupPercent);

    let tho: { vnd: number; cny: number };
    try {
      tho = await layTiGia();
    } catch (error) {
      const reason = moTaLoi(error);
      this.logger.warn(`Lấy tỉ giá thất bại, GIỮ tỉ giá cũ: ${reason}`);
      return { ok: false, reason };
    }

    if (!trongKhoang(tho.vnd, VND_MIN, VND_MAX)) {
      const reason = `VND ngoài khoảng hợp lệ: ${tho.vnd}`;
      this.logger.error(`${reason} — GIỮ tỉ giá cũ`);
      return { ok: false, reason, rawVnd: tho.vnd, rawCny: tho.cny };
    }
    if (!trongKhoang(tho.cny, CNY_MIN, CNY_MAX)) {
      const reason = `CNY ngoài khoảng hợp lệ: ${tho.cny}`;
      this.logger.error(`${reason} — GIỮ tỉ giá cũ`);
      return { ok: false, reason, rawVnd: tho.vnd, rawCny: tho.cny };
    }

    const heSo = 1 + bien / 100;
    const vnd = round(tho.vnd * heSo, 2);
    const cny = round(tho.cny * heSo, 4);

    await this.prisma.storeSetting.update({
      where: { id: setting.id },
      data: {
        vndPerUsdt: new Prisma.Decimal(vnd.toFixed(2)),
        cnyPerUsdt: new Prisma.Decimal(cny.toFixed(4)),
        rateUpdatedAt: new Date(),
        rateSource: `open.er-api.com — VND ${tho.vnd}, CNY ${tho.cny}, biên ${bien}%`,
      },
    });
    this.logger.log(
      `Tỉ giá mới: 1 USDT = ${vnd} VND / ${cny} CNY (thô ${tho.vnd} / ${tho.cny}, biên ${bien}%)`,
    );
    return { ok: true, rawVnd: tho.vnd, rawCny: tho.cny, vndPerUsdt: vnd, cnyPerUsdt: cny };
  }
}

/** Hình dạng tối thiểu của phản hồi mà mã này thực sự đọc. */
interface ErApiResponse {
  result?: string;
  rates?: Record<string, unknown>;
}

async function layTiGia(): Promise<{ vnd: number; cny: number }> {
  // `fetch` trần không tự có hạn chờ — thiếu dòng này là nguồn treo thì vòng lặp
  // hẹn giờ cũng treo theo.
  const res = await fetch(NGUON, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as ErApiResponse;
  if (data.result !== undefined && data.result !== 'success') {
    throw new Error(`nguồn báo result=${data.result}`);
  }
  const vnd = Number(data.rates?.VND);
  const cny = Number(data.rates?.CNY);
  if (!Number.isFinite(vnd) || !Number.isFinite(cny)) {
    throw new Error('phản hồi thiếu VND hoặc CNY');
  }
  return { vnd, cny };
}

function trongKhoang(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function moTaLoi(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
