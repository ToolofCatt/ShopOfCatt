'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { API_KEY_DEFAULT_DAYS, API_KEY_MAX_DAYS, API_SCOPES, type ApiAccountDto, type ApiKeyDto, type ApiScope } from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { apiKeyStatus, buildApiKeyInput, DEFAULT_API_SCOPES } from '@/lib/api-key';
import { Badge, Button, Card, Field, Input } from '@/components/ui';

const scopeLabels = { 'catalog:read': 'scopeCatalog', 'wallet:read': 'scopeWallet', 'deposits:read': 'scopeDepositsRead', 'deposits:write': 'scopeDepositsWrite', 'orders:read': 'scopeOrdersRead', 'orders:write': 'scopeOrdersWrite' } as const;
export type ApiKeyInput = ReturnType<typeof buildApiKeyInput>;

export function ApiKeyForm({ disabled, busy, onCreate }: { disabled: boolean; busy: boolean; onCreate: (input: ApiKeyInput, trigger: HTMLElement | null) => void }) {
  const { t: { partnerApi: p } } = useI18n();
  const [name, setName] = useState('');
  const [days, setDays] = useState(String(API_KEY_DEFAULT_DAYS));
  const [scopes, setScopes] = useState<ApiScope[]>(() => [...DEFAULT_API_SCOPES]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState(false);
  const hasWrite = scopes.some((scope) => scope.endsWith(':write'));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || busy) return;
    try {
      const input = buildApiKeyInput(name, scopes, Number(days));
      if (hasWrite && !acknowledged) throw new Error('Write confirmation required');
      setError(false);
      // Chụp nút mở TRƯỚC khi POST làm fieldset disabled và trình duyệt bỏ focus.
      // Enter từ input vẫn quay về nút submit, không đoán activeElement sau await.
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const trigger = submitter instanceof HTMLElement ? submitter : event.currentTarget.querySelector<HTMLElement>('button[type="submit"]');
      onCreate(input, trigger);
    } catch { setError(true); }
  };
  return <form onSubmit={submit} className="space-y-4">
    <fieldset disabled={disabled || busy} className="min-w-0 space-y-4" aria-busy={busy}>
      <legend className="mb-3 font-semibold">{p.create}</legend>
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field htmlFor="api-key-name" label={p.name} hint={p.nameHint}><Input id="api-key-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoComplete="off" className="min-h-11" /></Field>
        <Field htmlFor="api-key-expiry" label={p.expiry}><Input id="api-key-expiry" type="number" min={1} max={API_KEY_MAX_DAYS} step={1} required value={days} onChange={(e) => setDays(e.target.value)} className="min-h-11" /></Field>
      </div>
      <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">{p.scopes}</legend><div className="grid gap-2 sm:grid-cols-2">
        {API_SCOPES.map((scope) => <label key={scope} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 text-sm">
          <input type="checkbox" value={scope} checked={scopes.includes(scope)} onChange={(e) => { setScopes((current) => e.target.checked ? [...current, scope] : current.filter((value) => value !== scope)); setAcknowledged(false); }} className="mt-1 h-4 w-4 shrink-0 accent-neutral-950" />
          <span className="min-w-0"><code className="block text-xs font-semibold">{scope}</code><span className="text-neutral-600">{p[scopeLabels[scope]]}</span></span>
        </label>)}
      </div></fieldset>
      {hasWrite && <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p>{p.writeWarning}</p><label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} required className="h-4 w-4 shrink-0" />{p.writeConfirm}</label>
      </div>}
      {error && <p role="alert" className="text-sm text-red-700">{p.invalidForm}</p>}
      <Button type="submit" className="min-h-11" loading={busy} disabled={hasWrite && !acknowledged}>{busy ? p.creating : p.create}</Button>
    </fieldset>
  </form>;
}

