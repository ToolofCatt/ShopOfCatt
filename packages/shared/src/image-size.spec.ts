import { describe, expect, it } from 'vitest';
import { PRODUCT_IMAGE_MAX_LENGTH } from './index';

/**
 * Mức chặn này bảo vệ bản sao lưu: ảnh nằm trong cột `Product.image` nên nó đi
 * theo mọi bản `pg_dump`, và 14 bản được giữ lại — mỗi KB ở đây tốn 14 KB dung
 * lượng lưu trữ. Nới nó ra là nới luôn kích thước mọi bản sao lưu về sau.
 */
describe('PRODUCT_IMAGE_MAX_LENGTH', () => {
  it('đủ chỗ cho một ảnh sản phẩm đã nén (~300 KB)', () => {
    // Base64 phình 4/3 so với dữ liệu gốc.
    const bytesAllowed = (PRODUCT_IMAGE_MAX_LENGTH * 3) / 4;
    expect(bytesAllowed).toBeGreaterThan(300 * 1024);
  });

  it('không vượt quá giới hạn thân request 2 MB của máy chủ', () => {
    // main.ts đặt useBodyParser('json', { limit: '2mb' }). Vượt mức đó thì ảnh
    // bị chặn ở tầng HTTP trước cả khi class-validator kịp báo lỗi tử tế.
    expect(PRODUCT_IMAGE_MAX_LENGTH).toBeLessThan(2 * 1024 * 1024);
  });
});
