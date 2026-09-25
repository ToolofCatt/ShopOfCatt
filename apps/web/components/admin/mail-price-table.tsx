'use client';
import { Check, CheckSquare, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AdminMailOfferDto, MailOfferPriceInput } from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { Button, Card, Input } from '@/components/ui';
import { filterMailOffers, offerDraft, parseMailPriceInput, priceBucket, type MailOfferDraft, type MailPricingMode } from '@/lib/mail-price-editor';

interface Props { offers: AdminMailOfferDto[]; token: string; canSync: boolean; syncing: boolean; sync: () => void; reload: () => Promise<void> }
const selectClass = 'min-h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-neutral-950';
export function MailPriceTable({ offers, token, canSync, syncing, sync, reload }: Props) {
  const { t } = useI18n(), text = t.mail;
  const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [active, setActive] = useState(''), [stock, setStock] = useState(''), [mode, setMode] = useState('');
  const [priceField, setPriceField] = useState<'cost' | 'sale'>('sale'), [price, setPrice] = useState('');
  const [selected, setSelected] = useState<string[]>([]), [drafts, setDrafts] = useState<Record<string, MailOfferDraft>>({}), [saving, setSaving] = useState<string[]>([]), [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [bulkMode, setBulkMode] = useState<MailPricingMode>('VND'), [bulkAmount, setBulkAmount] = useState(''), [bulkOpen, setBulkOpen] = useState(false), [notice, setNotice] = useState('');
  const [bulkError, setBulkError] = useState('');
  const lock = useRef(new Set<string>()), dialog = useRef<HTMLDialogElement>(null);
  const filters = { query, category, active, stock, mode, price, priceField };
  const shown = filterMailOffers(offers, filters), candidates = filterMailOffers(offers, filters, true);
  const buckets = [...candidates.reduce((map, offer) => { const key = priceBucket(offer, priceField); map.set(key, (map.get(key) ?? 0) + 1); return map; }, new Map<string, number>())].sort(([a], [b]) => a.split(':')[0].localeCompare(b.split(':')[0]) || Number(a.split(':')[1]) - Number(b.split(':')[1]));
  const format = (value: string, currency: string) => `${Number(value).toLocaleString(currency === 'VND' ? 'vi-VN' : 'en-US', { maximumFractionDigits: currency === 'VND' ? 0 : 6 })} ${currency === 'VND' ? '₫' : 'USDT'}`;
  const updateDraft = (offer: AdminMailOfferDto, changes: Partial<MailOfferDraft>) => setDrafts(old => ({ ...old, [offer.code]: { ...(old[offer.code] ?? offerDraft(offer)), ...changes } }));
  const changeMode = (offer: AdminMailOfferDto, next: MailPricingMode) => {
    const current = drafts[offer.code] ?? offerDraft(offer);
    // Đổi đơn vị không giữ nguyên3000 rồi biến thành3000USDT; yêu cầu nhập lại có chủ ý.
    updateDraft(offer, { mode: next, amount: next === current.mode ? current.amount : next === 'AUTO' ? offer.priceAmount : '' });
  };
  const save = async (offer: AdminMailOfferDto) => {
    const draft = drafts[offer.code]; if (!draft || lock.current.has(offer.code)) return;
    const amount = draft.mode === 'AUTO' ? null : parseMailPriceInput(draft.amount, draft.mode);
    if (draft.mode !== 'AUTO' && !amount) { setRowErrors(old => ({ ...old, [offer.code]: text.invalidPrice })); return; }
    lock.current.add(offer.code); setSaving([...lock.current]); setRowErrors(old => ({ ...old, [offer.code]: '' }));
    const body: MailOfferPriceInput = { active: draft.active, ...(draft.mode === 'AUTO' ? { useMultiplier: true } : { useMultiplier: false, saleCurrency: draft.mode, saleAmount: amount! }) };
    try {
      await apiFetch(`/admin/mail/offers/${encodeURIComponent(offer.code)}`, { token, method: 'PATCH', body }); await reload();
      setDrafts(old => { const next = { ...old }; delete next[offer.code]; return next; }); setNotice(`${offer.name}: ${text.saved}`);
    } catch (e) { setRowErrors(old => ({ ...old, [offer.code]: apiErrorMessage(e, text.connectionError) })); }
    finally { lock.current.delete(offer.code); setSaving([...lock.current]); }
  };
  const toggleSelection = (code: string) => setSelected(old => old.includes(code) ? old.filter(c => c !== code) : [...old, code]);
  const normalizedBulk = bulkMode === 'AUTO' ? null : parseMailPriceInput(bulkAmount, bulkMode);
  const selectedVisible = shown.filter(o => selected.includes(o.code));
  const bulkBusy = saving.includes('__bulk');
  useEffect(() => { if (bulkOpen) dialog.current?.showModal(); else dialog.current?.close(); }, [bulkOpen]);
  const applyBulk = async () => {
    if (!selected.length || (bulkMode !== 'AUTO' && !normalizedBulk) || lock.current.has('__bulk')) return;
    lock.current.add('__bulk'); setSaving([...lock.current]); setBulkError('');
    try {
      await apiFetch('/admin/mail/offers', { token, method: 'PATCH', body: { codes: selected, changes: bulkMode === 'AUTO' ? { useMultiplier: true } : { useMultiplier: false, saleCurrency: bulkMode, saleAmount: normalizedBulk } } });
      await reload(); setDrafts(old => Object.fromEntries(Object.entries(old).filter(([code]) => !selected.includes(code)))); setNotice(`${text.saved}: ${selected.length} ${text.services}`); setSelected([]); setBulkOpen(false);
    } catch (e) { setBulkError(apiErrorMessage(e, text.connectionError)); }
    finally { lock.current.delete('__bulk'); setSaving([...lock.current]); }
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="relative min-w-60 flex-1 sm:max-w-sm"><Search size={16} className="pointer-events-none absolute left-3 top-3 text-neutral-500" /><Input className="pl-9" value={query} onChange={e => setQuery(e.target.value)} placeholder={text.serviceSearch} aria-label={text.serviceSearch} /></label><Button variant="outline" loading={syncing} disabled={!canSync || saving.length > 0} onClick={sync}><RefreshCw size={15} />{text.sync}</Button></div>
    <div className="flex flex-wrap gap-2">
      <select className={selectClass} value={category} onChange={e => setCategory(e.target.value)} aria-label={text.categoryFilter}><option value="">{text.allCategories}</option><option value="gmail-api">Gmail</option><option value="gmail-account">Gmail Account</option></select>
      <select className={selectClass} value={mode} onChange={e => setMode(e.target.value)} aria-label={text.pricingFilter}><option value="">{text.allPricing}</option><option value="AUTO">{text.automatic}</option><option value="VND">{text.fixed} VND</option><option value="USDT">{text.fixed} USDT</option></select>
      <select className={selectClass} value={active} onChange={e => setActive(e.target.value)} aria-label={text.status}><option value="">{text.allStatuses}</option><option value="on">{text.active}</option><option value="off">{text.disabled}</option></select>
      <select className={selectClass} value={stock} onChange={e => setStock(e.target.value)} aria-label={text.stock}><option value="">{text.allStock}</option><option value="in">{text.inStock}</option><option value="out">{text.outOfStock}</option></select>
      <select className={selectClass} value={priceField} onChange={e => { setPriceField(e.target.value as 'cost' | 'sale'); setPrice(''); }} aria-label={text.priceFilter}><option value="sale">{text.salePrice}</option><option value="cost">{text.cost}</option></select>
      <select className={selectClass + ' min-w-40'} value={price} onChange={e => setPrice(e.target.value)} aria-label={text.priceLevel}><option value="">{text.allPriceLevels} ({buckets.length})</option>{buckets.map(([key, count]) => { const [currency, amount] = key.split(':'); return <option key={key} value={key}>{format(amount, currency)} ({count})</option>; })}</select>
      {(query || category || mode || active || stock || price) && <button className="inline-flex items-center gap-1 px-2 text-xs text-neutral-600 underline underline-offset-4" onClick={() => { setQuery(''); setCategory(''); setMode(''); setActive(''); setStock(''); setPrice(''); }}><X size={14} />{text.clearFilters}</button>}
    </div>
    <div className="flex flex-wrap justify-between gap-2 text-xs text-neutral-600"><span>{shown.length} / {offers.length} {text.services} · {buckets.length} {text.priceLevels}</span><span>{text.quickSaveHint}</span></div>
    {notice && <p role="status" className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm">{notice}</p>}
    {selected.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-300 bg-white p-4"><CheckSquare size={18} /><strong className="text-sm">{text.selected}: {selected.length}</strong><span className="text-xs text-neutral-500">{selected.length - selectedVisible.length > 0 ? `${selected.length - selectedVisible.length} ${text.hiddenSelected}` : ''}</span><select className={selectClass} value={bulkMode} onChange={e => { setBulkMode(e.target.value as MailPricingMode); setBulkAmount(''); }} aria-label={text.bulkMode}><option value="VND">VND</option><option value="USDT">USDT</option><option value="AUTO">{text.automatic}</option></select>{bulkMode !== 'AUTO' && <Input className="max-w-40" value={bulkAmount} onChange={e => setBulkAmount(e.target.value)} placeholder={bulkMode === 'VND' ? '3k' : '0.15'} aria-label={text.bulkPrice} />}<Button disabled={saving.length > 0 || selected.length > 200 || (bulkMode !== 'AUTO' && !normalizedBulk)} onClick={() => setBulkOpen(true)}>{text.applySelected}</Button><button className="text-xs underline" onClick={() => setSelected([])}>{text.clearSelection}</button></div>}
    <Card className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="border-b bg-neutral-50 text-xs text-neutral-600"><tr><th className="px-3 py-3"><input type="checkbox" className="accent-black" aria-label={text.selectVisible} checked={shown.length > 0 && shown.every(o => selected.includes(o.code))} onChange={e => setSelected(old => e.target.checked ? [...new Set([...old, ...shown.map(o => o.code)])] : old.filter(code => !shown.some(o => o.code === code)))} /></th>{[text.service, text.cost + ' (USDT)', text.salePrice, text.stock, text.active, ''].map((h, i) => <th key={i} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{shown.map(offer => {
      const draft = drafts[offer.code] ?? offerDraft(offer), dirty = drafts[offer.code] !== undefined, savingRow = saving.includes(offer.code) || bulkBusy;
      return <tr key={offer.code} className="border-b border-neutral-100" data-mail-offer={offer.code}><td className="px-3 py-3"><input type="checkbox" className="accent-black" checked={selected.includes(offer.code)} onChange={() => toggleSelection(offer.code)} aria-label={`${text.selectService} ${offer.name}`} /></td><td className="px-3 py-3"><strong className="font-medium">{offer.name}</strong><small className="mt-1 block text-xs text-neutral-500">{offer.category === 'gmail-api' ? 'Gmail' : 'Gmail Account'}</small></td><td className="px-3 py-3 font-mono text-xs tabular-nums">{offer.cost}</td><td className="px-3 py-3"><div className="flex gap-2"><select className={selectClass + ' w-32'} value={draft.mode} disabled={savingRow} onChange={e => changeMode(offer, e.target.value as MailPricingMode)} aria-label={`${text.priceUnit} ${offer.name}`}><option value="AUTO">{text.automatic}</option><option value="VND">VND</option><option value="USDT">USDT</option></select><Input className="w-32" value={draft.mode === 'AUTO' ? offer.price : draft.amount} disabled={draft.mode === 'AUTO' || savingRow} inputMode="decimal" placeholder={draft.mode === 'VND' ? '3k' : '0.15'} aria-label={`${text.salePrice} ${offer.name}`} onChange={e => updateDraft(offer, { amount: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save(offer); } else if (e.key === 'Escape') setDrafts(old => { const next = { ...old }; delete next[offer.code]; return next; }); }} /></div><small className="mt-1.5 block text-xs text-neutral-500">{draft.mode === 'VND' && parseMailPriceInput(draft.amount, 'VND') ? `${format(parseMailPriceInput(draft.amount, 'VND')!, 'VND')} · ${text.anchorHint}` : format(offer.price, 'USDT')}{draft.mode === 'AUTO' ? ` · ${text.automatic}` : ''}</small>{rowErrors[offer.code] && <p role="alert" className="mt-1 text-xs text-red-700">{rowErrors[offer.code]}</p>}</td><td className="px-3 py-3 tabular-nums">{offer.stock.toLocaleString()}</td><td className="px-3 py-3"><input type="checkbox" className="accent-black" checked={draft.active} disabled={savingRow} onChange={e => updateDraft(offer, { active: e.target.checked })} aria-label={`${text.active} ${offer.name}`} /></td><td className="px-3 py-3"><Button size="sm" variant="outline" loading={savingRow} disabled={!dirty || savingRow} onClick={() => void save(offer)}><Check size={14} />{text.save}</Button></td></tr>;
    })}</tbody></table>{!shown.length && <p className="p-8 text-center text-sm text-neutral-500">{offers.length ? text.noResult : text.never}</p>}</Card>
    <dialog ref={dialog} className="m-auto w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 backdrop:bg-black/40" onCancel={e => { if (bulkBusy) e.preventDefault(); else setBulkOpen(false); }}><h2 className="text-xl font-semibold">{text.confirmBulk}</h2><p className="mt-3 text-sm text-neutral-600">{text.selected}: <strong>{selected.length}</strong> {text.services}</p><p className="my-5 text-lg font-semibold">{bulkMode === 'AUTO' ? text.automatic : normalizedBulk ? format(normalizedBulk, bulkMode) : ''}</p><>{bulkError && <p role="alert" className="mb-4 text-sm text-red-700">{bulkError}</p>}</><div className="flex justify-end gap-3"><Button variant="outline" disabled={bulkBusy} onClick={() => setBulkOpen(false)}>{text.cancel}</Button><Button loading={bulkBusy} onClick={() => void applyBulk()}>{text.applySelected}</Button></div></dialog>
  </div>;
}
