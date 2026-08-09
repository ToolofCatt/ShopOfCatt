import { randomInt } from 'node:crypto';

/**
 * Mã khách hàng ngẫu nhiên 8 chữ số (10000000–99999999) — không lộ số lượng
 * hay tốc độ tăng trưởng khách hàng như mã tự tăng.
 *
 * LƯU Ý: `prisma/seed.ts` dùng lại đúng thuật toán này (bản sao cục bộ) vì
 * seed được biên dịch riêng (`tsc prisma/seed.ts`) và không import được từ src/.
 */
export const CUSTOMER_CODE_MIN = 10_000_000;
export const CUSTOMER_CODE_MAX_EXCLUSIVE = 100_000_000;

export function randomCustomerCode(): number {
  return randomInt(CUSTOMER_CODE_MIN, CUSTOMER_CODE_MAX_EXCLUSIVE);
}

/**
 * Sinh mã khách hàng duy nhất: thử ngẫu nhiên, kiểm tra trùng qua callback
 * (truy vấn DB), thử lại tối đa `maxAttempts` lần.
 */
export async function generateUniqueCustomerCode(
  isTaken: (code: number) => Promise<boolean>,
  maxAttempts = 20,
): Promise<number> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = randomCustomerCode();
    if (!(await isTaken(code))) return code;
  }
  throw new Error(
    'Không tìm được mã khách hàng trống sau nhiều lần thử — vui lòng thử lại',
  );
}
