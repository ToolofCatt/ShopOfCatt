import { describe, expect, it } from 'vitest';
import { decodeStoreMedia } from './media-image';

function png(width = 320, height = 180): string {
  const data = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return `data:image/png;base64,${data.toString('base64')}`;
}

describe('decodeStoreMedia', () => {
  it('đọc kích thước từ magic byte thay vì tin metadata phía web', () => {
    const decoded = decodeStoreMedia(png(640, 360));
    expect(decoded).toMatchObject({ contentType: 'image/png', width: 640, height: 360 });
  });

  it('từ chối MIME đúng nhưng bytes không phải ảnh', () => {
    expect(decodeStoreMedia(`data:image/png;base64,${Buffer.from('not a png').toString('base64')}`)).toBeNull();
  });

  it('từ chối SVG, data URI sai và ảnh vượt 2400px', () => {
    expect(decodeStoreMedia('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(decodeStoreMedia('https://example.com/image.png')).toBeNull();
    expect(decodeStoreMedia(png(2401, 100))).toBeNull();
  });

  it('từ chối payload vượt 1 MB trước khi ghi CSDL', () => {
    const bytes = Buffer.alloc(1_000_001, 1);
    expect(decodeStoreMedia(`data:image/png;base64,${bytes.toString('base64')}`)).toBeNull();
  });
});
