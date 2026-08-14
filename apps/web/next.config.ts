import path from 'node:path';
import type { NextConfig } from 'next';

/*
 * CSP KHÔNG nằm ở đây nữa — nó ở `middleware.ts`, vì nonce phải sinh theo từng
 * request và headers() ở file này là hằng số. Đừng thêm lại: hai header CSP cùng
 * lúc là trình duyệt lấy phần giao của hai bên và trang sẽ trắng.
 */

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
