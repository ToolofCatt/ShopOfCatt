'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { API_KEY_MAX_ACTIVE, formatUserCode, type AccountApiDto, type ApiKeyDto, type CreatedApiKeyDto } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { apiKeyStatus, initialKeyCreation, isUnknownKeyCreation, keyCreationReducer } from '@/lib/api-key';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { ApiConfirmDialog, ApiKeyForm, ApiKeyList, ApiSecretDialog, type ApiKeyInput } from '@/components/api-key-management';
import { SupportPanel } from '@/components/support-panel';
import { Badge, Button, Card } from '@/components/ui';

export default function AccountApiPage() {
  const { token, user, loading } = useAuth();
  const { t: { partnerApi: p } } = useI18n();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !token) router.replace(`/login?next=${encodeURIComponent('/account/api')}`);
  }, [loading, token, router]);
  if (loading) return <div role="status" className="mx-auto max-w-4xl px-4 py-12">{p.loading}</div>;
  if (!token || !user) return <div className="mx-auto max-w-4xl px-4 py-12"><Link href="/login?next=%2Faccount%2Fapi" className="inline-flex min-h-11 items-center underline">{p.login}</Link></div>;
  // Đổi phiên đăng nhập phải bỏ cả state khóa bí mật, không dùng lại màn hình của chủ cũ.
  return <AccountApiContent key={token} token={token} customerCode={user.code} />;
}

