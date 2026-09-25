'use client';
import { useEffect, useState } from 'react';
import type { MailProviderSettingDto } from '@webcatt/shared';
import { useI18n } from '@/lib/i18n/client';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { Button } from '@/components/ui';

export function MailRounding({ setting, token, canEdit, onSaved }: {
  setting: MailProviderSettingDto;
  token: string;
  canEdit: boolean;
  onSaved: (value: MailProviderSettingDto) => Promise<void>;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState(setting.vndRounding), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  useEffect(() => { setStep(setting.vndRounding); }, [setting.vndRounding]);
  const save = async () => {
    if (busy || step === setting.vndRounding) return;
    setBusy(true); setError(''); setSaved(false);
    try { const next = await apiFetch<MailProviderSettingDto>('/admin/mail/settings', { token, method: 'PATCH', body: { vndRounding: step } }); await onSaved(next); setSaved(true); }
    catch (e) { setError(apiErrorMessage(e, t.mail.connectionError)); }
    finally { setBusy(false); }
  };
  return <section aria-labelledby="mail-rounding-title" className="mb-5 rounded-lg border border-neutral-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1"><h2 id="mail-rounding-title" className="text-sm font-semibold">{t.mail.roundingTitle}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-600">{t.mail.roundingScope}</p></div>
      <div className="flex flex-wrap items-center gap-2"><select aria-label={t.mail.roundingTitle} value={step} disabled={!canEdit || busy} onChange={e => { setStep(Number(e.target.value) as 0 | 1000); setSaved(false); }} className="min-h-10 rounded-md border border-neutral-300 bg-white px-3 text-sm"><option value={0}>{t.mail.roundingOff}</option><option value={1000}>{t.mail.roundingNearest}</option></select><Button variant="outline" loading={busy} disabled={!canEdit || busy || step === setting.vndRounding} onClick={() => void save()}>{t.mail.save}</Button></div>
    </div>
    <p className="mt-3 text-xs text-neutral-600">{step === 1000 ? t.mail.roundingExamples : t.mail.roundingOffHint}</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}{saved && <p role="status" className="mt-2 text-xs text-neutral-700">{t.mail.saved}</p>}
  </section>;
}
