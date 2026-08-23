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

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number | null,
    description: string,
  ) {
    super(`${method}: ${code ?? '?'} ${description}`);
  }
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
