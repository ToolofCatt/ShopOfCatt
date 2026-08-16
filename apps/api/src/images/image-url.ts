/**
 * Dựng địa chỉ ảnh sản phẩm.
 *
 * Vì sao ảnh không còn nhúng thẳng vào JSON: data URI base64 xuất hiện HAI lần
 * trong HTML của trang chi tiết (một lần ở markup, một lần trong gói dữ liệu
 * Next dùng để hydrate). Đo trên máy chủ: 21.345 ký tự ảnh làm trang nặng thêm
 * đúng 42.690 byte. Với ảnh thật ~100 KB thì một trang ba ảnh là ~850 KB mỗi
 * lần mở, và không cache được vì trang render động.
 */

/** Bỏ dấu `/` thừa ở cuối để nối chuỗi không sinh ra `//`. */
function apiBase(): string {
  return (process.env.API_PUBLIC_URL ?? '').replace(/\/+$/, '');
}

export type ProductImageKind = 'cover' | 'thumbnail';

/**
 * Ảnh bìa và ảnh nhỏ nằm ở cột của `Product` nên địa chỉ không đổi khi chủ shop
 * thay ảnh — phải kèm tham số phiên bản, nếu không trình duyệt đã cache sẽ hiện
 * mãi ảnh cũ. Dùng `updatedAt` vì đổi ảnh là đổi luôn mốc này, và đọc được nó
 * không cần chạm tới cột base64.
 */
export function productImageUrl(
  productId: string,
  kind: ProductImageKind,
  updatedAt: Date,
): string {
  return `${apiBase()}/api/images/product/${productId}/${kind}?v=${updatedAt.getTime()}`;
}

/**
 * Ảnh phụ không cần tham số phiên bản: mỗi dòng `ProductImage` là bất biến —
 * sửa ảnh nghĩa là xoá dòng cũ và thêm dòng mới với id khác.
 */
export function galleryImageUrl(imageId: string): string {
  return `${apiBase()}/api/images/gallery/${imageId}`;
}
