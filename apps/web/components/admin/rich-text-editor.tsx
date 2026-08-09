'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Underline,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';

/**
 * Trình soạn thảo có định dạng (giống Word thu nhỏ) dựa trên `contentEditable`.
 *
 * Máy chủ VẪN lọc lại HTML theo danh sách thẻ cho phép khi lưu — các nút ở đây
 * chỉ là tiện ích soạn thảo, không phải hàng rào bảo mật.
 */

interface ToolButton {
  key: string;
  icon: LucideIcon;
  label: string;
  /** Lệnh execCommand; 'link'/'unlink' xử lý riêng. */
  run: () => void;
  /** Trạng thái đang bật (in đậm, danh sách…) để tô nút. */
  active?: () => boolean;
}

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  invalid = false,
  id,
}: RichTextEditorProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // Đếm lần cập nhật để buộc vẽ lại thanh công cụ theo vị trí con trỏ.
  const [, setTick] = useState(0);
  const [empty, setEmpty] = useState(true);

  /** Nạp nội dung từ ngoài vào — chỉ khi khác nội dung đang gõ (tránh nhảy con trỏ). */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== value) el.innerHTML = value;
    setEmpty(el.textContent?.trim() === '' && !el.querySelector('img'));
  }, [value]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEmpty(el.textContent?.trim() === '');
    onChange(el.innerHTML);
  }, [onChange]);

  /** Chạy một lệnh định dạng rồi trả con trỏ về vùng soạn thảo. */
  const exec = useCallback(
    (command: string, argument?: string) => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      document.execCommand(command, false, argument);
      emit();
      setTick((n) => n + 1);
    },
    [emit],
  );

  const isOn = (command: string): boolean => {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };

  const applyLink = () => {
    const url = window.prompt(t.admin.editorLinkPrompt, 'https://');
    if (!url) return;
    const trimmed = url.trim();
    // Chỉ nhận liên kết web/email — máy chủ cũng chặn lần nữa khi lưu.
    if (!/^(https?:\/\/|mailto:)/i.test(trimmed)) {
      window.alert(t.admin.editorLinkInvalid);
      return;
    }
    exec('createLink', trimmed);
  };

  const groups: ToolButton[][] = [
    [
      {
        key: 'bold',
        icon: Bold,
        label: t.admin.editorBold,
        run: () => exec('bold'),
        active: () => isOn('bold'),
      },
      {
        key: 'italic',
        icon: Italic,
        label: t.admin.editorItalic,
        run: () => exec('italic'),
        active: () => isOn('italic'),
      },
      {
        key: 'underline',
        icon: Underline,
        label: t.admin.editorUnderline,
        run: () => exec('underline'),
        active: () => isOn('underline'),
      },
      {
        key: 'strike',
        icon: Strikethrough,
        label: t.admin.editorStrike,
        run: () => exec('strikeThrough'),
        active: () => isOn('strikeThrough'),
      },
    ],
    [
      {
        key: 'heading',
        icon: Heading,
        label: t.admin.editorHeading,
        run: () => exec('formatBlock', '<h3>'),
      },
      {
        key: 'quote',
        icon: Quote,
        label: t.admin.editorQuote,
        run: () => exec('formatBlock', '<blockquote>'),
      },
      {
        key: 'ul',
        icon: List,
        label: t.admin.editorBulletList,
        run: () => exec('insertUnorderedList'),
        active: () => isOn('insertUnorderedList'),
      },
      {
        key: 'ol',
        icon: ListOrdered,
        label: t.admin.editorNumberList,
        run: () => exec('insertOrderedList'),
        active: () => isOn('insertOrderedList'),
      },
    ],
    [
      {
        key: 'left',
        icon: AlignLeft,
        label: t.admin.editorAlignLeft,
        run: () => exec('justifyLeft'),
        active: () => isOn('justifyLeft'),
      },
      {
        key: 'center',
        icon: AlignCenter,
        label: t.admin.editorAlignCenter,
        run: () => exec('justifyCenter'),
        active: () => isOn('justifyCenter'),
      },
      {
        key: 'right',
        icon: AlignRight,
        label: t.admin.editorAlignRight,
        run: () => exec('justifyRight'),
        active: () => isOn('justifyRight'),
      },
    ],
    [
      { key: 'link', icon: Link2, label: t.admin.editorLink, run: applyLink },
      {
        key: 'unlink',
        icon: Link2Off,
        label: t.admin.editorUnlink,
        run: () => exec('unlink'),
      },
      {
        key: 'clear',
        icon: RemoveFormatting,
        label: t.admin.editorClear,
        run: () => exec('removeFormat'),
      },
    ],
  ];

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border transition-colors',
        invalid
          ? 'border-red-500'
          : 'border-neutral-300 focus-within:border-neutral-950',
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-neutral-50 p-1.5">
        {groups.map((group, index) => (
          <div key={index} className="flex items-center gap-0.5">
            {index > 0 && (
              <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />
            )}
            {group.map((button) => {
              const Icon = button.icon;
              const on = button.active?.() ?? false;
              return (
                <button
                  key={button.key}
                  type="button"
                  title={button.label}
                  aria-label={button.label}
                  aria-pressed={button.active ? on : undefined}
                  // onMouseDown: giữ vùng chọn trong ô soạn thảo khi bấm nút
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={button.run}
                  className={cn(
                    'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-colors',
                    on
                      ? 'bg-neutral-950 text-white'
                      : 'text-neutral-600 hover:bg-neutral-200 hover:text-neutral-950',
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="relative">
        {empty && placeholder && (
          <p className="pointer-events-none absolute left-3 top-3 text-sm text-neutral-400">
            {placeholder}
          </p>
        )}
        <div
          id={id}
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          onInput={emit}
          onBlur={emit}
          onKeyUp={() => setTick((n) => n + 1)}
          onMouseUp={() => setTick((n) => n + 1)}
          // Dán từ Word/trang web: chỉ lấy phần chữ để không kéo theo rác định dạng
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
            emit();
          }}
          className="wc-prose min-h-[10rem] px-3 py-3 text-sm leading-relaxed text-neutral-800 outline-none"
        />
      </div>
    </div>
  );
}
