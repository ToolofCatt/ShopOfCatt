import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { ImagesService } from './images.service';
import { galleryImageUrl, productImageUrl } from './image-url';
import type { PrismaService } from '../prisma/prisma.service';

/** Prisma giả: chỉ cần hai hàm mà ImagesService thật sự gọi. */
function fakePrisma(rows: {
  product?: { image?: string | null; thumbnail?: string | null } | null;
  image?: { data: string } | null;
}): PrismaService {
  return {
    product: { findUnique: () => Promise.resolve(rows.product ?? null) },
    productImage: { findUnique: () => Promise.resolve(rows.image ?? null) },
  } as unknown as PrismaService;
}

const WEBP = `data:image/webp;base64,${Buffer.from('xin chao').toString('base64')}`;

describe('image-url', () => {
  beforeEach(() => {
    process.env.API_PUBLIC_URL = 'https://shop.example.test';
  });

  it('dựng địa chỉ ảnh bìa kèm tham số phiên bản theo updatedAt', () => {
    const url = productImageUrl('p1', 'cover', new Date(1_700_000_000_000));
    expect(url).toBe(
      'https://shop.example.test/api/images/product/p1/cover?v=1700000000000',
    );
  });

  it('đổi ảnh (updatedAt mới) là đổi địa chỉ — nếu không trình duyệt giữ ảnh cũ', () => {
    const truoc = productImageUrl('p1', 'cover', new Date(1_000));
    const sau = productImageUrl('p1', 'cover', new Date(2_000));
    expect(truoc).not.toBe(sau);
  });

  it('bỏ dấu gạch chéo thừa ở cuối API_PUBLIC_URL', () => {
    process.env.API_PUBLIC_URL = 'https://shop.example.test/';
    expect(galleryImageUrl('img1')).toBe(
      'https://shop.example.test/api/images/gallery/img1',
    );
  });

  it('ảnh phụ không cần phiên bản vì mỗi dòng là bất biến', () => {
    expect(galleryImageUrl('img1')).not.toContain('?v=');
  });
});

describe('ImagesService', () => {
  it('trả về nhị phân + mime đúng cho data URI hợp lệ', async () => {
    const service = new ImagesService(fakePrisma({ product: { image: WEBP } }));
    const payload = await service.getProductImage('p1', 'cover');
    if (payload.kind !== 'binary') throw new Error('phải là nhị phân');
    expect(payload.mime).toBe('image/webp');
    expect(payload.body.toString()).toBe('xin chao');
  });

  it('ETag đổi khi nội dung đổi — để trình duyệt biết tải lại', async () => {
    const a = await new ImagesService(
      fakePrisma({ image: { data: WEBP } }),
    ).getGalleryImage('img1');
    const b = await new ImagesService(
      fakePrisma({
        image: { data: `data:image/webp;base64,${Buffer.from('dai hon nhieu').toString('base64')}` },
      }),
    ).getGalleryImage('img1');
    if (a.kind !== 'binary' || b.kind !== 'binary') throw new Error('phải là nhị phân');
    expect(a.etag).not.toBe(b.etag);
  });

  it('404 khi sản phẩm chưa có ảnh', async () => {
    const service = new ImagesService(fakePrisma({ product: { image: null } }));
    await expect(service.getProductImage('p1', 'cover')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 khi không tìm thấy ảnh phụ', async () => {
    const service = new ImagesService(fakePrisma({ image: null }));
    await expect(service.getGalleryImage('khong-co')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('chuyển hướng với giá trị cũ là URL ngoài', async () => {
    const service = new ImagesService(
      fakePrisma({ product: { image: 'https://vidu.com/anh.png' } }),
    );
    const payload = await service.getProductImage('p1', 'cover');
    expect(payload).toEqual({ kind: 'redirect', url: 'https://vidu.com/anh.png' });
  });

  it('từ chối mime không nằm trong danh sách cho phép', async () => {
    // Nếu lọt, giá trị này đi thẳng vào Content-Type và biến endpoint ảnh thành
    // chỗ phát tán tệp tuỳ ý dưới tên miền của cửa hàng.
    const service = new ImagesService(
      fakePrisma({ image: { data: 'data:text/html;base64,PHNjcmlwdD4=' } }),
    );
    await expect(service.getGalleryImage('img1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('từ chối data URI không phải base64', async () => {
    const service = new ImagesService(
      fakePrisma({ image: { data: 'data:image/webp,khong-phai-base64' } }),
    );
    await expect(service.getGalleryImage('img1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
