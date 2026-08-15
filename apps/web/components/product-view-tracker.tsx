'use client';

import { useEffect } from 'react';
import { apiFetch } from '@/lib/api';

/**
 * Ghi một lượt xem trang sản phẩm.
 *
 * ĐẾM Ở PHÍA TRÌNH DUYỆT, không phải trong server component. Lý do:
 *
 * - Ở production, Next.js tải trước trang khi khách chỉ ĐƯA CHUỘT qua link sản
 *   phẩm. Đếm ở máy chủ nghĩa là mỗi lần rê chuột cũng thành một "lượt xem", và
 *   con số phồng lên tới mức vô nghĩa.
 * - Bot tìm kiếm quét trang liên tục nhưng không chạy JavaScript, nên cách này
 *   loại chúng ra mà không cần danh sách user-agent nào.
 *
 * `useEffect` chỉ chạy khi trang thật sự được hiển thị cho một người, nên nó tự
 * đúng ở cả hai điểm trên.
 */
export function ProductViewTracker({ productId }: { productId: string }) {
  useEffect(() => {
    // Đếm mỗi sản phẩm một lần trong một phiên: khách bấm quay lại rồi vào lại,
    // hoặc F5 vài lần, không nên thành vài lượt xem.
    const key = `wc:viewed:${productId}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, '1');
    } catch {
      // Trình duyệt chặn sessionStorage (chế độ riêng tư) → vẫn đếm, chỉ là có
      // thể đếm trùng. Thà số hơi cao còn hơn mất hẳn dữ liệu.
    }

    // Bắn rồi quên: thống kê hỏng tuyệt đối không được ảnh hưởng tới trang.
    void apiFetch('/analytics/product-view', {
      method: 'POST',
      body: { productId },
    }).catch(() => {});
  }, [productId]);

  return null;
}
