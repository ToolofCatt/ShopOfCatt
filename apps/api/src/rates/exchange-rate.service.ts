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

export const NGUON = 'https://open.er-api.com/v6/latest/USD';
const TIMEOUT_MS = 15_000;
/** Chờ một chút sau khi khởi động rồi mới gọi ra ngoài. */
const CHO_KHOI_DONG_MS = 20_000;
/** Việt Nam là UTC+7 quanh năm, không có giờ mùa hè. */
const VN_OFFSET_MS = 7 * 3_600_000;

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
      // Kiểm mỗi giờ rồi tự đối chiếu với giờ hẹn: setInterval không biết
      // "7 giờ sáng là lúc nào", và máy chủ dựng lại thì mọi hẹn giờ dài đều mất.
      60 * 60_000,
    );
    this.logger.log(
      'Tự cập nhật tỉ giá: kiểm mỗi giờ, lấy đúng một lần mỗi ngày vào giờ đã hẹn',
    );
  }

  onModuleDestroy(): void {
    if (this.khoiDong) clearTimeout(this.khoiDong);
    if (this.timer) clearInterval(this.timer);
  }

  /** Chỉ lấy lại khi đang bật tự động VÀ đã tới giờ hẹn của hôm nay. */
  private async refreshIfDue(): Promise<void> {
    try {
      const setting = await this.settings.getSetting();
      if (!setting.rateAuto) return;
      if (
        !denGioLay(
          Date.now(),
          setting.rateHour,
          setting.rateUpdatedAt?.getTime() ?? null,
        )
      ) {
        return;
      }
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

/** Giờ Việt Nam (0–23) của một mốc thời gian. */
export function gioVietNam(nowMs: number): number {
  return new Date(nowMs + VN_OFFSET_MS).getUTCHours();
}

/** Ngày Việt Nam dạng "YYYY-MM-DD" — dùng để biết "đã lấy hôm nay chưa". */
export function ngayVietNam(ms: number): string {
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Đã tới lúc lấy tỉ giá chưa.
 *
 * Đúng MỘT lần mỗi ngày, vào giờ đã hẹn theo giờ Việt Nam. Tính giờ VN thẳng từ
 * UTC+7 chứ không dùng `getHours()`: `getHours()` phụ thuộc biến môi trường TZ
 * của tiến trình, mà container này còn không có tzdata — đổi cấu hình triển khai
 * là giờ cập nhật lệch đi mà không ai biết.
 *
 * `chuaLayLanNao` (lastMs = null) thì lấy NGAY, không chờ tới giờ hẹn: cửa hàng
 * vừa bật tính năng thì phải có tỉ giá ngay, chứ không để trống tới sáng mai.
 */
export function denGioLay(
  nowMs: number,
  rateHour: number,
  lastMs: number | null,
): boolean {
  if (lastMs === null) return true;
  if (ngayVietNam(lastMs) === ngayVietNam(nowMs)) return false;
  return gioVietNam(nowMs) >= clampGio(rateHour);
}

/** Giờ ngoài 0–23 (sửa tay dưới CSDL) quy về 7 thay vì sinh hành vi lạ. */
function clampGio(hour: number): number {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 7;
}
