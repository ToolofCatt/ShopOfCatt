import type { MetadataRoute } from 'next';
import { SITE_URL } from './layout';

/**
 * Chỉ cho lập chỉ mục phần cửa hàng công khai. Trang quản trị, đơn hàng, thanh
 * toán và tài khoản chứa dữ liệu riêng tư — không được để lọt lên công cụ tìm
 * kiếm (mã đơn trong URL là đủ để đoán ra trang thanh toán).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/',
          '/orders',
          '/orders/',
          '/checkout/',
          '/account',
          '/account/',
          '/mock-pay/',
          '/login',
          '/register',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
