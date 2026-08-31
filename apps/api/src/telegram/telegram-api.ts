/**
 * Client Bot API tối giản — fetch thuần, không thư viện.
 *
 * Vì sao không dùng grammy/telegraf: bot này chỉ cần getMe, getUpdates,
 * sendMessage/sendPhoto; một thư viện framework kéo theo webhook adapter,
 * middleware, session… là bề mặt phụ thuộc lớn cho một cửa hàng đang giữ key
 * trả tiền thật. Fetch thuần thì đọc được toàn bộ những gì đi ra ngoài.
 */

const API_BASE = 'https://api.telegram.org';

/** Người gửi trong một update. */
export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  /** Mã ngôn ngữ IETF của app khách ("vi", "en", "zh-hans"…) — có thể vắng. */
  language_code?: string;
  is_bot?: boolean;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
}

/** Cú bấm một nút inline. `message` là tin đang mang bàn phím — đủ
 *  message_id + chat để editMessageText sửa tại chỗ. */
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface TgInlineKeyboardButton {
  text: string;
  /** Tối đa 64 BYTE theo Bot API — xem encodeCallback ở catalog-view.ts. */
  callback_data: string;
}

/** Mảng hàng nút — mỗi hàng một mảng nút. */
export type TgInlineKeyboard = TgInlineKeyboardButton[][];

/**
 * Bàn phím CỐ ĐỊNH dưới ô nhập (khác inline: nút bấm sẽ GỬI text của nó thành
 * tin nhắn, không có callback_data — bot nhận diện bằng cách so text).
 */
export interface TgReplyKeyboard {
  keyboard: { text: string }[][];
  resize_keyboard: boolean;
  is_persistent: boolean;
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | null,
    description: string,
  ) {
    super(`${method}: ${code ?? '?'} ${description}`);
  }
}

/** Chỉ 401/404 mới chứng minh token không còn dùng được; `fetch failed`, timeout
 * hay 5xx là lỗi kết nối tạm thời và supervisor phải thử lại ở lượt sau. */
export function isTelegramTokenRejected(err: unknown): err is TelegramApiError {
  return err instanceof TelegramApiError && (err.code === 401 || err.code === 404);
}

/** Backoff cho long-poll: lỗi liên tiếp tăng 5s → 10s → 20s → 30s. */
export function telegramRetryDelayMs(consecutiveFailures: number): number {
  const failures = Math.max(1, Math.floor(consecutiveFailures));
  return Math.min(30_000, 5_000 * 2 ** Math.min(failures - 1, 3));
}

/**
 * Gọi một method Bot API. Ném `TelegramApiError` khi Telegram trả `ok: false`,
 * ném lỗi fetch thường khi rớt mạng — hai loại phân biệt được ở nơi gọi: lỗi
 * API (token sai, chat không tồn tại) thì đừng thử lại, lỗi mạng thì thử lại.
 */
export async function tgCall<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
  timeoutMs = 15_000,
  stopSignal?: AbortSignal,
): Promise<T> {
  // Ghép timeout với tín hiệu dừng của vòng long-poll: không có nó thì lúc tắt
  // app, một getUpdates đang treo 25 giây giữ event loop sống thêm chừng đó.
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = stopSignal ? AbortSignal.any([timeout, stopSignal]) : timeout;
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    signal,
  });
  const body = (await res.json()) as {
    ok: boolean;
    result?: T;
    error_code?: number;
    description?: string;
  };
  if (!body.ok) {
    throw new TelegramApiError(
      method,
      body.error_code ?? res.status,
      body.description ?? 'unknown',
    );
  }
  return body.result as T;
}

/**
 * Thử lại một lệnh Bot API CÓ TÍNH LẶP LẠI AN TOÀN như getMe,
 * answerCallbackQuery hoặc editMessageText. Không dùng cho sendMessage/sendPhoto:
 * request đầu có thể đã tới Telegram nhưng phản hồi rớt giữa đường, gửi lại sẽ
 * tạo hai tin giống nhau.
 */
export async function tgCallIdempotent<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
  timeoutMs = 15_000,
  stopSignal?: AbortSignal,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await tgCall<T>(token, method, payload, timeoutMs, stopSignal);
    } catch (err) {
      lastError = err;
      // Telegram đã trả lời rõ (400/401/429...) thì retry cùng payload không
      // chữa được gì. Chỉ retry lỗi mạng/timeout chưa biết request đã tới đâu.
      if (err instanceof TelegramApiError || stopSignal?.aborted || attempt === attempts) {
        throw err;
      }
      await delay(250 * attempt, stopSignal);
    }
  }
  throw lastError;
}

function delay(ms: number, stopSignal?: AbortSignal): Promise<void> {
  if (stopSignal?.aborted) return Promise.reject(stopSignal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(stopSignal?.reason);
    };
    const timer = setTimeout(() => {
      stopSignal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref?.();
    stopSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Gửi ảnh bằng cách UPLOAD BYTES thay vì đưa URL: Telegram tự tải URL ngoài
 * hay trượt ("400 failed to get HTTP URL content" với qr.sepay.vn) — mình tải
 * hộ rồi đẩy multipart là chắc ăn.
 */
export async function tgSendPhotoUpload(
  token: string,
  chatId: number,
  image: ArrayBuffer,
  caption: string,
  stopSignal?: AbortSignal,
): Promise<void> {
  const timeout = AbortSignal.timeout(30_000);
  const signal = stopSignal ? AbortSignal.any([timeout, stopSignal]) : timeout;
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption);
  form.append('parse_mode', 'HTML');
  form.append('photo', new Blob([image], { type: 'image/png' }), 'qr.png');
  const res = await fetch(`${API_BASE}/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
    signal,
  });
  const body = (await res.json()) as {
    ok: boolean;
    error_code?: number;
    description?: string;
  };
  if (!body.ok) {
    throw new TelegramApiError(
      'sendPhoto',
      body.error_code ?? res.status,
      body.description ?? 'unknown',
    );
  }
}

/** Tên hiển thị của người dùng Telegram — để lưu vào `User.telegramName`. */
export function tgDisplayName(user: TgUser | undefined): string {
  if (!user) return '';
  const name = [user.first_name, user.last_name]
    .filter((part) => part && part.trim() !== '')
    .join(' ')
    .trim();
  const username = user.username ? `@${user.username}` : '';
  if (name && username) return `${name} (${username})`;
  return name || username;
}
