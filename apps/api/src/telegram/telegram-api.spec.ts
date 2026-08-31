import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isTelegramTokenRejected,
  TelegramApiError,
  tgCallIdempotent,
} from './telegram-api';

function telegramResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('tgCallIdempotent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('thử lại lỗi mạng rồi trả kết quả của lần thành công', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(telegramResponse({ ok: true, result: { message_id: 7 } }));
    vi.stubGlobal('fetch', fetchMock);

    const call = tgCallIdempotent<{ message_id: number }>(
      'token',
      'editMessageText',
      { text: 'moi' },
      15_000,
    );
    await vi.runAllTimersAsync();

    await expect(call).resolves.toEqual({ message_id: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('không lặp lại khi Telegram đã trả lỗi API rõ ràng', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        telegramResponse(
          { ok: false, error_code: 400, description: 'message is not modified' },
          400,
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      tgCallIdempotent('token', 'editMessageText', { text: 'cu' }),
    ).rejects.toBeInstanceOf(TelegramApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('isTelegramTokenRejected', () => {
  it('chỉ nhận 401/404, không gắn nhầm lỗi mạng thành token hỏng', () => {
    expect(isTelegramTokenRejected(new TelegramApiError('getMe', 401, 'Unauthorized'))).toBe(true);
    expect(isTelegramTokenRejected(new TelegramApiError('getMe', 404, 'Not Found'))).toBe(true);
    expect(isTelegramTokenRejected(new TelegramApiError('getMe', 500, 'Internal error'))).toBe(false);
    expect(isTelegramTokenRejected(new TypeError('fetch failed'))).toBe(false);
  });
});
