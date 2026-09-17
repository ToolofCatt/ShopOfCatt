'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { Check, Copy, LifeBuoy } from 'lucide-react';
import type { PublicStoreInfoDto } from '@webcatt/shared';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n/client';
import { Button } from '@/components/ui';

type SupportState = 'loading' | 'error' | 'ready';
interface SupportProps { reference?: string; title?: string; hint?: string }

export function SupportPanel(props: SupportProps) {
  const [info, setInfo] = useState<PublicStoreInfoDto | null>(null);
  const [state, setState] = useState<SupportState>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState('loading');
    apiFetch<PublicStoreInfoDto>('/store-info').then((data) => {
      if (!active) return;
      setInfo(data);
      setState('ready');
    }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [attempt]);
  return <SupportPanelContent {...props} info={info} state={state} onRetry={() => setAttempt((value) => value + 1)} />;
}

export function SupportPanelContent({ info, state, onRetry, reference, title, hint }: SupportProps & { info: PublicStoreInfoDto | null; state: SupportState; onRetry: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyReference = async () => {
    if (!reference) return;
    try {
      // Chỉ sao chép mã tham chiếu; không nhận cả DTO chứa key/PII để ghép tin nhắn.
      await navigator.clipboard.writeText(reference);
      setCopyState('copied');
    } catch { setCopyState('error'); }
  };
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-3 rounded-lg border border-dashed border-neutral-300 p-4 text-sm">
      <h2 id={id} className="flex items-center gap-2 font-semibold text-neutral-950"><LifeBuoy className="h-4 w-4 shrink-0" strokeWidth={1.75} />{title ?? t.customerUx.supportTitle}</h2>
      <p className="text-neutral-600">{hint ?? t.customerUx.supportHint}</p>
      {reference && <div className="flex flex-wrap items-center gap-2">
        <span className="text-neutral-500">{t.customerUx.reference}</span>
        <span className="break-all font-mono font-medium">{reference}</span>
        <Button variant="outline" size="sm" className="min-h-11" onClick={() => void copyReference()}>
          {copyState === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copyState === 'copied' ? t.common.copied : t.customerUx.copyReference}
        </Button>
        {copyState === 'error' && <p role="status" className="w-full text-neutral-600">{t.customerUx.copyFailed}</p>}
      </div>}
      <div aria-live="polite">
        {state === 'loading' ? <p className="text-neutral-500">{t.customerUx.supportLoading}</p>
          : state === 'error' ? <div className="space-y-2"><p>{t.customerUx.supportError}</p><Button variant="outline" size="sm" className="min-h-11" onClick={onRetry}>{t.common.retry}</Button></div>
          : <>
            {info?.supportNote.trim() && <p className="whitespace-pre-wrap break-words text-neutral-600">{info.supportNote}</p>}
            {!info?.supportChannels.length ? <p className="text-neutral-500">{t.customerUx.supportEmpty}</p> : <ul className="space-y-2">{info.supportChannels.map((channel, index) => (
              <li key={`${channel.label}-${index}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-neutral-500">{channel.label}</span>
                {channel.url && /^(https?:\/\/|mailto:)/i.test(channel.url) ? <a href={channel.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all font-medium underline underline-offset-4">{channel.value}</a> : <span className="break-all font-medium">{channel.value}</span>}
              </li>
            ))}</ul>}
          </>}
      </div>
      <nav aria-label={t.customerUx.policies} className="flex flex-wrap gap-x-4 border-t border-neutral-200 pt-2">
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/legal/terms">{t.customerUx.terms}</Link>
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/legal/refund">{t.customerUx.refund}</Link>
        <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/legal/privacy">{t.customerUx.privacy}</Link>
      </nav>
    </section>
  );
}
