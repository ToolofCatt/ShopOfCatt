import type { MetadataRoute } from 'next';
import type { ProductDto } from '@webcatt/shared';
import { apiFetch } from '@/lib/api';
import { SITE_URL } from './layout';

/** Sitemap dựng lại mỗi giờ — đủ tươi cho một cửa hàng, không đập vào API mỗi lượt bot ghé. */
export const revalidate = 3600;

/**
 * Chỉ liệt kê trang công khai: trang chủ + từng sản phẩm đang bán.
 * API lỗi thì vẫn trả về sitemap tối thiểu thay vì làm hỏng cả route.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
  ];

  try {
    const products = await apiFetch<ProductDto[]>('/products');
    for (const product of products) {
      entries.push({
        url: `${SITE_URL}/products/${product.slug}`,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.8,
      });
    }
  } catch {
    // Không gọi được API → sitemap chỉ có trang chủ, vẫn hợp lệ.
  }

  return entries;
}
