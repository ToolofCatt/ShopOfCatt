'use client';

import { cn } from '@/lib/cn';

/**
 * Một dòng bật/tắt: ô tick + tên + mô tả ngắn, trong khung viền chiếm trọn chiều ngang.
 *
 * Trước đây trang sản phẩm tự dựng một `<label>` cao 40px rồi đặt cạnh ô "Thứ tự
 * hiển thị" trong lưới `items-end`. Ô bên trái có nhãn + input + dòng gợi ý, ô bên
 * phải chỉ có mỗi cái hộp, nên căn theo đáy đẩy nó tụt xuống ngang dòng gợi ý —
 * lệch hẳn một khoảng nhìn thấy rõ. Tệ hơn, khi hiện lỗi nhập liệu thì dòng gợi ý
 * đổi cỡ chữ và cái hộp lại nhảy tiếp.
 *
 * Dùng chung một dòng trọn chiều ngang cho cả trang cài đặt lẫn trang sản phẩm thì
 * không còn gì để căn lệch.
 */
export function ToggleRow({
  id,
  checked,
  disabled = false,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-neutral-200 p-3.5 transition-colors',
        disabled ? 'opacity-60' : 'cursor-pointer hover:border-neutral-400',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-neutral-950 disabled:cursor-not-allowed"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-neutral-950">{label}</span>
        <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>
      </span>
    </label>
  );
}
