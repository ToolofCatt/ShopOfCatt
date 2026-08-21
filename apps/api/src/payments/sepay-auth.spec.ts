import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseApikeyHeader,
  safeEqual,
  verifySepayWebhook,
  type SepayAuthInput,
} from './sepay-auth';

/**
 * Đây là cửa duy nhất giữa Internet và việc giao hàng miễn phí, nên mỗi nhánh
 * từ chối phải có bài kiểm riêng — nhất là nhánh "chưa cấu hình khoá".
 */

/*
 * Khoá GIẢ, dài tương đương khoá thật của SePay.
 *
 * Không dùng khoá thật của cửa hàng ở đây: repo công khai, mà một chuỗi trong
 * test cũng bị chỉ mục và tìm ra được y như trong mã nguồn.
 */
const KHOA = 'khoa-sepay-gia-de-kiem-thu-0000000000000000';
const BI_MAT = 'bi-mat-hmac';
const BODY = '{"id":123,"transferAmount":92000}';
const NOW = 1_787_000_000_000;

function nhap(patch: Partial<SepayAuthInput> = {}): SepayAuthInput {
  return {
    authorization: `Apikey ${KHOA}`,
    rawBody: BODY,
    apiKey: KHOA,
    webhookSecret: '',
    nowMs: NOW,
    ...patch,
  };
}

function kyThat(timestampGiay: number, body = BODY, secret = BI_MAT): string {
  return (
    'sha256=' +
    createHmac('sha256', secret).update(`${timestampGiay}.${body}`).digest('hex')
  );
}

describe('parseApikeyHeader', () => {
  it('tách được khoá', () => {
    expect(parseApikeyHeader('Apikey abc123')).toBe('abc123');
  });

  it('không phân biệt hoa thường ở chữ "Apikey"', () => {
    expect(parseApikeyHeader('APIKEY abc123')).toBe('abc123');
    expect(parseApikeyHeader('apikey abc123')).toBe('abc123');
  });

  it('bỏ khoảng trắng thừa hai đầu', () => {
    expect(parseApikeyHeader('  Apikey   abc123  ')).toBe('abc123');
  });

  it('trả null với dạng khác', () => {
    expect(parseApikeyHeader('Bearer abc123')).toBeNull();
    expect(parseApikeyHeader('')).toBeNull();
    expect(parseApikeyHeader('Apikey')).toBeNull();
  });
});

describe('safeEqual', () => {
  it('bằng nhau thì true', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });

  it('khác nhau hoặc khác độ dài thì false, không ném lỗi', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });
});

describe('verifySepayWebhook — chỉ khoá API', () => {
  it('đúng khoá thì cho qua', () => {
    expect(verifySepayWebhook(nhap())).toEqual({ ok: true });
  });

  it('CHƯA cấu hình khoá thì từ chối sạch, không phải cho qua', () => {
    const kq = verifySepayWebhook(nhap({ apiKey: '' }));
    expect(kq).toEqual({ ok: false, reason: 'chua-cau-hinh-khoa' });
  });

  it('thiếu header Authorization thì từ chối', () => {
    expect(verifySepayWebhook(nhap({ authorization: '' }))).toEqual({
      ok: false,
      reason: 'thieu-khoa',
    });
  });

  it('sai khoá thì từ chối', () => {
    expect(verifySepayWebhook(nhap({ authorization: 'Apikey sai-be-bet' }))).toEqual({
      ok: false,
      reason: 'sai-khoa',
    });
  });

  it('khoá đúng nhưng thiếu một ký tự cũng từ chối', () => {
    expect(
      verifySepayWebhook(nhap({ authorization: `Apikey ${KHOA.slice(0, -1)}` })),
    ).toEqual({ ok: false, reason: 'sai-khoa' });
  });

  it('không lưu khoá bí mật thì KHÔNG đòi chữ ký', () => {
    expect(verifySepayWebhook(nhap({ signature: undefined }))).toEqual({ ok: true });
  });
});

describe('verifySepayWebhook — có thêm HMAC', () => {
  const giay = Math.floor(NOW / 1000);

  it('chữ ký đúng thì cho qua', () => {
    const kq = verifySepayWebhook(
      nhap({
        webhookSecret: BI_MAT,
        timestamp: String(giay),
        signature: kyThat(giay),
      }),
    );
    expect(kq).toEqual({ ok: true });
  });

  it('đã lưu khoá bí mật thì THIẾU chữ ký là từ chối', () => {
    expect(verifySepayWebhook(nhap({ webhookSecret: BI_MAT }))).toEqual({
      ok: false,
      reason: 'thieu-chu-ky',
    });
  });

  it('chữ ký quá hạn (hơn 5 phút) thì từ chối — chống phát lại', () => {
    const cu = giay - 6 * 60;
    expect(
      verifySepayWebhook(
        nhap({ webhookSecret: BI_MAT, timestamp: String(cu), signature: kyThat(cu) }),
      ),
    ).toEqual({ ok: false, reason: 'chu-ky-qua-han' });
  });

  it('mốc thời gian ở tương lai xa cũng từ chối', () => {
    const sau = giay + 6 * 60;
    expect(
      verifySepayWebhook(
        nhap({ webhookSecret: BI_MAT, timestamp: String(sau), signature: kyThat(sau) }),
      ),
    ).toEqual({ ok: false, reason: 'chu-ky-qua-han' });
  });

  it('mốc thời gian không phải số thì từ chối', () => {
    expect(
      verifySepayWebhook(
        nhap({ webhookSecret: BI_MAT, timestamp: 'hom-qua', signature: kyThat(giay) }),
      ),
    ).toEqual({ ok: false, reason: 'chu-ky-qua-han' });
  });

  it('chữ ký ký bằng khoá bí mật KHÁC thì từ chối', () => {
    expect(
      verifySepayWebhook(
        nhap({
          webhookSecret: BI_MAT,
          timestamp: String(giay),
          signature: kyThat(giay, BODY, 'bi-mat-khac'),
        }),
      ),
    ).toEqual({ ok: false, reason: 'sai-chu-ky' });
  });

  it('body bị sửa một byte thì chữ ký hỏng', () => {
    expect(
      verifySepayWebhook(
        nhap({
          webhookSecret: BI_MAT,
          timestamp: String(giay),
          signature: kyThat(giay),
          rawBody: BODY.replace('92000', '92001'),
        }),
      ),
    ).toEqual({ ok: false, reason: 'sai-chu-ky' });
  });

  it('sai khoá API thì dừng NGAY, không cần tới chữ ký', () => {
    expect(
      verifySepayWebhook(
        nhap({
          authorization: 'Apikey sai',
          webhookSecret: BI_MAT,
          timestamp: String(giay),
          signature: kyThat(giay),
        }),
      ),
    ).toEqual({ ok: false, reason: 'sai-khoa' });
  });
});
