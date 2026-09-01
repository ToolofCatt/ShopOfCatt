const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface DecodedStoreMedia {
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: Buffer;
  width: number;
  height: number;
}

/** Đọc magic byte + kích thước, không tin MIME hoặc dimensions từ trình duyệt. */
export function decodeStoreMedia(raw: string): DecodedStoreMedia | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!match || !ALLOWED.has(match[1])) return null;
  const data = Buffer.from(match[2], 'base64');
  if (data.length === 0 || data.length > 1_000_000) return null;
  const dimensions = imageDimensions(data, match[1]);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) return null;
  if (dimensions.width > 2400 || dimensions.height > 2400) return null;
  return {
    contentType: match[1] as DecodedStoreMedia['contentType'],
    data,
    ...dimensions,
  };
}

function imageDimensions(
  data: Buffer,
  contentType: string,
): { width: number; height: number } | null {
  if (contentType === 'image/png') {
    if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') return null;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (contentType === 'image/jpeg') return jpegDimensions(data);
  if (data.length < 30 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = data.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    return {
      width: 1 + data.readUIntLE(24, 3),
      height: 1 + data.readUIntLE(27, 3),
    };
  }
  if (kind === 'VP8L' && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ' && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function jpegDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1];
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + length + 2 > data.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    offset += length + 2;
  }
  return null;
}
