'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdminMailOfferDto, AdminMailPurchaseDto, MailCatalogDto, MailProviderSettingDto } from '@webcatt/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { Button, Card, Field, Input, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/admin/page-header';
import { MailPriceTable } from '@/components/admin/mail-price-table';
import { MailRounding } from '@/components/admin/mail-rounding';

export default function AdminMailPage() {
  const { token, user } = useAuth(), { t } = useI18n(), text = t.mail;
  const [tab, setTab] = useState<'catalog' | 'connection' | 'orders'>('catalog');
  const [setting, setSetting] = useState<MailProviderSettingDto | null>(null), [offers, setOffers] = useState<AdminMailOfferDto[]>([]), [orders, setOrders] = useState<AdminMailPurchaseDto[]>([]);
  const [tokenValue, setTokenValue] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [refund, setRefund] = useState<AdminMailPurchaseDto | null>(null), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const owner = user?.role === 'SUPERADMIN';
  const refundDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (refund) refundDialog.current?.showModal(); else refundDialog.current?.close(); }, [refund]);
  const load = useCallback(async (includeSettings = false) => {
    if (!token) return;
    const [catalog, purchases, config] = await Promise.all([apiFetch<MailCatalogDto & { offers: AdminMailOfferDto[] }>('/admin/mail/offers', { token }), apiFetch<AdminMailPurchaseDto[]>('/admin/mail/purchases', { token }), includeSettings ? apiFetch<MailProviderSettingDto>('/admin/mail/settings', { token }) : Promise.resolve(null)]);
    setOffers(catalog.offers); setOrders(purchases); if (config) setSetting(config);
  }, [token]);
  useEffect(() => { void load(true).catch(e => setError(apiErrorMessage(e, text.connectionError))); }, [load, text.connectionError]);
  const action = async (fn: () => Promise<unknown>, message = text.saved) => { setBusy(true); setError(''); setNotice(''); try { await fn(); await load(); setNotice(message); } catch (e) { setError(apiErrorMessage(e, text.connectionError)); } finally { setBusy(false); } };
  const saveSettings = () => action(async () => {
    if (!setting) return;
    const next = await apiFetch<MailProviderSettingDto>('/admin/mail/settings', { token, method: 'PATCH', body: { enabled: setting.enabled, currencyConfirmed: setting.currencyConfirmed, multiplier: setting.multiplier, maxOrderCost: setting.maxOrderCost, maxDailyCost: setting.maxDailyCost, ...(tokenValue.trim() ? { token: tokenValue.trim() } : {}) } });
    setSetting(next); setTokenValue('');
  });
  return <>
    <PageHeader title={text.adminTitle} />
    <nav className="mb-6 flex gap-5 overflow-x-auto border-b border-neutral-200" aria-label={text.adminTitle}>{(['catalog', 'connection', 'orders'] as const).map(key => <button key={key} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined} className={`min-h-12 shrink-0 border-b-2 text-sm ${tab === key ? 'border-neutral-950 font-semibold' : 'border-transparent text-neutral-600'}`}>{text[key]}</button>)}</nav>
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-lg border border-neutral-200 bg-white p-3 text-sm">{notice}</p>}
    {tab === 'connection' && <Card className="max-w-2xl p-6"><h2 className="mb-2 text-lg font-semibold">{text.connection}</h2><p className="mb-6 text-sm leading-6 text-neutral-600">{text.setupHint}</p>{!owner && <p className="mb-4 text-sm">{text.superadminOnly}</p>}{setting ? <form className="space-y-5" onSubmit={e => { e.preventDefault(); void saveSettings(); }}>
      <Field htmlFor="mail-setting-token" label={text.token} hint={`${text.tokenHint}${setting.tokenSet ? ` (…${setting.tokenSuffix})` : ''}`}><Input id="mail-setting-token" type="password" value={tokenValue} onChange={e => setTokenValue(e.target.value)} disabled={!owner || busy} autoComplete="new-password" /></Field>
      <Field htmlFor="mail-setting-multiplier" label={text.multiplier}><Input id="mail-setting-multiplier" value={setting.multiplier} onChange={e => setSetting({ ...setting, multiplier: e.target.value })} disabled={!owner || busy} inputMode="decimal" /></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field htmlFor="mail-setting-maxOrder" label={text.maxOrder}><Input id="mail-setting-maxOrder" value={setting.maxOrderCost} onChange={e => setSetting({ ...setting, maxOrderCost: e.target.value })} disabled={!owner || busy} inputMode="decimal" /></Field><Field htmlFor="mail-setting-maxDaily" label={text.maxDaily}><Input id="mail-setting-maxDaily" value={setting.maxDailyCost} onChange={e => setSetting({ ...setting, maxDailyCost: e.target.value })} disabled={!owner || busy} inputMode="decimal" /></Field></div>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-black" checked={setting.currencyConfirmed} disabled={!owner || busy} onChange={e => setSetting({ ...setting, currencyConfirmed: e.target.checked })} />{text.currency}</label>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="accent-black" checked={setting.enabled} disabled={!owner || busy} onChange={e => setSetting({ ...setting, enabled: e.target.checked })} />{text.enabled}</label>
      <p className="text-xs text-neutral-500">{text.syncTime}: {setting.syncedAt ? new Date(setting.syncedAt).toLocaleString() : text.never}</p><Button type="submit" loading={busy} disabled={!owner}>{text.save}</Button>
    </form> : <Spinner />}</Card>}
    {tab === 'catalog' && token && <>{setting && <MailRounding setting={setting} token={token} canEdit={owner && !busy} onSaved={async next => { setSetting(next); await load(); }} />}<MailPriceTable offers={offers} token={token} canSync={owner} syncing={busy} reload={() => load()} sync={() => void action(async () => { await apiFetch('/admin/mail/sync', { token, method: 'POST' }); })} /></>}
    {tab === 'orders' && <Card className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b bg-neutral-50 text-xs text-neutral-500"><tr>{[text.service, text.customer, text.total, text.cost, text.status, text.providerOrder, ''].map((h, i) => <th className="px-4 py-3 font-medium" key={i}>{h}</th>)}</tr></thead><tbody>{orders.map(order => <tr key={order.id} className="border-b border-neutral-100"><td className="p-4">{order.serviceName} × {order.quantity}<small className="mt-1 block max-w-56 break-all text-xs text-neutral-500">{order.id}</small></td><td className="p-4">#{order.userCode}</td><td className="p-4">{order.total} USDT</td><td className="p-4">{order.actualCost ?? order.expectedCost}</td><td className="p-4">{order.status}</td><td className="p-4">{order.providerOrderNo ?? '—'}</td><td className="p-4">{owner && order.status === 'REVIEW' && <Button size="sm" variant="outline" onClick={() => { setRefund(order); setReason(''); setConfirmed(false); }}>{text.refund}</Button>}</td></tr>)}</tbody></table></Card>}
    <dialog ref={refundDialog} aria-labelledby="mail-refund-title" className="m-auto w-full max-w-lg rounded-lg bg-white p-0 backdrop:bg-black/40" onCancel={e => { if (busy) e.preventDefault(); else setRefund(null); }}>{refund && <Card className="w-full max-w-lg space-y-5 p-6"><h2 id="mail-refund-title" className="text-xl font-semibold">{text.refund}: {refund.total} USDT</h2><Field label={text.refundReason}><Input value={reason} onChange={e => setReason(e.target.value)} /></Field><label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />{text.refundConfirm}</label><div className="flex justify-end gap-3"><Button variant="outline" disabled={busy} onClick={() => setRefund(null)}>{text.cancel}</Button><Button loading={busy} disabled={!confirmed || reason.trim().length < 10} onClick={() => void action(async () => { await apiFetch(`/admin/mail/purchases/${refund.id}/refund`, { token, body: { confirmedNoDelivery: confirmed, reason } }); setRefund(null); }, text.refundedNotice)}>{text.refund}</Button></div></Card>}</dialog>
  </>;
}
