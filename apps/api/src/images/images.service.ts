import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { K } from '../i18n/messages';
import type { ProductImageKind } from './image-url';

/** Ảnh đã sẵn sàng gửi đi, hoặc một địa chỉ ngoài cần chuyển hướng tới. */
export type ImagePayload =
  | { kind: 'binary'; mime: string; body: Buffer; etag: string }
  | { kind: 'redirect'; url: string };

/** Kiểu ảnh cho phép — chặn ở đây để không ai gửi mime lạ vào Content-Type. */
const ALLOWED_MIME = new Set([
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/avif',
]);

/**
 * Tách data URI `data:image/webp;base64,XXXX` thành mime + dữ liệu.
 *
 * Trả `null` khi chuỗi không phải data URI — cột này từng nhận cả URL ngoài do
 * chủ shop dán vào (ô nhập cũ là `type="url"`), nên vẫn phải lường trước.
 */
function parseDataUri(value: string): { mime: string; body: Buffer } | null {
  if (!value.startsWith('data:')) return null;
  const comma = value.indexOf(',');
  if (comma === -1) return null;
  const header = value.slice(5, comma);
  if (!header.endsWith(';base64')) return null;
  const mime = header.slice(0, -';base64'.length).toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return null;
  return { mime, body: Buffer.from(value.slice(comma + 1), 'base64') };
}

@Injectable()
export class ImagesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `etag` dựng từ id + độ dài dữ liệu. Không băm nội dung: ảnh tới vài trăm KB
   * và endpoint này chạy ở mọi lượt xem trang, băm mỗi lần là phí CPU vô ích —
   * id và độ dài đã đủ để phân biệt hai ảnh khác nhau ở cùng một vị trí.
   */
  private toPayload(id: string, value: string): ImagePayload {
    const parsed = parseDataUri(value);
    if (parsed) {
      return {
        kind: 'binary',
        mime: parsed.mime,
        body: parsed.body,
        etag: `"${id}-${parsed.body.length}"`,
      };
    }
    if (/^https?:\/\//i.test(value)) {
      return { kind: 'redirect', url: value };
    }
    throw new NotFoundException(K.adminImageNotFound);
  }

  async getProductImage(
    productId: string,
    kind: ProductImageKind,
  ): Promise<ImagePayload> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: kind === 'cover' ? { image: true } : { thumbnail: true },
    });
    const value = product
      ? kind === 'cover'
        ? (product as { image: string | null }).image
        : (product as { thumbnail: string | null }).thumbnail
      : null;
    if (!value) {
      throw new NotFoundException(K.adminImageNotFound);
    }
    return this.toPayload(`${productId}-${kind}`, value);
  }

  async getGalleryImage(imageId: string): Promise<ImagePayload> {
    const image = await this.prisma.productImage.findUnique({
      where: { id: imageId },
      select: { data: true },
    });
    if (!image) {
      throw new NotFoundException(K.adminImageNotFound);
    }
    return this.toPayload(imageId, image.data);
  }
}