function AccountApiContent({ token, customerCode }: { token: string; customerCode: number }) {
  const { t: { partnerApi: p }, formatDate } = useI18n();
  const [data, setData] = useState<AccountApiDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creation, dispatch] = useReducer(keyCreationReducer, initialKeyCreation);
  const [revoke, setRevoke] = useState<ApiKeyDto | null>(null);
  const [revoking, setRevoking] = useState(false);
  const alive = useRef(false);
  const epoch = useRef(0);
  const requestBusy = useRef(false);
  const loadSequence = useRef(0);
  const createTrigger = useRef<HTMLElement | null>(null);
  const keysHeading = useRef<HTMLHeadingElement | null>(null);

  const load = useCallback(async (resolveUncertain = false) => {
    const sequence = ++loadSequence.current;
    setLoading(true); setLoadError(null);
    try {
      const next = await apiFetch<AccountApiDto>('/account/api-keys', { token });
      if (!alive.current || sequence !== loadSequence.current) return;
      setData(next);
      if (resolveUncertain) dispatch({ type: 'metadataReloaded' });
    } catch (err) {
      if (alive.current && sequence === loadSequence.current) setLoadError(apiErrorMessage(err, p.loadError));
    } finally { if (alive.current && sequence === loadSequence.current) setLoading(false); }
  }, [token, p.loadError]);

  useEffect(() => {
    alive.current = true;
    const discard = () => { epoch.current += 1; dispatch({ type: 'pageHidden' }); };
    window.addEventListener('pagehide', discard);
    return () => { alive.current = false; epoch.current += 1; window.removeEventListener('pagehide', discard); };
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (input: ApiKeyInput, trigger: HTMLElement | null) => {
    if (!data?.access.enabled || loading || loadError || requestBusy.current || creation.phase !== 'idle') return;
    createTrigger.current = trigger;
    requestBusy.current = true;
    const currentEpoch = epoch.current;
    dispatch({ type: 'start' }); setError(null); setNotice(null);
    try {
      // apiFetch không tự retry POST. Lỗi sau khi server tạo khóa vẫn phải coi là chưa rõ kết quả.
      const response = await apiFetch<CreatedApiKeyDto>('/account/api-keys', { token, method: 'POST', body: input });
      if (!alive.current || currentEpoch !== epoch.current) return;
      if (!response?.secret || !response.key?.id) throw new Error('Incomplete key response');
      dispatch({ type: 'created', secret: response.secret });
      setData((current) => current ? { ...current, keys: [response.key, ...current.keys.filter((key) => key.id !== response.key.id)] } : current);
    } catch (err) {
      if (!alive.current || currentEpoch !== epoch.current) return;
      if (isUnknownKeyCreation(err)) dispatch({ type: 'unknown' });
      else { dispatch({ type: 'failed' }); setError(apiErrorMessage(err, p.actionError)); }
    } finally { requestBusy.current = false; }
  };

  const confirmRevoke = async () => {
    if (!revoke || requestBusy.current) return;
    requestBusy.current = true; setRevoking(true); setError(null); setNotice(null);
    try {
      await apiFetch(`/account/api-keys/${encodeURIComponent(revoke.id)}`, { token, method: 'DELETE' });
      if (!alive.current) return;
      setNotice(p.revokeSuccess); setRevoke(null); await load();
    } catch (err) {
      if (alive.current) { setError(apiErrorMessage(err, p.actionError)); setRevoke(null); await load(); }
    } finally { requestBusy.current = false; if (alive.current) setRevoking(false); }
  };

  const activeCount = data?.keys.filter((key) => apiKeyStatus(key, Date.now()) === 'active').length ?? 0;
  const quotaReached = activeCount >= API_KEY_MAX_ACTIVE;
  return <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-neutral-500">{p.nav}</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">{p.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">{p.subtitle}</p><Link href="/docs/api" className="mt-2 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{p.docsNav}</Link></header>
    {loading && <p role="status" className="animate-pulse rounded-lg bg-neutral-100 p-4 text-sm">{p.loading}</p>}
    {loadError && <div role="alert" className="space-y-3 rounded-lg border border-red-200 p-4 text-sm text-red-700"><p>{loadError}</p><Button variant="outline" className="min-h-11" onClick={() => void load(true)}>{p.retry}</Button></div>}
    {data && <>
      <Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{p.accessTitle}</h2><Badge variant={data.access.enabled ? 'solid' : 'muted'}>{data.access.enabled ? p.enabled : p.disabled}</Badge></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-neutral-500">{p.balance}</dt><dd className="mt-1 break-all font-mono font-medium tabular-nums">{data.balance} {data.currency}</dd></div><div><dt className="text-neutral-500">{p.approvedAt}</dt><dd className="mt-1">{formatDate(data.access.approvedAt)}</dd></div><div><dt className="text-neutral-500">{p.disabledAt}</dt><dd className="mt-1">{formatDate(data.access.disabledAt)}</dd></div></dl>
      </Card>
      {!data.access.enabled && <SupportPanel reference={formatUserCode(customerCode)} hint={p.approvalHint} />}
      <section aria-labelledby="api-keys-title" className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 ref={keysHeading} id="api-keys-title" tabIndex={-1} className="text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950">{p.keysTitle}</h2><p className="mt-1 max-w-xl text-sm leading-6 text-neutral-600">{p.keyLimits}</p></div><Button variant="outline" className="min-h-11" disabled={loading || revoking || creation.phase === 'creating' || creation.phase === 'revealed'} onClick={() => void load(true)}>{p.reloadMetadata}</Button></div>
        {error && <p role="alert" className="rounded-lg border border-red-200 p-4 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="text-sm text-neutral-700">{notice}</p>}
        {creation.phase === 'uncertain' && <div role="alert" className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p>{p.uncertainCreate}</p><Button variant="outline" className="min-h-11" disabled={loading} onClick={() => void load(true)}>{p.reloadMetadata}</Button></div>}
        <ApiKeyList keys={data.keys} canRevoke={!loading && !loadError && !revoking && creation.phase !== 'creating'} onRevoke={setRevoke} />
        {quotaReached && <p role="status" className="text-sm text-neutral-600">{p.quotaReached}</p>}
        <Card className="p-5"><ApiKeyForm disabled={!data.access.enabled || quotaReached || loading || !!loadError || revoking || creation.phase !== 'idle'} busy={creation.phase === 'creating'} onCreate={(input, trigger) => void create(input, trigger)} /></Card>
      </section>
    </>}
    {creation.secret && <ApiSecretDialog secret={creation.secret} onDiscard={() => dispatch({ type: 'discard' })} returnFocusTo={createTrigger.current} fallbackFocusTo={keysHeading.current} />}
    {revoke && <ApiConfirmDialog title={p.revokeTitle} hint={`${revoke.name} — ${p.revokeHint}`} busy={revoking} onClose={() => setRevoke(null)} onConfirm={() => void confirmRevoke()} />}
  </div>;
}
