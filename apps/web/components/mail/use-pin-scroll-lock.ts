'use client';
import { useEffect, type RefObject } from 'react';

export function usePinScrollLock(pinned: boolean, panel: RefObject<HTMLElement | null>, list: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!pinned) return;
    const nodes = new Set<HTMLElement>([document.documentElement, document.body, ...document.querySelectorAll<HTMLElement>('[data-mail-scroll]')]);
    const snapshots = [...nodes].map(node => ({ node, overflow: node.style.overflow, priority: node.style.getPropertyPriority('overflow'), top: node.scrollTop, left: node.scrollLeft }));
    snapshots.forEach(({ node }) => node.style.setProperty('overflow', 'hidden', 'important'));
    let touchY: number | null = null;
    const canScroll = (target: EventTarget | null, delta: number) => {
      const el = list.current;
      return !!el && target instanceof Node && el.contains(target) && (delta < 0 ? el.scrollTop > 0 : delta > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey && !canScroll(e.target, e.deltaY)) e.preventDefault(); };
    const start = (e: TouchEvent) => { touchY = e.touches.length === 1 ? e.touches[0].clientY : null; };
    const move = (e: TouchEvent) => { if (e.touches.length !== 1) return; const y = e.touches[0].clientY; if (!canScroll(e.target, touchY === null ? 0 : touchY - y)) e.preventDefault(); touchY = y; };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const items = [...(panel.current?.querySelectorAll<HTMLElement>('button,input') ?? [])].filter(n => n.getClientRects().length);
        if (!items.length) return;
        if (!panel.current?.contains(document.activeElement) || (e.shiftKey && document.activeElement === items[0]) || (!e.shiftKey && document.activeElement === items.at(-1))) {
          e.preventDefault(); (e.shiftKey ? items.at(-1)! : items[0]).focus({ preventScroll: true });
        }
      } else if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(e.key) && !panel.current?.contains(e.target as Node)) e.preventDefault();
    };
    document.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('wheel', wheel); document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move); document.removeEventListener('keydown', key);
      snapshots.forEach(({ node, overflow, priority, top, left }) => { if (overflow) node.style.setProperty('overflow', overflow, priority); else node.style.removeProperty('overflow'); node.scrollTop = top; node.scrollLeft = left; });
    };
  }, [pinned, panel, list]);
}
