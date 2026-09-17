'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { formatUserCode, isAdminRole, type ApiAccountDto, type ApiKeyDto, type Paginated } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { ApiAccessActions, ApiConfirmDialog, ApiKeyList } from '@/components/api-key-management';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { Badge, Button, Card, Field, Input } from '@/components/ui';

export default function AdminApiPage() {
  const { user, token, loading } = useAuth();
  const { t: { partnerApi: p } } = useI18n();
  if (loading) return <p role="status">{p.loading}</p>;
  if (!user || !token || !isAdminRole(user.role)) return <p role="alert">{p.forbidden}</p>;
  return <AdminApiContent key={token} token={token} role={user.role} />;
}

function AdminApiContent({ token, role }: { token: string; role: string }) {
  const { t: { partnerApi: p }, formatDate } = useI18n();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<ApiAccountDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<ApiAccountDto | null>(null);
  const [keys, setKeys] = useState<ApiKeyDto[] | null>(null);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [change, setChange] = useState<ApiAccountDto | null>(null);
  const [revoke, setRevoke] = useState<ApiKeyDto | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const actionBusy = useRef(false);
  const listSequence = useRef(0);
  const keySequence = useRef(0);
  const limit = 20;

  const load = useCallback(async () => {
    const sequence = ++listSequence.current;
    setLoading(true); setLoadError(null);
    try {
      const result = await apiFetch<Paginated<ApiAccountDto>>(`/admin/api/accounts?${new URLSearchParams({ q: query, page: String(page), limit: String(limit) })}`, { token });
      if (alive.current && sequence === listSequence.current) setData(result);
    } catch (err) { if (alive.current && sequence === listSequence.current) setLoadError(apiErrorMessage(err, p.loadError)); }
    finally { if (alive.current && sequence === listSequence.current) setLoading(false); }
  }, [query, page, token, p.loadError]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; listSequence.current += 1; keySequence.current += 1; }; }, []);
  useEffect(() => { setSelected(null); setKeys(null); keySequence.current += 1; void load(); }, [load]);

  const loadKeys = async (account: ApiAccountDto) => {
    const sequence = ++keySequence.current;
    setSelected(account); setKeys(null); setKeysError(null); setKeysLoading(true);
    try {
      const result = await apiFetch<ApiKeyDto[]>(`/admin/api/accounts/${encodeURIComponent(account.userId)}/keys`, { token });
      if (alive.current && sequence === keySequence.current) setKeys(result);
    } catch (err) { if (alive.current && sequence === keySequence.current) setKeysError(apiErrorMessage(err, p.loadError)); }
    finally { if (alive.current && sequence === keySequence.current) setKeysLoading(false); }
  };

  const confirm = async () => {
    if (role !== 'SUPERADMIN' || actionBusy.current || (!change && !revoke)) return;
    actionBusy.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      if (change) await apiFetch(`/admin/api/accounts/${encodeURIComponent(change.userId)}`, { method: 'PATCH', token, body: { enabled: !change.access.enabled } });
      else if (revoke) await apiFetch(`/admin/api/keys/${encodeURIComponent(revoke.id)}`, { method: 'DELETE', token });
      if (!alive.current) return;
      setNotice(change ? p.accessUpdated : p.revokeSuccess);
      setChange(null); setRevoke(null); setSelected(null); setKeys(null); keySequence.current += 1;
      await load();
    } catch (err) {
      if (alive.current) {
        setError(apiErrorMessage(err, p.actionError)); setChange(null); setRevoke(null); setSelected(null); setKeys(null); keySequence.current += 1;
        await load();
      }
    } finally { actionBusy.current = false; if (alive.current) setBusy(false); }
  };

  const submitSearch = (event: FormEvent) => { event.preventDefault(); setPage(1); setQuery(search.trim()); };
  return <div className="min-w-0 space-y-5">
    <PageHeader title={p.adminTitle} description={p.adminSubtitle} actions={<Link href="/docs/api" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{p.docsNav}</Link>} />
    {role !== 'SUPERADMIN' && <p className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-600">{p.adminReadonly}</p>}
    <form onSubmit={submitSearch} className="flex flex-wrap items-end gap-3"><Field htmlFor="api-account-search" label={p.search} className="min-w-0 flex-1"><Input id="api-account-search" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} className="min-h-11" type="search" /></Field><Button className="min-h-11" type="submit" disabled={busy}>{p.searchButton}</Button></form>
    {error && <p role="alert" className="rounded-lg border border-red-200 p-4 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {loading && <p role="status" className="animate-pulse rounded-lg bg-neutral-100 p-5 text-sm">{p.loading}</p>}
    {loadError && <div role="alert" className="space-y-3 text-sm text-red-700"><p>{loadError}</p><Button variant="outline" className="min-h-11" onClick={() => void load()}>{p.retry}</Button></div>}
    {!loading && !loadError && data && <>
      {data.items.length === 0 ? <Card className="p-6 text-sm text-neutral-600">{p.emptyAccounts}</Card> : <ul className="space-y-3">{data.items.map((account) => <li key={account.userId}><Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-semibold">{account.name} <span className="font-mono text-sm text-neutral-500">{formatUserCode(account.code)}</span></h2>{account.email && <p className="mt-1 break-all text-sm text-neutral-600">{account.email}</p>}</div><div className="flex flex-wrap gap-2"><Badge variant={account.access.enabled ? 'solid' : 'muted'}>{account.access.enabled ? p.enabled : p.disabled}</Badge>{account.locked && <Badge variant="outline">{p.locked}</Badge>}</div></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-neutral-500">{p.activeKeys}</dt><dd className="tabular-nums">{account.activeKeys}</dd></div><div><dt className="text-neutral-500">{p.approvedAt}</dt><dd>{formatDate(account.access.approvedAt)}</dd></div><div><dt className="text-neutral-500">{p.disabledAt}</dt><dd>{formatDate(account.access.disabledAt)}</dd></div></dl>
        <div className="flex flex-wrap gap-3"><Button variant="outline" className="min-h-11" disabled={busy} onClick={() => void loadKeys(account)}>{p.viewKeys}</Button><ApiAccessActions account={account} role={role} onChange={(next) => { if (!busy) setChange(next); }} /></div>
      </Card></li>)}</ul>}
      <Pagination page={page} total={data.total} limit={limit} onPageChange={(next) => { if (!busy) setPage(next); }} />
    </>}
    {selected && <section aria-labelledby="account-key-metadata" className="space-y-4 rounded-lg border border-neutral-300 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="account-key-metadata" className="min-w-0 break-words font-semibold">{p.viewKeys} — {formatUserCode(selected.code)}</h2><Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => { keySequence.current += 1; setSelected(null); setKeys(null); }}>{p.close}</Button></div>
      {keysLoading && <p role="status" className="text-sm">{p.loading}</p>}
      {keysError && <div role="alert" className="space-y-3 text-sm text-red-700"><p>{keysError}</p><Button variant="outline" className="min-h-11" onClick={() => void loadKeys(selected)}>{p.retry}</Button></div>}
      {keys && <ApiKeyList keys={keys} canRevoke={role === 'SUPERADMIN' && !busy} onRevoke={setRevoke} />}
    </section>}
    {change && <ApiConfirmDialog title={change.access.enabled ? p.disableTitle : p.approveTitle} hint={`${formatUserCode(change.code)} — ${change.access.enabled ? p.disableHint : p.approveHint}`} busy={busy} onClose={() => setChange(null)} onConfirm={() => void confirm()} />}
    {revoke && <ApiConfirmDialog title={p.revokeTitle} hint={`${revoke.name} — ${p.revokeHint}`} busy={busy} onClose={() => setRevoke(null)} onConfirm={() => void confirm()} />}
  </div>;
}
