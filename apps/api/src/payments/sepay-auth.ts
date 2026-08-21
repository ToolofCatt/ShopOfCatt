import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Xác thực webhook SePay.
 *
 * Hàm THUẦN để test được mọi nhánh. Đây là cửa duy nhất giữa Internet và việc
 * giao hàng miễn phí, nên không có nhánh nào được "cho qua khi thiếu dữ liệu".
 */

/** Chữ ký chỉ hợp lệ trong khoảng này quanh lúc SePay ký. */
export const SEPAY_MAX_SKEW_MS = 5 * 60_000;

export type SepayAuthResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'chua-cau-hinh-khoa'
        | 'thieu-khoa'
        | 'sai-khoa'
        | 'thieu-chu-ky'
        | 'chu-ky-qua-han'
        | 'sai-chu-ky';
    };

/**
 * So sánh hai chuỗi mà không để lộ thông tin qua thời gian chạy.
 *
 * `a === b` dừng ngay ở byte đầu khác nhau, nên đo thời gian nhiều lần là dò ra
 * được khoá từng ký tự. Độ dài khác nhau thì trả false luôn — độ dài không phải
 * bí mật, còn `timingSafeEqual` sẽ ném lỗi nếu hai buffer lệch cỡ.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** Tách khoá từ header `Authorization: Apikey <khoa>` (không phân biệt hoa thường). */
export function parseApikeyHeader(value: string): string | null {
  const m = /^\s*Apikey\s+(.+?)\s*$/i.exec(value);
  return m ? m[1] : null;
}

export interface SepayAuthInput {
  /** Giá trị header `Authorization`. */
  authorization: string;
  /** Giá trị header `X-SePay-Signature`, dạng `sha256=<hex>`. */
  signature?: string;
  /** Giá trị header `X-SePay-Timestamp`, giây Unix. */
  timestamp?: string;
  /**
   * Thân request ở dạng THÔ.
   *
   * Phải là bytes gốc: SePay ký trên đó, còn JSON đã parse rồi serialize lại thì
   * khác khoảng trắng và thứ tự khoá nên chữ ký không bao giờ khớp.
   */
  rawBody: string;
  /** Khoá API đã lưu trong cấu hình. Rỗng = chưa cấu hình. */
  apiKey: string;
  /** Khoá bí mật HMAC. Rỗng = không kiểm chữ ký. */
  webhookSecret: string;
  nowMs: number;
}

/**
 * Kiểm một webhook.
 *
 * Khoá API là BẮT BUỘC. Chữ ký HMAC chỉ được kiểm THÊM khi chủ shop đã lưu khoá
 * bí mật — không phải để thay thế. Chưa cấu hình khoá API thì từ chối sạch, vì
 * lúc đó không có gì để đối chiếu và bất kỳ ai cũng gọi được endpoint này.
 */
export function verifySepayWebhook(input: SepayAuthInput): SepayAuthResult {
  if (input.apiKey === '') {
    return { ok: false, reason: 'chua-cau-hinh-khoa' };
  }

  const guiLen = parseApikeyHeader(input.authorization);
  if (guiLen === null || guiLen === '') {
    return { ok: false, reason: 'thieu-khoa' };
  }
  if (!safeEqual(guiLen, input.apiKey)) {
    return { ok: false, reason: 'sai-khoa' };
  }

  if (input.webhookSecret === '') {
    return { ok: true };
  }

  const chuKy = (input.signature ?? '').trim();
  const moc = (input.timestamp ?? '').trim();
  if (chuKy === '' || moc === '') {
    return { ok: false, reason: 'thieu-chu-ky' };
  }

  const giay = Number.parseInt(moc, 10);
  if (
    !Number.isFinite(giay) ||
    Math.abs(input.nowMs - giay * 1000) > SEPAY_MAX_SKEW_MS
  ) {
    return { ok: false, reason: 'chu-ky-qua-han' };
  }

  const mongDoi =
    'sha256=' +
    createHmac('sha256', input.webhookSecret)
      .update(`${moc}.${input.rawBody}`)
      .digest('hex');
  if (!safeEqual(chuKy, mongDoi)) {
    return { ok: false, reason: 'sai-chu-ky' };
  }
  return { ok: true };
}
