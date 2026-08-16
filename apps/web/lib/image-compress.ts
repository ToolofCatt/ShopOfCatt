import {
  PRODUCT_IMAGE_MAX_LENGTH,
  PRODUCT_THUMBNAIL_MAX_LENGTH,
} from '@webcatt/shared';

/**
 * Nén ảnh NGAY TRONG TRÌNH DUYỆT rồi trả về data URI.
 *
 * Ảnh được lưu thẳng vào cột `Product.image`, nên nó đi theo mọi bản `pg_dump`
 * và được giữ lại 14 bản. Một tấm ảnh 4 MB từ điện thoại mà gửi nguyên si là
 * 56 MB dung lượng sao lưu cho đúng một sản phẩm. Nén ở đây, trước khi rời máy
 * chủ shop, là chỗ rẻ nhất để chặn việc đó.
 *
 * Đổi lại: ảnh gốc KHÔNG được giữ. Chủ shop tải lên ảnh nào thì cửa hàng dùng
 * đúng bản đã nén đó.
 */

/** Cạnh dài nhất sau khi thu nhỏ. Thẻ sản phẩm rộng nhất cũng chỉ ~600px. */
const MAX_EDGE = 1200;
/** Lần thử cuối: hạ tiếp cạnh xuống mức này trước khi bỏ cuộc. */
const FALLBACK_EDGE = 900;
/** Thử lần lượt các mức chất lượng này, dừng ở mức đầu tiên đủ nhỏ. */
const QUALITY_STEPS = [0.8, 0.65, 0.5];

/**
 * Chặn ở mức thấp hơn giới hạn của máy chủ một chút, để lỗi hiện ra ngay tại
 * chỗ chọn ảnh chứ không phải sau khi bấm Lưu rồi mới nhận 400 từ API.
 */
const CLIENT_MAX_LENGTH = Math.floor(PRODUCT_IMAGE_MAX_LENGTH * 0.8);

/**
 * Cạnh dài nhất của bản thu nhỏ. Ô ảnh trên thẻ sản phẩm rộng nhất ~300px, nên
 * 400px đã dư cho màn hình 2x mà vẫn nhẹ hơn bản lớn cả chục lần.
 */
const THUMBNAIL_EDGE = 400;
const THUMBNAIL_FALLBACK_EDGE = 260;
const CLIENT_THUMBNAIL_MAX_LENGTH = Math.floor(PRODUCT_THUMBNAIL_MAX_LENGTH * 0.8);

export class ImageTooLargeError extends Error {
  constructor() {
    super('IMAGE_TOO_LARGE');
    this.name = 'ImageTooLargeError';
  }
}

/**
 * Định dạng đầu ra. WebP nhỏ hơn JPEG đáng kể ở cùng chất lượng, nhưng Safari cũ
 * không xuất được — khi đó `toDataURL` lặng lẽ trả về PNG, nên phải kiểm tiền tố
 * chứ không thể tin là đã có WebP.
 */
function pickMimeType(canvas: HTMLCanvasElement): 'image/webp' | 'image/jpeg' {
  return canvas.toDataURL('image/webp', 0.5).startsWith('data:image/webp')
    ? 'image/webp'
    : 'image/jpeg';
}

/** Thu ảnh về trong khung `maxEdge`, giữ nguyên tỉ lệ. Ảnh nhỏ sẵn thì để yên. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function drawToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Trình duyệt không dựng được canvas 2D');
  // Nền trắng: ảnh PNG trong suốt xuất sang JPEG sẽ thành nền đen nếu bỏ bước này.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Đọc tệp thành data URI — `data:` nằm trong img-src, khác với `blob:`. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Không đọc được tệp ảnh'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Không đọc được tệp ảnh'));
    image.src = src;
  });
}

/**
 * Nguồn ảnh để vẽ lên canvas.
 *
 * TUYỆT ĐỐI KHÔNG dùng `URL.createObjectURL`: nó sinh ra URL `blob:`, mà CSP của
 * trang chỉ cho `img-src 'self' data: https:` — trình duyệt chặn thẳng và ô chọn
 * ảnh im lặng báo "không đọc được tệp". Lỗi này chỉ lộ ra khi chạy thật.
 *
 * `createImageBitmap` nhận trực tiếp Blob nên không cần URL nào; trình duyệt cũ
 * không có nó thì lùi về data URI, thứ CSP vẫn cho phép.
 */
