'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from 'lucide-react';
import { PRODUCT_IMAGE_MAX_COUNT, type ProductImageDto } from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { Button, Spinner } from '@/components/ui';
import {
  ImageTooLargeError,
  compressImage,
  formatDataUrlSize,
} from '@/lib/image-compress';

/**
 * Ảnh phụ của sản phẩm — chỉ có ở trang SỬA, không có ở trang tạo mới.
 *
 * Lý do: mỗi ảnh là một request riêng tới `/admin/products/:id/images`, mà sản
 * phẩm chưa lưu thì chưa có id. Gộp cả bộ ảnh vào body lúc tạo cũng không được:
 * giới hạn thân request là 2 MB còn sáu ảnh đã ~2,25 MB. Ràng buộc này giống hệt
 * chỗ "thêm loại khác ở trang sửa sản phẩm".
 *
 * Mỗi thao tác gọi thẳng API và nhận về sản phẩm mới nhất, nên không có trạng
 * thái cục bộ nào lệch được với máy chủ — bấm Huỷ ở form cũng không hoàn tác
 * được ảnh đã thêm, và đó là điều đúng: ảnh đã nằm trong CSDL rồi.
 */
export function GalleryPicker({
  images,
  coverCount,
  busy,
  onAdd,
  onRemove,
  onMove,
}: {
  images: ProductImageDto[];
  /** 1 khi sản phẩm đã có ảnh bìa — ảnh bìa cũng tính vào hạn mức. */
  coverCount: number;
  busy: boolean;
  onAdd: (dataUrl: string) => Promise<boolean>;
  onRemove: (imageId: string) => Promise<void>;
  onMove: (imageId: string, direction: -1 | 1) => Promise<void>;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const used = coverCount + images.length;
  const full = used >= PRODUCT_IMAGE_MAX_COUNT;
  const working = busy || compressing;

  const handleFiles = async (files: FileList | null | undefined) => {
    if (!files || files.length === 0) return;
    setError(null);
    setCompressing(true);
    try {
      // Chọn nhiều tệp một lúc: nén và gửi TUẦN TỰ, không Promise.all — mỗi ảnh
      // là một request và máy chủ đếm hạn mức từng lần, bắn song song thì hai
      // request cuối cùng cùng thấy "còn 1 chỗ" và cùng được nhận.
      for (const file of Array.from(files)) {
        if (coverCount + images.length + 1 > PRODUCT_IMAGE_MAX_COUNT) break;
        if (!file.type.startsWith('image/')) {
          setError(t.admin.formImageNotImage);
          continue;
        }
        if (!(await onAdd(await compressImage(file)))) break;
      }
    } catch (err) {
      setError(
        err instanceof ImageTooLargeError
          ? t.admin.formImageTooLarge
          : t.admin.formImageReadFailed,
      );
    } finally {
      setCompressing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        id="product-gallery"
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image, index) => (
            <li
              key={image.id}
              className="overflow-hidden rounded-lg border border-neutral-200"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.data}
                alt=""
                className="h-28 w-full bg-neutral-100 object-contain"
              />
              <div className="flex items-center justify-between gap-1 border-t border-neutral-200 px-1.5 py-1.5">
                <span className="truncate text-[11px] text-neutral-500">
                  {formatDataUrlSize(image.data)}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={t.admin.formGalleryMoveLeft}
                    disabled={working || index === 0}
                    onClick={() => void onMove(image.id, -1)}
                    className="cursor-pointer rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    aria-label={t.admin.formGalleryMoveRight}
                    disabled={working || index === images.length - 1}
                    onClick={() => void onMove(image.id, 1)}
                    className="cursor-pointer rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    aria-label={t.admin.formImageRemove}
                    disabled={working}
                    onClick={() => void onRemove(image.id)}
                    className="cursor-pointer rounded p-1 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-xs text-neutral-500">
          {t.admin.formGalleryFull(PRODUCT_IMAGE_MAX_COUNT)}
        </p>
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
            void handleFiles(event.dataTransfer.files);
          }}
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
            dragging ? 'border-neutral-950 bg-neutral-50' : 'border-neutral-300',
          )}
        >
          {working ? (
            <Spinner className="h-5 w-5 text-neutral-500" />
          ) : (
            <ImagePlus className="h-5 w-5 text-neutral-400" strokeWidth={1.5} />
          )}
          <p className="text-xs text-neutral-500">
            {t.admin.formGalleryRemaining(PRODUCT_IMAGE_MAX_COUNT - used)}
          </p>
          <Button
            size="sm"
            variant="outline"
            loading={working}
            onClick={() => inputRef.current?.click()}
          >
            {t.admin.formGalleryChoose}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
