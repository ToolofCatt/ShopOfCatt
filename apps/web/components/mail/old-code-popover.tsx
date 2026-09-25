'use client';
import { Bookmark, ChevronDown, Copy, Search } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
import type { MailboxDto } from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { usePinScrollLock } from './use-pin-scroll-lock';

export function OldCodePopover({ mailbox }: { mailbox: MailboxDto }) {
  const { t } = useI18n(); const text = t.mail; const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false), [pinned, setPinned] = useState(false), [query, setQuery] = useState(''), [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState<MailboxDto['codes']>([]);
  const pinnedRef = useRef(pinned); pinnedRef.current = pinned;
  const clearTimer = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const show = (pin = false) => {
    clearTimer();
    const claim = new CustomEvent('mail-code-popover', { cancelable: true, detail: { id, pin } });
    if (!document.dispatchEvent(claim)) return;
    if (!open) { setSnapshot(mailbox.codes.slice(1)); setQuery(''); setNotice(''); setOpen(true); }
    if (pin) setPinned(true);
  };
  const close = () => { clearTimer(); setPinned(false); setOpen(false); };
  const leave = () => { clearTimer(); closeTimer.current = setTimeout(() => { if (!pinnedRef.current && !panel.current?.matches(':hover') && !trigger.current?.matches(':hover')) { setOpen(false); } }, 240); };
  usePinScrollLock(open && pinned, panel, list);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    if (!open || !panel.current) return;
    const el = panel.current; el.showPopover();
    const position = () => {
      if (!trigger.current || !panel.current) return;
      const r = trigger.current.getBoundingClientRect(), p = panel.current;
      p.style.width = `${Math.min(320, innerWidth - 24)}px`;
      p.style.maxHeight = `${Math.min(460, innerHeight - 24)}px`;
      const h = p.getBoundingClientRect().height, down = innerHeight - r.bottom >= Math.min(h, 260) || r.top < innerHeight - r.bottom;
      p.style.maxHeight = `${Math.max(160, down ? innerHeight - r.bottom - 20 : r.top - 20)}px`;
      const height = p.getBoundingClientRect().height;
      p.style.left = `${Math.max(12, Math.min(r.right - p.offsetWidth, innerWidth - p.offsetWidth - 12))}px`;
      p.style.top = `${Math.max(12, Math.min(down ? r.bottom + 8 : r.top - height - 8, innerHeight - height - 12))}px`;
    };
    position(); const observer = new ResizeObserver(position); observer.observe(el);
    // Mỗi lần chỉ một mailbox mở lịch sử; hover không thay mail đã ghim.
    const claim = (event: Event) => {
      const other = (event as CustomEvent<{ id: string; pin: boolean }>).detail;
      if (other.id === id) return;
      if (pinnedRef.current && !other.pin) event.preventDefault();
      else { setPinned(false); setOpen(false); }
    };
    const outside = (e: MouseEvent) => { if (!el.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) { setPinned(false); setOpen(false); } };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); if (!pinnedRef.current) { setOpen(false); trigger.current?.focus({ preventScroll: true }); } } };
    document.addEventListener('mail-code-popover', claim); document.addEventListener('click', outside); document.addEventListener('keydown', key); window.addEventListener('resize', position); document.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); document.removeEventListener('mail-code-popover', claim); document.removeEventListener('click', outside); document.removeEventListener('keydown', key); window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true); if (el.matches(':popover-open')) el.hidePopover(); };
  }, [open]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2500); return () => clearTimeout(timer); }, [notice]);
  if (mailbox.codes.length < 2) return null;
  const current = mailbox.codes.slice(1), changed = current.length !== snapshot.length || current.some((c, i) => c.id !== snapshot[i]?.id);
  return <>
    <button ref={trigger} className={`mail-old-trigger ${pinned ? 'is-pinned' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onPointerEnter={e => { if (e.pointerType === 'mouse') show(); }} onPointerLeave={leave}
      onClick={() => { if (open && pinned) close(); else show(true); }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); show(true); setTimeout(() => panel.current?.querySelector<HTMLElement>('input,button')?.focus(), 0); } }}>
      {text.oldCodes} <span>{mailbox.codes.length - 1}</span><ChevronDown size={13} />
    </button>
    {open && createPortal(<div ref={panel} id={id} className="mail-old-panel" popover="manual" role="dialog" aria-modal="false" aria-label={text.oldCodes}
      onPointerEnter={clearTimer} onPointerLeave={leave} onPointerDown={e => { if (!(e.target as Element).closest('[data-pin]')) setPinned(true); }}>
      <header><strong>{text.oldCodes} <span>{snapshot.length}</span></strong><button data-pin className="mail-icon" aria-pressed={pinned} aria-label={pinned ? text.unpin : text.pin} onClick={() => { setPinned(v => !v); if (pinned) trigger.current?.focus({ preventScroll: true }); }}><Bookmark size={16} fill={pinned ? 'currentColor' : 'none'} /></button></header>
      <p className="mail-old-email">{mailbox.email}</p>
      {snapshot.length >= 9 && <label className="mail-search"><Search size={15} /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={text.oldSearch} aria-label={text.oldSearch} /></label>}
      {changed && <button className="mail-update-codes" onClick={() => { setSnapshot(current); if (list.current) list.current.scrollTop = 0; }}>{text.updateCodes}</button>}
      <div ref={list} className="mail-old-list">{snapshot.filter(c => c.code.includes(query)).map((c, i) => <div key={c.id}><span>{i === 0 ? text.recent : `${text.oldCodes} ${i + 1}`}</span><button className="mail-code" aria-label={`${text.copyCode} ${c.code}`} onClick={async () => { setPinned(true); try { await navigator.clipboard.writeText(c.code); setNotice(text.copied); } catch { setNotice(text.copyFailed); } }}><span>{c.code}</span><Copy size={14} /></button></div>)}{!snapshot.some(c => c.code.includes(query)) && <p>{text.noOldCodes}</p>}</div>
      {notice && <div className="mail-popover-notice" role="status">{notice}</div>}
    </div>, document.body)}
  </>;
}
