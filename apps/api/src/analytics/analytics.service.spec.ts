import { describe, expect, it } from 'vitest';
import { AnalyticsService } from './analytics.service';

/**
 * Chuẩn hoá từ khoá quyết định bảng thống kê có dùng được hay không: không gộp
 * biến thể thì "Windows 11", "windows  11" và "WINDOWS 11 " thành ba dòng riêng,
 * và danh sách "khách tìm gì" vỡ vụn thành hàng trăm mẩu của cùng một ý.
 */
describe('AnalyticsService.normalizeTerm', () => {
  it('gộp các biến thể hoa thường và khoảng trắng về một dạng', () => {
    const expected = 'windows 11 pro';
    for (const raw of [
      'windows 11 pro',
      'Windows 11 Pro',
      '  WINDOWS   11   PRO  ',
      '\twindows\n11  pro ',
    ]) {
      expect(AnalyticsService.normalizeTerm(raw)).toBe(expected);
    }
  });

  it('bỏ qua chuỗi quá ngắn — khách mới gõ dở, chưa phải một lần tìm thật', () => {
    expect(AnalyticsService.normalizeTerm('a')).toBeNull();
    expect(AnalyticsService.normalizeTerm(' x ')).toBeNull();
    expect(AnalyticsService.normalizeTerm('')).toBeNull();
    expect(AnalyticsService.normalizeTerm('   ')).toBeNull();
  });

  it('nhận từ khoá đúng hai ký tự', () => {
    expect(AnalyticsService.normalizeTerm('ai')).toBe('ai');
  });

  it('cắt từ khoá quá dài — ô tìm kiếm là chỗ ai cũng dán cả đoạn văn vào', () => {
    const term = AnalyticsService.normalizeTerm('x'.repeat(500));
    expect(term).not.toBeNull();
    expect(term).toHaveLength(60);
  });

  it('giữ nguyên dấu tiếng Việt', () => {
    // Bỏ dấu ở đây thì chủ shop đọc thống kê không hiểu khách gõ gì.
    expect(AnalyticsService.normalizeTerm('Khoá học lập trình')).toBe(
      'khoá học lập trình',
    );
  });

  it('cắt độ dài TRƯỚC khi kiểm tối thiểu, không làm rơi từ khoá hợp lệ', () => {
    expect(AnalyticsService.normalizeTerm('  ab  ')).toBe('ab');
  });
});
