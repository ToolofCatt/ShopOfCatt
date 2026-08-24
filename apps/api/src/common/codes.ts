import { randomInt } from 'node:crypto';

/** Bảng chữ cái mã đơn — bỏ các ký tự dễ nhầm lẫn (I, O, 0, 1). */
export const ORDER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const ALPHANUMERIC =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomString(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

/** Mã đơn hàng: DH- + 6 ký tự ngẫu nhiên. */
export function generateOrderCode(): string {
  return `DH-${randomString(ORDER_CODE_ALPHABET, 6)}`;
}

/** Mã nạp tiền: NAP- + 6 ký tự — cùng bảng chữ với mã đơn, khác tiền tố để
 *  nội dung chuyển khoản không bao giờ khớp nhầm giữa nạp và mua. */
export function generateDepositCode(): string {
  return `NAP-${randomString(ORDER_CODE_ALPHABET, 6)}`;
}

/**
 * merchantTradeNo: mã đơn bỏ dấu gạch + 10 ký tự chữ-số ngẫu nhiên
 * (≤32 ký tự, chỉ gồm chữ và số).
 */
export function generateMerchantTradeNo(orderCode: string): string {
  return `${orderCode.replace(/-/g, '')}${randomString(ALPHANUMERIC, 10)}`;
}

/** Nonce chữ-số ngẫu nhiên (mặc định 32 ký tự — yêu cầu của Binance Pay). */
export function generateNonce(length = 32): string {
  return randomString(ALPHANUMERIC, length);
}

/** Ép giá trị query string về số nguyên dương, không hợp lệ → undefined. */
export function toPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}
