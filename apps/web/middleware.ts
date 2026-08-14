import { NextResponse, type NextRequest } from 'next/server';

/**
 * Content-Security-Policy sinh theo TỪNG REQUEST để dùng nonce.
 *
 * Trước đây CSP nằm trong `next.config.ts` headers(), nên nó là hằng số và buộc
 * phải mở `script-src 'unsafe-inline'` cho Next.js chạy được các script nội tuyến
 * của nó. Mở như vậy thì CSP hết tác dụng chống XSS: chỉ cần một đoạn HTML do
 * admin soạn lọt qua `sanitize-html` là script chèn vào chạy được, và nó đọc
 * được token quản trị trong localStorage.
 *
 * Nonce chỉ tồn tại được nếu sinh mỗi lần trả trang → phải nằm ở middleware.
 * Next.js tự đọc nonce từ header `Content-Security-Policy` của REQUEST rồi gắn
 * vào các thẻ <script> của nó, nên phải set header đó lên cả request lẫn response.
 *
 * CHÚ Ý: đừng thêm CSP lại vào next.config.ts. Hai header CSP cùng lúc là trình
 * duyệt lấy phần GIAO của hai bên, và trang sẽ trắng.
 */

const isDev = process.env.NODE_ENV !== 'production';

/** Nguồn API để trong connect-src — web gọi API bằng fetch từ trình duyệt. */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const apiOrigin = apiUrl.startsWith('http') ? new URL(apiUrl).origin : '';

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    /*
     * Production: chỉ script mang đúng nonce của lần trả trang này mới chạy.
     * `strict-dynamic` cho phép các script đã được tin cậy tự nạp thêm chunk của
     * Next; đổi lại trình duyệt hiện đại bỏ qua 'self' cho script — đó là chủ ý.
     *
     * Dev: React Refresh cần eval và script nội tuyến không nonce, nên giữ lỏng.
     * Chênh lệch này là lý do phải kiểm CSP bằng bản BUILD, không phải bằng dev.
     */
    isDev
      ? `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Tailwind + Next chèn style nội tuyến và không nhận nonce cho style →
    // 'unsafe-inline' ở đây là bắt buộc. Style nội tuyến không chạy được mã.
    "style-src 'self' 'unsafe-inline'",
    // Ảnh sản phẩm có thể là URL ngoài do admin nhập
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
    // QR Binance Pay / VietQR hiển thị bằng <img>, không nhúng iframe
    "frame-src 'none'",
    // Không cho trang khác nhúng trang quản trị vào iframe (chống clickjacking)
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function middleware(request: NextRequest): NextResponse {
  // crypto.randomUUID có sẵn trong Edge runtime; không dùng Math.random cho nonce.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js đọc nonce từ CHÍNH header này để gắn vào <script> của nó.
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  /*
   * Bỏ qua tài nguyên tĩnh và các route metadata. Hai lý do: sinh nonce cho từng
   * file ảnh là vô ích, và quan trọng hơn — có nonce là Next phải render động,
   * nên robots.txt/sitemap.xml sẽ mất khả năng dựng sẵn và cache.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|robots.txt|sitemap.xml|logo.*\\.png).*)',
  ],
};
