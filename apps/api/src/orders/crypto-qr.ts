import { create } from 'qrcode';

/**
 * Mã QR chứa ĐỊA CHỈ VÍ, xuất ra SVG dạng data URI.
 *
 * Vì sao chỉ mã hoá địa chỉ trần chứ không phải một URI thanh toán kèm số tiền:
 * chuẩn URI cho token (ERC-681 với BEP20, và TRC20 thì không có chuẩn nào) được
 * hỗ trợ rất chắp vá — ví quét không hiểu sẽ báo lỗi hoặc điền sai. Địa chỉ trần
 * thì mọi ví và app sàn đều quét được. Đổi lại, khách vẫn phải tự nhập số tiền,
 * nên giao diện phải nói rõ điều đó ngay cạnh mã.
 *
 * Xuất SVG chứ không PNG để nét ở mọi kích thước và nhẹ hơn (~1 KB). Ảnh SVG nạp
 * qua thẻ <img> không chạy được script, nên không mở thêm bề mặt tấn công nào.
 *
 * Dựng đồng bộ bằng `create()` (trả về ma trận điểm) thay vì `toDataURL()` bất
 * đồng bộ, để hàm map DTO không phải đổi thành async.
 */

/** Vùng trắng quanh mã, tính bằng số ô. Chuẩn khuyến nghị 4; 2 vẫn quét tốt và gọn hơn. */
const QUIET_ZONE = 2;

export function cryptoAddressQr(address: string | null | undefined): string | null {
  const value = address?.trim();
  if (!value) return null;

  try {
    const qr = create(value, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const data = qr.modules.data;

    // Mỗi ô đen là một ô vuông 1×1 trong hệ toạ độ của mã.
    const path: string[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (data[y * size + x]) path.push(`M${x} ${y}h1v1h-1z`);
      }
    }

    const total = size + QUIET_ZONE * 2;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
      `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
      `<path transform="translate(${QUIET_ZONE} ${QUIET_ZONE})" d="${path.join('')}" fill="#0a0a0a"/>` +
      `</svg>`;

    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  } catch {
    // Địa chỉ lạ quá dài không mã hoá nổi → thà không có QR còn hơn vỡ trang.
    return null;
  }
}
