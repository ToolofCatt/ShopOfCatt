import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Nguồn được phép gọi từ trình duyệt. Trang web gọi API bằng fetch nên
 * connect-src phải chứa cả API cùng miền lẫn cấu hình 2 cổng khi chạy dev.
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const apiOrigin = apiUrl.startsWith('http') ? new URL(apiUrl).origin : '';

/**
 * CSP đủ chặt để một đoạn script lạ không chạy được, nhưng vẫn cho Next.js
 * hoạt động. `'unsafe-inline'` cho style là bắt buộc với Tailwind + Next;
 * `'unsafe-inline'`/`'unsafe-eval'` cho script chỉ bật ở chế độ dev
 * (React Refresh cần eval), production thì bỏ.
 */
const isDev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
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

const nextConfig: NextConfig = {
  // Xuất bản dạng standalone để image Docker chỉ chứa đúng thứ cần chạy
  output: 'standalone',
  // Monorepo: trace file từ thư mục gốc để gom cả packages/shared
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@webcatt/shared'],
  images: {
    unoptimized: true,
  },
  // Không quảng cáo đang chạy Next.js phiên bản nào
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          // HSTS chỉ có tác dụng qua HTTPS; trình duyệt bỏ qua khi chạy HTTP.
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
