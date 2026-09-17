'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';

interface MobileDrawerProps {
  title: string;
  triggerLabel: string;
  closeLabel: string;
  routeKey: string;
  children: ReactNode;
}

/** Dùng dialog native để nền inert và focus không thoát ra ngoài khi menu mở. */
export function MobileDrawer({ title, triggerLabel, closeLabel, routeKey, children }: MobileDrawerProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    dialogRef.current?.close();
  }, [routeKey]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = () => {
      // Dialog ở top layer vẫn chặn trang nếu chỉ ẩn nó bằng breakpoint CSS.
      if (desktop.matches) dialogRef.current?.close();
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          dialogRef.current?.showModal();
          setOpen(true);
        }}
        className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
      >
        <Menu aria-hidden="true" strokeWidth={1.75} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">{triggerLabel}</span>
      </button>
      <dialog
        ref={dialogRef}
        id={id}
        aria-labelledby={`${id}-title`}
        onClose={() => {
          setOpen(false);
          triggerRef.current?.focus({ preventScroll: true });
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
            .filter((element) => element.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1);
          // Edge có thể đưa focus lên browser chrome ở cuối dialog native; giữ vòng Tab trong menu.
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-80 max-w-[calc(100%_-_1rem)] overflow-y-auto overscroll-contain border-0 bg-white p-0 text-neutral-950 shadow-xl backdrop:bg-neutral-950/40"
      >
        <div
          className="min-h-full p-4"
          onClickCapture={(event) => {
            // Chọn lại trang hiện tại không đổi pathname, nên vẫn phải đóng menu.
            if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey &&
              event.target instanceof Element && event.target.closest('a[href]')) {
              dialogRef.current?.close();
            }
          }}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id={`${id}-title`} className="min-w-0 text-sm font-semibold">{title}</h2>
            <button
              type="button"
              autoFocus
              aria-label={closeLabel}
              onClick={() => dialogRef.current?.close()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950"
            >
              <X aria-hidden="true" strokeWidth={1.75} className="h-5 w-5" />
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
