/**
 * Thin fetch wrapper for talking to the @webcatt/api backend.
 * Works in both server components (API_URL) and the browser (NEXT_PUBLIC_API_URL).
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
  /** Ngôn ngữ cho thông báo lỗi từ API. Trình duyệt tự lấy từ cookie nếu bỏ trống. */
  locale?: string | null;
}

const LOCALE_COOKIE = 'wc_locale';

/** Đọc ngôn ngữ đang chọn từ cookie (chỉ chạy được ở trình duyệt). */
function localeFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export const CONNECTION_ERROR_MESSAGE = 'Không kết nối được máy chủ. Vui lòng thử lại.';

/**
 * Thông báo lỗi hiển thị cho người dùng.
 * API đã trả lỗi theo đúng ngôn ngữ (qua header Accept-Language); riêng lỗi
 * mạng (status 0) thì dùng chuỗi đã dịch sẵn ở phía web.
 */
export function apiErrorMessage(err: unknown, connectionFallback: string): string {
  if (err instanceof ApiError && err.status !== 0) return err.message;
  return connectionFallback;
}

function resolveBaseUrl(): string {
  if (typeof window === 'undefined') {
    return process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
}

function extractMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message) && message.length > 0) return message.map(String).join(', ');
  }
  return fallback;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method, body, token } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const locale = options.locale ?? localeFromCookie();
  if (locale) headers['Accept-Language'] = locale;

  let response: Response;
  try {
    response = await fetch(`${resolveBaseUrl()}${path}`, {
      method: method ?? (body !== undefined ? 'POST' : 'GET'),
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(CONNECTION_ERROR_MESSAGE, 0);
  }

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // non-JSON error body — keep fallback message
    }
    throw new ApiError(extractMessage(payload, `Đã xảy ra lỗi (mã ${response.status})`), response.status);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
