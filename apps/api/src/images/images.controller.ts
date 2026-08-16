import { BadRequestException, Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ImagesService, type ImagePayload } from './images.service';
import { K } from '../i18n/messages';
import type { ProductImageKind } from './image-url';

/**
 * Phục vụ ảnh sản phẩm dưới dạng nhị phân.
 *
 * Endpoint CÔNG KHAI, không guard: ảnh sản phẩm vốn hiện cho mọi khách xem, và
 * ép đăng nhập ở đây thì thẻ <img> không gửi được token.
 *
 * `@Res()` không passthrough vì phải tự ghi buffer và tự chuyển hướng. Ngoại lệ
 * ném ra TRƯỚC khi chạm tới `res` nên bộ lọc i18n vẫn xử lý bình thường.
 */
@Controller('images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  private send(payload: ImagePayload, request: Request, response: Response): void {
    if (payload.kind === 'redirect') {
      // Giá trị cũ do chủ shop dán URL ngoài vào — vẫn cho hiện, nhưng không
      // cache lâu vì máy chủ không kiểm soát được nội dung đầu kia.
      response.setHeader('Cache-Control', 'public, max-age=300');
      response.redirect(302, payload.url);
      return;
    }

    /*
     * `immutable` an toàn vì địa chỉ đã gắn phiên bản: ảnh bìa kèm ?v=updatedAt,
     * ảnh phụ thì mỗi id là một nội dung bất biến. Đổi ảnh là đổi địa chỉ.
     */
    response.setHeader('Content-Type', payload.mime);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('ETag', payload.etag);
    // Ảnh do chủ shop tải lên; đừng để trình duyệt tự đoán kiểu tệp.
    response.setHeader('X-Content-Type-Options', 'nosniff');

    if (request.headers['if-none-match'] === payload.etag) {
      response.status(304).end();
      return;
    }
    response.setHeader('Content-Length', String(payload.body.length));
    response.end(payload.body);
  }

  @Get('product/:productId/:kind')
  async productImage(
    @Param('productId') productId: string,
    @Param('kind') kind: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (kind !== 'cover' && kind !== 'thumbnail') {
      throw new BadRequestException(K.adminImageNotFound);
    }
    const payload = await this.images.getProductImage(
      productId,
      kind as ProductImageKind,
    );
    this.send(payload, request, response);
  }

  @Get('gallery/:id')
  async galleryImage(
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.send(await this.images.getGalleryImage(id), request, response);
  }
}