export function ApiKeyList({ keys, canRevoke, onRevoke }: { keys: ApiKeyDto[]; canRevoke: boolean; onRevoke: (key: ApiKeyDto) => void }) {
  const { t: { partnerApi: p }, formatDate } = useI18n();
  if (keys.length === 0) return <Card className="border-dashed p-6"><h3 className="font-medium">{p.emptyKeys}</h3><p className="mt-1 text-sm text-neutral-600">{p.emptyKeysHint}</p></Card>;
  return <ul className="space-y-3">{keys.map((key) => {
    const status = apiKeyStatus(key, Date.now());
    return <li key={key.id}><Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="min-w-0 break-all font-semibold">{key.name}</h3><Badge variant={status === 'active' ? 'solid' : 'muted'}>{p[status]}</Badge></div>
      <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-neutral-500">{p.prefix}</dt><dd className="break-all font-mono">{key.prefix}…</dd></div>
        <div><dt className="text-neutral-500">{p.createdAt}</dt><dd>{formatDate(key.createdAt)}</dd></div>
        <div><dt className="text-neutral-500">{p.expiresAt}</dt><dd>{formatDate(key.expiresAt)}</dd></div>
        <div><dt className="text-neutral-500">{p.lastUsedAt}</dt><dd>{key.lastUsedAt ? formatDate(key.lastUsedAt) : p.neverUsed}</dd></div>
      </dl>
      <div className="flex flex-wrap items-center gap-2"><span className="sr-only">{p.scopes}</span>{key.scopes.map((scope) => <code key={scope} className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-700">{scope}</code>)}</div>
      {canRevoke && !key.revokedAt && <Button className="min-h-11" variant="danger" onClick={() => onRevoke(key)}>{p.revoke}</Button>}
    </Card></li>;
  })}</ul>;
}

export function ApiAccessActions({ account, role, onChange }: { account: ApiAccountDto; role: string; onChange: (account: ApiAccountDto) => void }) {
  const { t: { partnerApi: p } } = useI18n();
  if (role !== 'SUPERADMIN') return null;
  return <Button variant={account.access.enabled ? 'danger' : 'outline'} className="min-h-11" disabled={account.locked && !account.access.enabled} onClick={() => onChange(account)}>{account.access.enabled ? p.disable : p.approve}</Button>;
}

export function restoreApiDialogFocus(trigger: HTMLElement | null, previous: HTMLElement | null, fallback: HTMLElement | null): void {
  const target = trigger ?? previous;
  // :disabled bao gồm cả nút nằm trong fieldset disabled; khi đủ 5 khóa thì
  // nút tạo không thể nhận focus nữa, quay về tiêu đề danh sách để tiếp tục quản lý.
  if (target?.isConnected && !target.matches(':disabled')) target.focus();
  else if (fallback?.isConnected) fallback.focus();
}

type DialogFocusReturn = { returnFocusTo?: HTMLElement | null; fallbackFocusTo?: HTMLElement | null };

function ApiDialog({ title, children, onClose, returnFocusTo = null, fallbackFocusTo = null }: { title: string; children: ReactNode; onClose: () => void } & DialogFocusReturn) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const focusReturn = useRef({ returnFocusTo, fallbackFocusTo });
  focusReturn.current = { returnFocusTo, fallbackFocusTo };
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    const discard = () => { dialog?.close(); closeRef.current(); };
    // Quay lại từ bộ nhớ trang của trình duyệt không được làm hiện lại khóa bí mật.
    window.addEventListener('pagehide', discard);
    return () => {
      window.removeEventListener('pagehide', discard);
      dialog?.close();
      // Passive cleanup chạy sau DOM commit bật lại form lúc bỏ secret.
      restoreApiDialogFocus(focusReturn.current.returnFocusTo, previous, focusReturn.current.fallbackFocusTo);
    };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]')];
    const first = controls[0], last = controls.at(-1);
    // Dialog native vẫn có thể đưa Tab lên chrome trình duyệt; giữ focus trong hộp khóa.
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-neutral-200 bg-white p-5 text-neutral-950 shadow-xl backdrop:bg-black/50 sm:p-6">
    <h2 id={titleId} className="text-lg font-semibold">{title}</h2><div className="mt-3 space-y-4">{children}</div>
  </dialog>;
}

export function ApiSecretDialog({ secret, onDiscard, returnFocusTo, fallbackFocusTo }: { secret: string | null; onDiscard: () => void } & DialogFocusReturn) {
  const { t: { partnerApi: p } } = useI18n();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const id = useId();
  if (!secret) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(secret); setCopyState('copied'); }
    catch { setCopyState('error'); }
  };
  return <ApiDialog title={p.oneTimeTitle} onClose={onDiscard} returnFocusTo={returnFocusTo} fallbackFocusTo={fallbackFocusTo}>
    <p className="text-sm leading-6 text-neutral-600">{p.oneTimeHint}</p>
    <Field htmlFor={id} label={p.secretLabel}><textarea id={id} readOnly autoComplete="off" spellCheck={false} value={secret} rows={3} className="w-full resize-none break-all rounded-lg border border-neutral-300 bg-neutral-50 p-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-neutral-950" onFocus={(event) => event.currentTarget.select()} /></Field>
    <Button className="min-h-11" variant="outline" onClick={() => void copy()}>{copyState === 'copied' ? p.copied : p.copy}</Button>
    {copyState === 'error' && <p role="status" className="text-sm text-red-700">{p.copyFailed}</p>}
    <Button className="min-h-11 h-auto w-full whitespace-normal py-3" onClick={onDiscard}>{p.discard}</Button>
  </ApiDialog>;
}

export function ApiConfirmDialog({ title, hint, busy, onConfirm, onClose }: { title: string; hint: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t: { partnerApi: p } } = useI18n();
  return <ApiDialog title={title} onClose={() => { if (!busy) onClose(); }}><p className="text-sm leading-6 text-neutral-600">{hint}</p><div className="flex flex-wrap gap-3"><Button className="min-h-11" variant="outline" disabled={busy} onClick={onClose}>{p.cancel}</Button><Button className="min-h-11" loading={busy} onClick={onConfirm}>{p.confirm}</Button></div></ApiDialog>;
}
