'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { Button, Spinner } from '@/components/ui';
import {
  ImageTooLargeError,
  compressImagePair,
  formatBytes,
  formatDataUrlSize,
  type CompressedPair,
} from '@/lib/image-compress';

/**
 * Chọn ảnh sản phẩm từ máy.
 *
 * Trước đây ô này là một `<input type="url">` bắt chủ shop tự đi tìm chỗ tải ảnh
 * lên rồi dán link về — link đó chết là ảnh sản phẩm biến mất. Giờ ảnh được nén
 * ngay trong trình duyệt rồi lưu thẳng vào cửa hàng.
 *
 * Nhận cả kéo-thả: dán ảnh từ Zalo/điện thoại sang là thao tác thường gặp nhất.
 */
export function ImagePicker({
  id = 'product-image',
  value,
  bytes,
  onChange,
}: {
  /**
   * Id của ô chọn tệp. Có tham số vì trang cấu hình dùng thêm một ImagePicker
   * nữa cho ảnh QR — hai ô cùng id thì nhãn trỏ sai ô và không bấm được.
   */
  id?: string;
  /**
   * Thứ để hiển thị: ĐỊA CHỈ ảnh đã lưu, hoặc data URI của ảnh vừa chọn. Cả hai
   * đều dùng thẳng làm `src` được.
   */
  value: string;
  /**
   * Cỡ ảnh đã lưu (byte) do máy chủ trả về. `null` khi ảnh là bản vừa chọn —
   * lúc đó tự đo từ chính data URI. Cần hai đường vì địa chỉ ảnh không nói lên
   * dung lượng, mà tải về chỉ để đếm byte thì phí.
   */
  bytes: number | null;
  /**
   * Trả về cả hai bản cùng lúc — bản nhỏ phải sinh từ đúng tệp vừa chọn.
   * Xoá ảnh thì cả hai là chuỗi rỗng.
   */
  onChange: (pair: CompressedPair) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(t.admin.formImageNotImage);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChange(await compressImagePair(file));
    } catch (err) {
      setError(
        err instanceof ImageTooLargeError
          ? t.admin.formImageTooLarge
          : t.admin.formImageReadFailed,
      );
    } finally {
      setBusy(false);
      // Cho phép chọn LẠI đúng tệp vừa rồi: không xoá thì onChange không kích hoạt.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      {value ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className="h-24 w-24 shrink-0 rounded-lg border border-neutral-200 object-cover"
          />
          <div className="min-w-0 space-y-2">
            <p className="text-xs text-neutral-500">
              {t.admin.formImageSize(
                bytes === null ? formatDataUrlSize(value) : formatBytes(bytes),
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                onClick={() => inputRef.current?.click()}
              >
                {t.admin.formImageReplace}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => onChange({ image: '', thumbnail: '' })}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                {t.admin.formImageRemove}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void handleFile(event.dataTransfer.files?.[0]);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors',
            dragging ? 'border-neutral-950 bg-neutral-50' : 'border-neutral-300',
          )}
        >
          {busy ? (
            <Spinner className="h-5 w-5 text-neutral-500" />
          ) : (
            <ImagePlus className="h-6 w-6 text-neutral-400" strokeWidth={1.5} />
          )}
          <p className="text-sm text-neutral-500">{t.admin.formImageDropHint}</p>
          <Button
            size="sm"
            variant="outline"
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            {t.admin.formImageChoose}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