async function loadSource(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Định dạng lạ → thử tiếp bằng <img>.
    }
  }
  const image = await loadImageElement(await readAsDataUrl(file));
  return { source: image, width: image.naturalWidth, height: image.naturalHeight };
}

/**
 * Trả về data URI đã nén, hoặc ném `ImageTooLargeError` khi mọi mức nén vẫn quá
 * lớn (ảnh chụp màn hình rất dài, ảnh nhiều chi tiết…).
 */
/**
 * Thử lần lượt các cạnh rồi các mức chất lượng, trả về bản đầu tiên đủ nhỏ.
 * `null` = mọi cách đều vẫn quá lớn.
 */
function encode(
  image: { source: CanvasImageSource; width: number; height: number },
  maxEdges: number[],
  maxLength: number,
): string | null {
  for (const maxEdge of maxEdges) {
    const { width, height } = fitWithin(image.width, image.height, maxEdge);
    const canvas = drawToCanvas(image.source, width, height);
    const mimeType = pickMimeType(canvas);
    for (const quality of QUALITY_STEPS) {
      const dataUrl = canvas.toDataURL(mimeType, quality);
      if (dataUrl.length <= maxLength) return dataUrl;
    }
  }
  return null;
}

export async function compressImage(file: File): Promise<string> {
  const image = await loadSource(file);
  const dataUrl = encode(image, [MAX_EDGE, FALLBACK_EDGE], CLIENT_MAX_LENGTH);
  if (!dataUrl) throw new ImageTooLargeError();
  return dataUrl;
}

export interface CompressedPair {
  /** Bản lớn cho trang chi tiết. */
  image: string;
  /** Bản nhỏ cho thẻ sản phẩm và danh sách quản trị. */
  thumbnail: string;
}

/**
 * Nén một tệp ra HAI bản trong một lần giải mã.
 *
 * Vì sao cần bản nhỏ riêng: truy vấn danh sách sản phẩm không kéo cột ảnh lớn
 * về nữa (xem `publicListSelect` phía API). Trước đó trang chủ 20 sản phẩm là
 * 20 tấm ảnh 1200px nhúng thẳng vào JSON, cho những ô rộng ~250px.
 *
 * Giải mã tệp đúng một lần rồi vẽ ra hai canvas — `loadSource` là bước đắt nhất.
 */
export async function compressImagePair(file: File): Promise<CompressedPair> {
  const source = await loadSource(file);
  const image = encode(source, [MAX_EDGE, FALLBACK_EDGE], CLIENT_MAX_LENGTH);
  const thumbnail = encode(
    source,
    [THUMBNAIL_EDGE, THUMBNAIL_FALLBACK_EDGE],
    CLIENT_THUMBNAIL_MAX_LENGTH,
  );
  if (!image || !thumbnail) throw new ImageTooLargeError();
  return { image, thumbnail };
}

/** "142 KB" từ số byte máy chủ trả về. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** "142 KB" — hiện cho chủ shop biết ảnh chiếm bao nhiêu sau khi nén. */
export function formatDataUrlSize(dataUrl: string): string {
  // Data URI là base64: 4 ký tự mã hoá 3 byte, trừ phần tiền tố "data:...;base64,".
  const base64Length = dataUrl.length - (dataUrl.indexOf(',') + 1);
  const bytes = Math.round((base64Length * 3) / 4);
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
