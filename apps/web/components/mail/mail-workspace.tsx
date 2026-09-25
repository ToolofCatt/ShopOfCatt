'use client';
import { Check, CircleSlash, Clock3, Copy, Download, Mail, Minus, Plus, Search, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MailCatalogDto, MailboxDto, MailWorkspaceDto } from '@webcatt/shared';
import { apiBaseUrl, apiErrorMessage, apiFetch, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { usePrices } from '@/lib/prices';
import { OldCodePopover } from './old-code-popover';
import './mail.css';

const units = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6)); };
const totalPrice = (price: string, count: number) => Number(units(price) * BigInt(count)) / 1_000_000;
function ServiceIcon({ name }: { name: string }) { return <span className="mail-service-icon" aria-hidden="true">{name.match(/telegram/i) ? 'T' : name.match(/chatgpt/i) ? 'G' : name.match(/apple/i) ? 'A' : <Mail size={17} />}</span>; }

export function MailWorkspace() {
  const { token, loading: authLoading } = useAuth(), { t } = useI18n(), { priceUsdt, price: displayPrice } = usePrices(); const text = t.mail;
  const [catalog, setCatalog] = useState<MailCatalogDto | null>(null), [workspace, setWorkspace] = useState<MailWorkspaceDto | null>(null);
  const [serviceQuery, setServiceQuery] = useState(''), [selected, setSelected] = useState(''), [quantity, setQuantity] = useState(1);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'rent' | MailboxDto | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), running = useRef(false), mounted = useRef(false), purchaseLock = useRef(false);
  const mailboxRef = useRef<MailboxDto[]>([]), pollOffset = useRef(0), request = useRef<{ id: string; code: string; qty: number; price: string } | null>(null);
  const activeToken = useRef(token); activeToken.current = token;
  const offers = catalog?.offers.filter(p => p.category === 'gmail-api') ?? [], product = offers.find(p => p.code === selected) ?? offers[0];
  const mails = workspace?.mailboxes ?? [];
  const status = (m: MailboxDto) => m.closed ? 'closed' : m.codes.length ? 'received' : 'waiting';
  const validQuantity = Number.isInteger(quantity) && quantity > 0 && quantity <= Math.min(product?.stock ?? 0, 10);
  const total = product && validQuantity ? totalPrice(product.price, quantity) : 0;
  const display = (item: { price: string; priceCurrency: 'VND' | 'USDT'; priceAmount: string }, count = 1) => displayPrice({ price: totalPrice(item.price, count), priceCurrency: item.priceCurrency, priceAmount: totalPrice(item.priceAmount, count) }).primary;
  const enough = !!workspace && Number(workspace.balance) >= total;
  const pendingPurchase = workspace?.purchases.some(p => p.status === 'REQUESTING' || p.status === 'REVIEW') ?? false;
  const load = useCallback(async () => {
    if (running.current) return; running.current = true;
    try {
      const [nextCatalog, nextWorkspace] = await Promise.all([apiFetch<MailCatalogDto>('/mail/catalog'), token ? apiFetch<MailWorkspaceDto>('/mail/workspace', { token }) : Promise.resolve(null)]);
      if (!mounted.current || activeToken.current !== token) return;
      setCatalog(nextCatalog);
      if (nextWorkspace) {
        setWorkspace(previous => {
          // Giữ các trang đã tải; poll cập nhật trang đầu không làm mất mailbox cũ.
          const ids = new Set(nextWorkspace.mailboxes.map(m => m.id));
          const mailboxes = [...nextWorkspace.mailboxes, ...(previous?.mailboxes.filter(m => !ids.has(m.id)) ?? [])];
          mailboxRef.current = mailboxes;
          return { ...nextWorkspace, mailboxes, nextCursor: previous && previous.mailboxes.length > 100 ? previous.nextCursor : nextWorkspace.nextCursor };
        });
      } else { setWorkspace(null); mailboxRef.current = []; }
      setError('');
      const readable = mailboxRef.current.filter(m => !m.closed && m.canRead);
      if (token && readable.length) {
        const batch = readable.slice(pollOffset.current, pollOffset.current + 30); pollOffset.current = (pollOffset.current + 30) % readable.length;
        await apiFetch('/mail/poll', { token, method: 'POST', body: { ids: batch.map(m => m.id) } });
      }
    } catch (e) { if (mounted.current && activeToken.current === token) setError(apiErrorMessage(e, text.connectionError)); }
    finally { running.current = false; }
  }, [token, text.connectionError]);
  useEffect(() => { setWorkspace(null); mailboxRef.current = []; request.current = null; }, [token]);
  useEffect(() => { mounted.current = true; void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 3000); return () => { mounted.current = false; clearInterval(timer); }; }, [load]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2600); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (confirm) dialog.current?.showModal(); else dialog.current?.close(); }, [confirm]);
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setNotice(text.copied); } catch { setNotice(text.copyFailed); } };
  const submit = async () => {
    if (!token || !product || !validQuantity || purchaseLock.current) return;
    purchaseLock.current = true; setBusy(true); setError('');
    if (!request.current || request.current.code !== product.code || request.current.qty !== quantity || request.current.price !== product.price) request.current = { id: crypto.randomUUID(), code: product.code, qty: quantity, price: product.price };
    try {
      const intent = request.current;
      await apiFetch('/mail/rent', { token, body: { requestId: intent.id, offerCode: intent.code, quantity: intent.qty, expectedUnitPrice: intent.price } });
      request.current = null; setConfirm(null); setNotice(text.pending); await load();
    } catch (e) {
      // Mất phản hồi giữ requestId để lần bấm lại không trừ/mua lần2.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) request.current = null;
      setError(apiErrorMessage(e, text.connectionError));
    } finally { purchaseLock.current = false; setBusy(false); }
  };
  const stop = async () => { if (!token || !confirm || confirm === 'rent') return; setBusy(true); try { await apiFetch(`/mail/${confirm.id}/close`, { token, method: 'POST' }); setConfirm(null); await load(); } catch (e) { setError(apiErrorMessage(e, text.connectionError)); } finally { setBusy(false); } };
  const exportMail = async () => {
    if (!token) return;
    try { const response = await fetch(`${apiBaseUrl()}/mail/export`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error(); const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = 'mail.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch { setError(text.connectionError); }
  };
  const loadMore = async () => { if (!token || !workspace?.nextCursor) return; try { const next = await apiFetch<MailWorkspaceDto>(`/mail/workspace?cursor=${encodeURIComponent(workspace.nextCursor)}`, { token }); setWorkspace(old => { if (!old) return next; const ids = new Set(old.mailboxes.map(m => m.id)); return { ...old, mailboxes: [...old.mailboxes, ...next.mailboxes.filter(m => !ids.has(m.id))], nextCursor: next.nextCursor }; }); } catch { setError(text.connectionError); } };
  const shown = mails.filter(m => (filter === 'all' || status(m) === filter) && `${m.email} ${m.service} ${m.codes.map(c => c.code).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="mail-workspace">
    <aside className="mail-service-panel"><div className="mail-section-title"><h2>{text.rentTitle}</h2><span>Gmail</span></div>
      <label className="mail-search"><Search size={16} /><input value={serviceQuery} onChange={e => setServiceQuery(e.target.value)} aria-label={text.serviceSearch} placeholder={text.serviceSearch} /></label>
      <div className="mail-services" data-mail-scroll>{offers.filter(p => p.name.toLowerCase().includes(serviceQuery.toLowerCase())).map(p => <button key={p.code} className={product?.code === p.code ? 'chosen' : ''} aria-pressed={product?.code === p.code} onClick={() => { setSelected(p.code); setQuantity(1); }}><ServiceIcon name={p.name} /><span>{p.name}</span><small>{p.stock.toLocaleString()}</small></button>)}{!catalog && <p>{text.loading}</p>}{catalog && !offers.length && <p className="mail-muted">{text.unavailable}</p>}</div>
      {product && <div className="mail-purchase"><div className="mail-purchase-product"><ServiceIcon name={product.name} /><div><strong>{product.name}</strong><span>Gmail</span></div><b>{display(product)}<small>{text.perMail}</small></b></div><p>{text.remaining}: {product.stock.toLocaleString()}</p>
        <label className="mail-quantity"><span>{text.quantity}</span><span><button aria-label={text.quantity + ' −'} disabled={quantity <= 1} onClick={() => setQuantity(q => Math.max(1, q - 1))}><Minus size={14} /></button><input type="number" min={1} max={Math.min(10, product.stock)} value={quantity} onChange={e => setQuantity(Number(e.target.value))} aria-label={text.quantity} /><button aria-label={text.quantity + ' +'} disabled={quantity >= Math.min(10, product.stock)} onClick={() => setQuantity(q => q + 1)}><Plus size={14} /></button></span></label>
        {!token && !authLoading ? <Link className="mail-primary" href="/login">{text.login}</Link> : <button className="mail-primary" disabled={!catalog?.purchaseEnabled || !product.purchasable || !validQuantity || !enough || busy || pendingPurchase} onClick={() => setConfirm('rent')}><span>{busy ? text.renting : text.rent}</span><strong>{product && validQuantity ? display(product, quantity) : priceUsdt(0).primary}</strong></button>}
        {token && <p className="mail-wallet"><Wallet size={14} />{text.balance}: {priceUsdt(Number(workspace?.balance ?? 0)).primary} <Link href="/account">{text.account}</Link></p>}
        {token && validQuantity && !enough && <p className="mail-note">{text.lowBalance}</p>}
      </div>}
    </aside>
    <section className="mail-history"><div className="mail-heading"><h1>{text.title}<span>{mails.length}</span></h1><button className="mail-button" onClick={() => void exportMail()} disabled={!token || !mails.length}><Download size={16} />{text.export}</button></div>
      {(error || catalog?.stale || catalog?.purchaseEnabled === false) && <div className="mail-notice" role="status">{error || (catalog?.stale ? text.stale : text.unavailable)}{error && <button onClick={() => void load()}>{text.retry}</button>}</div>}
      {workspace?.purchases.filter(p => p.status !== 'DELIVERED' && p.status !== 'REFUNDED').map(p => <div key={p.id} className="mail-pending" role="status"><strong>{p.serviceName} × {p.quantity}</strong><p>{p.status === 'REQUESTING' ? text.pending : text.review}</p><small>{text.requestCode}: {p.id}</small></div>)}
      <div className="mail-toolbar"><div className="mail-filters" role="group" aria-label={text.status}>{(['all', 'waiting', 'received', 'closed'] as const).map(f => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{text[f]}<span>{f === 'all' ? mails.length : mails.filter(m => status(m) === f).length}</span></button>)}</div><label className="mail-search"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} aria-label={text.search} placeholder={text.search} /></label></div>
      <div className="mail-table-heading"><span>{text.address}</span><span>{text.codes}</span><span>{text.status}</span></div>
      <div className="mail-table" data-mail-scroll>{shown.map(m => <article key={m.id} className="mail-row"><div className="mail-address"><div><span>{m.email}</span><button className="mail-icon" aria-label={`${text.copyMail} ${m.email}`} onClick={() => void copy(m.email)}><Copy size={14} /></button></div><p>{m.service} <span>{display(m)} {text.perMail}</span></p></div><div className="mail-row-codes">{m.codes[0] ? <><button className="mail-code latest" aria-label={`${text.copyCode} ${m.codes[0].code}`} onClick={() => void copy(m.codes[0].code)}><span>{m.codes[0].code}</span><Copy size={13} /></button><OldCodePopover mailbox={m} /></> : <span className="mail-waiting"><Clock3 size={13} />{text.noCodes}</span>}</div><div className="mail-status"><span>{m.closed ? <CircleSlash size={13} /> : m.codes.length ? <Check size={13} /> : <Clock3 size={13} />}{m.closed ? text.closed : m.codes[0] && Date.now() - new Date(m.codes[0].receivedAt).getTime() < 9000 ? text.newCode : m.codes.length ? text.received : text.waiting}</span>{!m.closed && m.canRead && <button onClick={() => setConfirm(m)}>{text.close}</button>}{m.pollFailed && <small>{text.readFailed}</small>}{!m.canRead && <small>{text.readUnsupported}</small>}</div></article>)}
        {!shown.length && <div className="mail-empty"><Mail size={28} /><h3>{query ? text.noResult : token ? text.empty : text.login}</h3><p>{text.emptyHint}</p>{!token && <Link className="mail-button" href="/login">{text.login}</Link>}</div>}
        {workspace?.nextCursor && <button className="mail-button" onClick={() => void loadMore()}>{text.loadMore}</button>}
      </div>
    </section>
    {notice && <div className="mail-toast" role="status">{notice}</div>}
    <dialog ref={dialog} className="mail-confirm" onCancel={e => { if (busy) e.preventDefault(); else setConfirm(null); }} onClose={() => setConfirm(null)}><h2>{confirm === 'rent' ? text.confirmTitle : text.closeTitle}</h2><p>{confirm === 'rent' ? text.confirmHint : text.closeHint}</p>{confirm === 'rent' && <div className="mail-confirm-total"><span>{product?.name} × {quantity}</span><strong>{product && validQuantity ? display(product, quantity) : priceUsdt(0).primary}</strong></div>}{error && <p role="alert">{error}</p>}<footer><button className="mail-button" disabled={busy} onClick={() => setConfirm(null)}>{text.cancel}</button><button className="mail-primary" disabled={busy} onClick={() => void (confirm === 'rent' ? submit() : stop())}>{busy ? text.loading : confirm === 'rent' ? text.rent : text.close}</button></footer></dialog>
  </div>;
}
