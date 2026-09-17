'use client';

import Link from 'next/link';

import { Suspense, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createDraft, editDraft, isDraftDirty, mergeSettingsSection, SETTINGS_TABS, settingsDrafts, settingsPayload, settingsTab, settleDraft, type SettingsDrafts, type SettingsTab, type SettingsValues } from '@/lib/settings-drafts';
import { Plus, PlugZap, ServerCrash, ShieldAlert, Trash2 } from 'lucide-react';
import {
  AI_DEFAULT_MODEL,
  AI_PROVIDERS,
  SUPPORT_CHANNELS_MAX,
  SUPPORT_FIELD_MAX_LENGTH,
  SUPPORT_NOTE_MAX_LENGTH,
  type AdminStoreSettingDto,
  type AiProvider,
  type BinanceStatusDto,
  type SupportChannelDto,
} from '@webcatt/shared';
import { Tabs } from '@/components/admin/tabs';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n/dictionaries/vi';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Label,
  Spinner,
} from '@/components/ui';
import { PageHeader } from '@/components/admin/page-header';
import { ImagePicker } from '@/components/admin/image-picker';
import { ToggleRow } from '@/components/admin/toggle-row';
import { formatAmount } from '@/components/admin/helpers';

/** Một dòng "nhãn: giá trị" trong bảng trạng thái Binance. */
function StatusRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-right text-neutral-950">{value}</dd>
    </div>
  );
}

export default function AdminSettingsPage() {
  return <Suspense fallback={<div className="flex justify-center py-24"><Spinner className="h-6 w-6" /></div>}><SettingsContent /></Suspense>;
}

function SettingsContent() {
  const { token } = useAuth();
  const { t, locale, formatDate } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const activeTab = settingsTab(params.get('tab'));
  const selectTab = (tab: SettingsTab) => {
    router.push(`/admin/settings?tab=${tab}`, { scroll: false });
  };

  const [settings, setSettings] = useState<AdminStoreSettingDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [groups, setGroups] = useState<SettingsDrafts>(() => settingsDrafts());
  const groupsRef = useRef(groups);
  const changeGroups = (update: (current: SettingsDrafts) => SettingsDrafts) => {
    groupsRef.current = update(groupsRef.current);
    setGroups(groupsRef.current);
  };
  const edit = <K extends SettingsTab>(tab: K, patch: Partial<SettingsValues[K]>) => {
    changeGroups((current) => ({ ...current, [tab]: editDraft(current[tab], patch) }));
  };
  const { mockEnabled, binancePayEnabled, binanceIdEnabled, binanceId, binanceQr, sepayEnabled, sepayAccountNumber, sepayBank, sepayAccountHolder, sepayApiKey, sepayWebhookSecret, clearSepayApiKey, clearSepayWebhookSecret, cryptoEnabled, bep20Address, trc20Address } = groups.payments.draft;
  const { vndPerUsdt, cnyPerUsdt, rateAuto, rateMarkupPercent, rateHour } = groups.rates.draft;
  const { aiProvider, aiBaseUrl, aiModel, aiKey, clearAiKey } = groups.ai.draft;
  const { supportNote, supportChannels } = groups.support.draft;
  const setMockEnabled = (value: boolean) => edit('payments', { mockEnabled: value });
  const setBinancePayEnabled = (value: boolean) => edit('payments', { binancePayEnabled: value });
  const setBinanceIdEnabled = (value: boolean) => edit('payments', { binanceIdEnabled: value });
  const setBinanceId = (value: string) => edit('payments', { binanceId: value });
  const setBinanceQr = (value: string) => edit('payments', { binanceQr: value });
  const setSepayEnabled = (value: boolean) => edit('payments', { sepayEnabled: value });
  const setSepayAccountNumber = (value: string) => edit('payments', { sepayAccountNumber: value });
  const setSepayBank = (value: string) => edit('payments', { sepayBank: value });
  const setSepayAccountHolder = (value: string) => edit('payments', { sepayAccountHolder: value });
  const setSepayApiKey = (value: string) => edit('payments', { sepayApiKey: value, clearSepayApiKey: false });
  const setSepayWebhookSecret = (value: string) => edit('payments', { sepayWebhookSecret: value, clearSepayWebhookSecret: false });
  const setCryptoEnabled = (value: boolean) => edit('payments', { cryptoEnabled: value });
  const setBep20Address = (value: string) => edit('payments', { bep20Address: value });
  const setTrc20Address = (value: string) => edit('payments', { trc20Address: value });
  const setVndPerUsdt = (value: string) => edit('rates', { vndPerUsdt: value });
  const setCnyPerUsdt = (value: string) => edit('rates', { cnyPerUsdt: value });
  const setRateAuto = (value: boolean) => edit('rates', { rateAuto: value });
  const setRateMarkupPercent = (value: string) => edit('rates', { rateMarkupPercent: value });
  const setRateHour = (value: string) => edit('rates', { rateHour: value });
  const setAiProvider = (value: AiProvider) => edit('ai', { aiProvider: value });
  const setAiBaseUrl = (value: string) => edit('ai', { aiBaseUrl: value });
  const setAiModel = (value: string) => edit('ai', { aiModel: value });
  const setAiKey = (value: string) => edit('ai', { aiKey: value });
  const setClearAiKey = (value: boolean) => edit('ai', { clearAiKey: value });
  const setSupportNote = (value: string) => edit('support', { supportNote: value });
  const setSupportChannels = (value: SupportChannelDto[]) => edit('support', { supportChannels: value });
  const [refreshingRate, setRefreshingRate] = useState(false);
  const refreshingRef = useRef(false);
  const [rateMessage, setRateMessage] = useState<string | null>(null);
  const [sepayError, setSepayError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const { saving, saved, error: saveError } = groups[activeTab];
  const requestContext = useRef({ token, locale, connectionError: t.common.connectionError });
  requestContext.current = { token, locale, connectionError: t.common.connectionError };
  const session = useRef(0);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [binanceIdError, setBinanceIdError] = useState<string | null>(null);

  const [status, setStatus] = useState<BinanceStatusDto | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    const generation = ++session.current;
    setSettings(null);
    setLoadError(null);
    changeGroups(() => settingsDrafts());
    if (token) apiFetch<AdminStoreSettingDto>('/admin/settings', { token, locale: requestContext.current.locale })
      .then((data) => {
        if (generation !== session.current) return;
        setSettings(data);
        changeGroups(() => settingsDrafts(data));
      })
      .catch((err: unknown) => {
        if (generation === session.current) setLoadError(apiErrorMessage(err, requestContext.current.connectionError));
      });
    // Đổi ngôn ngữ chỉ đổi nhãn, không nạp đè bản nháp hoặc bí mật đang gõ.
    return () => { session.current++; };
  }, [token]);

  // Trạng thái Binance tải riêng — cuộc gọi ra Binance có thể chậm.
  useEffect(() => {
    let active = true;
    if (!token) return;
    apiFetch<BinanceStatusDto>('/admin/binance/status', { token, locale: requestContext.current.locale })
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch((err: unknown) => {
        if (active) setStatusError(apiErrorMessage(err, requestContext.current.connectionError));
      });
    return () => {
      active = false;
    };
  }, [token]);

  const binanceConfigured = status?.configured === true;
  const cryptoToggleDisabled = status !== null && !status.configured;

  /*
    Địa chỉ webhook phải TUYỆT ĐỐI: chủ shop dán nó vào SePay, và SePay gọi từ
    ngoài Internet vào — dán một đường dẫn tương đối là webhook không bao giờ tới.

    NEXT_PUBLIC_API_URL đã chứa sẵn "/api" (xem apps/web/.env.example), nên KHÔNG
    được ghép thêm; và ở production nó có thể chỉ là "/api" khi web với api cùng
    một tên miền, lúc đó phải mượn origin của trang.

    Tính trong useEffect chứ không tính thẳng: `window` không tồn tại lúc Next
    dựng sẵn trang trên máy chủ, mà chuỗi khác nhau giữa hai lượt là lỗi hydrate.
  */
  const [webhookUrl, setWebhookUrl] = useState('');
  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/+$/, '');
    const goc = base.startsWith('http') ? base : `${window.location.origin}${base}`;
    setWebhookUrl(`${goc}/payments/sepay/webhook`);
  }, []);

  const [webhookCopied, setWebhookCopied] = useState(false);
  const handleCopyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setWebhookCopied(true);
    } catch {
      setWebhookCopied(false);
    }
  };

  /**
   * Lấy tỉ giá NGAY. Nguồn lỗi thì API trả `ok: false` và giữ tỉ giá cũ — nên
   * đây không phải lỗi, chỉ là "chưa cập nhật được".
   */
  const handleRefreshRate = async () => {
    if (!token || refreshingRef.current || groupsRef.current.rates.saving) return;
    if (isDraftDirty(groupsRef.current.rates)) {
      setRateMessage(t.settingsUx.rateDirty);
      return;
    }
    const sent = groupsRef.current.rates.draft;
    const generation = session.current;
    refreshingRef.current = true;
    setRefreshingRate(true);
    setRateMessage(null);
    try {
      const kq = await apiFetch<{
        ok: boolean;
        vndPerUsdt?: number;
        cnyPerUsdt?: number;
        reason?: string;
      }>('/admin/rates/refresh', { method: 'POST', token, locale });
      if (generation !== session.current) return;
      if (kq.ok) {
        const next = await apiFetch<AdminStoreSettingDto>('/admin/settings', { token, locale });
        if (generation !== session.current) return;
        setSettings((current) => current ? mergeSettingsSection(current, next, 'rates') : current);
        changeGroups((current) => ({ ...current, rates: settleDraft(current.rates, sent, settingsDrafts(next).rates.draft) }));
        setRateMessage(isDraftDirty(groupsRef.current.rates) ? t.settingsUx.rateDirty : t.admin.rateRefreshDone);
      } else {
        setRateMessage(`${t.admin.rateRefreshFailed} ${kq.reason ?? ''}`.trim());
      }
    } catch (err) {
      if (generation === session.current) setRateMessage(apiErrorMessage(err, t.common.connectionError));
    } finally {
      refreshingRef.current = false;
      if (generation === session.current) setRefreshingRate(false);
    }
  };

  const markDirty = () => {
    if (activeTab === 'payments') { setAddressError(null); setSepayError(null); setBinanceIdError(null); }
    if (activeTab === 'ai') setAiError(null);
  };

  /** Sửa một ô của kênh liên hệ thứ `index`. */
  const updateChannel = (index: number, patch: Partial<SupportChannelDto>) => {
    setSupportChannels(
      supportChannels.map((channel, i) =>
        i === index ? { ...channel, ...patch } : channel,
      ),
    );
    markDirty();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const tab = activeTab;
    if (!token || groupsRef.current[tab].saving || (tab === 'rates' && refreshingRef.current)) return;
    if (tab === 'payments' && cryptoEnabled && !bep20Address.trim() && !trc20Address.trim()) {
      setAddressError(t.admin.errCryptoAddressRequired);
      return;
    }
    setAddressError(null);
    // Bật nhận tiền mà chưa điền ID thì khách sẽ thấy một phương thức không
    // chuyển đi đâu được. Máy chủ cũng chặn, đây chỉ là báo sớm ngay tại ô nhập.
    if (tab === 'payments' && binanceIdEnabled && !binanceId.trim()) {
      setBinanceIdError(t.admin.errBinanceIdRequired);
      return;
    }
    setBinanceIdError(null);
    // Anthropic có model mặc định, nhà cung cấp khác thì không đoán được.
    // Máy chủ cũng chặn; đây chỉ là báo sớm ngay tại ô nhập.
    if (tab === 'ai' && aiProvider === 'openai' && aiModel.trim() === '') {
      setAiError(t.admin.errAiModelRequired);
      return;
    }
    setAiError(null);
    /*
      Bật SePay mà thiếu cấu hình thì báo NGAY tại chỗ. Máy chủ cũng chặn, nhưng
      để nó chặn thì chủ shop chỉ thấy một dòng lỗi chung ở cuối biểu mẫu.

      Khoá API: ô rỗng nghĩa là "giữ khoá cũ", nên chỉ coi là thiếu khi máy chủ
      cũng báo chưa có khoá nào.
    */
    if (tab === 'payments' && sepayEnabled) {
      const rate = settings?.vndPerUsdt ?? 0;
      const thieuKhoa = clearSepayApiKey || (sepayApiKey.trim() === '' && settings?.sepayApiKeySet !== true);
      if (
        sepayAccountNumber.trim() === '' ||
        sepayBank.trim() === '' ||
        !Number.isFinite(rate) ||
        rate <= 0 ||
        thieuKhoa
      ) {
        setSepayError(t.admin.errSepayIncomplete);
        return;
      }
    }
    setSepayError(null);
    if (tab === 'rates') {
      const values = [vndPerUsdt, cnyPerUsdt, rateMarkupPercent, rateHour];
      const [vnd, cny, markup, hour] = values.map(Number);
      if (values.some((value) => !value.trim() || !Number.isFinite(Number(value))) || vnd < 0 || vnd > 10_000_000 || cny < 0 || cny > 10_000 || markup < 0 || markup > 50 || !Number.isInteger(hour) || hour < 0 || hour > 23) {
        changeGroups((current) => ({ ...current, rates: { ...current.rates, error: t.settingsUx.ratesInvalid } }));
        return;
      }
    }
    await saveSection(tab);
  };

  const saveSection = async <K extends SettingsTab>(tab: K) => {
    const sent = groupsRef.current[tab].draft;
    const generation = session.current;
    changeGroups((current) => ({ ...current, [tab]: { ...current[tab], saving: true, saved: false, error: null } }));
    try {
      const next = await apiFetch<AdminStoreSettingDto>(`/admin/settings/${tab}`, {
        method: 'PATCH', body: settingsPayload(tab, sent), token, locale,
      });
      if (generation !== session.current) return;
      setSettings((current) => current ? mergeSettingsSection(current, next, tab) : current);
      const received = settingsDrafts(next)[tab].draft;
      changeGroups((current) => ({ ...current, [tab]: settleDraft(current[tab], sent, received) }));
    } catch (err) {
      if (generation !== session.current) return;
      changeGroups((current) => ({ ...current, [tab]: { ...current[tab], saving: false, saved: false, error: apiErrorMessage(err, t.common.connectionError) } }));
    }
  };

  if (loadError) {
    return (
      <EmptyState
        icon={ServerCrash}
        title={t.admin.settingsLoadError}
        hint={loadError}
        action={
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t.common.retry}
          </Button>
        }
      />
    );
  }

  if (settings === null) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t.admin.settingsTitle} description={t.admin.settingsSubtitle} />

      <p className="mb-4 text-sm text-neutral-500">{t.settingsUx.sectionHint}</p>
      <Tabs idPrefix="settings" label={t.admin.settingsTitle} items={SETTINGS_TABS.map((value) => ({ value, label: `${t.settingsUx.tabs[value]}${isDraftDirty(groups[value]) ? ' *' : ''}` }))} value={activeTab} onChange={selectTab} className="mb-5 w-full" />
      <div className="space-y-6">
        <Card className="p-4 sm:p-6">
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" noValidate>
            <section id="settings-panel-payments" role="tabpanel" aria-labelledby="settings-tab-payments" hidden={activeTab !== 'payments'} className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
                {t.admin.settingsMethodsTitle}
              </h2>
              <p className="mt-0.5 text-sm text-neutral-500">{t.admin.settingsMethodsSubtitle}</p>
            </div>

            <div className="space-y-2.5">
              <ToggleRow
                id="setting-mock"
                checked={mockEnabled}
                onChange={(checked) => {
                  setMockEnabled(checked);
                  markDirty();
                }}
                label={t.admin.settingMock}
                hint={t.admin.settingMockHint}
              />
              <ToggleRow
                id="setting-binance-pay"
                checked={binancePayEnabled}
                onChange={(checked) => {
                  setBinancePayEnabled(checked);
                  markDirty();
                }}
                label={t.admin.settingBinancePay}
                hint={t.admin.settingBinancePayHint}
              />
              <ToggleRow
                id="setting-binance-id"
                checked={binanceIdEnabled}
                onChange={(checked) => {
                  setBinanceIdEnabled(checked);
                  markDirty();
                }}
                label={t.admin.settingBinanceId}
                hint={t.admin.settingBinanceIdHint}
              />
              <ToggleRow
                id="setting-sepay"
                checked={sepayEnabled}
                onChange={(checked) => {
                  setSepayEnabled(checked);
                  markDirty();
                }}
                label={t.admin.settingSepay}
                hint={t.admin.settingSepayHint}
              />

              <ToggleRow
                id="setting-crypto"
                checked={cryptoEnabled}
                disabled={cryptoToggleDisabled}
                onChange={(checked) => {
                  setCryptoEnabled(checked);
                  markDirty();
                }}
                label={t.admin.settingCrypto}
                hint={
                  cryptoToggleDisabled
                    ? t.admin.settingCryptoDisabledHint
                    : t.admin.settingCryptoHint
                }
              />
            </div>

            {binanceIdEnabled && (
              <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <Field
                  label={t.admin.settingBinanceIdLabel}
                  htmlFor="setting-binance-id-value"
                  error={binanceIdError}
                  hint={t.admin.settingBinanceIdValueHint}
                >
                  <Input
                    id="setting-binance-id-value"
                    inputMode="numeric"
                    value={binanceId}
                    invalid={Boolean(binanceIdError)}
                    placeholder="1240006466"
                    className="font-mono text-[13px]"
                    onChange={(event) => {
                      setBinanceId(event.target.value.replace(/\D/g, ''));
                      markDirty();
                    }}
                  />
                </Field>

                {/*
                  QR phải do chủ shop TỰ TẢI LÊN, không dựng được từ Binance ID:
                  mã của Binance chứa một liên kết nội bộ có token riêng. Mã hoá
                  số ID trần thì app Binance quét không hiểu.
                */}
                <Field
                  label={t.admin.settingBinanceQrLabel}
                  htmlFor="setting-binance-qr"
                  hint={t.admin.settingBinanceQrHint}
                >
                  <ImagePicker
                    id="setting-binance-qr"
                    value={binanceQr}
                    bytes={null}
                    onChange={(pair) => {
                      // Lấy bản LỚN: mã QR nén mạnh là nhoè, máy quét đọc không ra.
                      setBinanceQr(pair.image);
                      markDirty();
                    }}
                  />
                </Field>
              </div>
            )}

            {sepayEnabled && (
              <div className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={t.admin.settingSepayAccountLabel}
                    htmlFor="setting-sepay-account"
                    error={sepayError}
                  >
                    <Input
                      id="setting-sepay-account"
                      inputMode="numeric"
                      value={sepayAccountNumber}
                      invalid={Boolean(sepayError)}
                      placeholder="0010000000355"
                      className="font-mono text-[13px]"
                      onChange={(event) => {
                        // Chỉ chữ số: máy chủ cũng chặn, đây là chặn ngay tại ô.
                        setSepayAccountNumber(event.target.value.replace(/[^0-9-]/g, ''));
                        markDirty();
                      }}
                    />
                  </Field>

                  <Field
                    label={t.admin.settingSepayBankLabel}
                    htmlFor="setting-sepay-bank"
                    hint={t.admin.settingSepayBankHint}
                  >
                    <Input
                      id="setting-sepay-bank"
                      value={sepayBank}
                      placeholder="Vietcombank"
                      onChange={(event) => {
                        setSepayBank(event.target.value);
                        markDirty();
                      }}
                    />
                  </Field>

                  <Field
                    label={t.admin.settingSepayHolderLabel}
                    htmlFor="setting-sepay-holder"
                    hint={t.admin.settingSepayHolderHint}
                  >
                    <Input
                      id="setting-sepay-holder"
                      value={sepayAccountHolder}
                      placeholder="NGUYEN VAN A"
                      onChange={(event) => {
                        setSepayAccountHolder(event.target.value);
                        markDirty();
                      }}
                    />
                  </Field>

                  <div className="space-y-2 text-sm">
                    <p>{t.admin.settingVndRateLabel}: <strong className="tabular-nums">{settings.vndPerUsdt}</strong></p>
                    <p className="text-neutral-500">{t.settingsUx.savedRateHint}</p>
                    <button type="button" className="min-h-11 underline underline-offset-4" onClick={() => selectTab('rates')}>{t.settingsUx.tabs.rates}</button>
                  </div>
                </div>

                {/*
                  Địa chỉ webhook: chủ shop phải dán chính xác chuỗi này vào SePay.
                  Hiện sẵn ở đây để không phải tự ghép tay và gõ sai.
                */}
                <Field
                  label={t.admin.settingSepayWebhookUrl}
                  htmlFor="setting-sepay-webhook-url"
                >
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
                    <span
                      id="setting-sepay-webhook-url"
                      className="break-all font-mono text-[13px] text-neutral-950"
                    >
                      {webhookUrl}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={webhookUrl === ''}
                      onClick={() => void handleCopyWebhookUrl()}
                    >
                      {webhookCopied ? t.common.copied : t.common.copy}
                    </Button>
                  </div>
                </Field>

                <p className="text-xs text-neutral-500">{t.settingsUx.secretsHint}</p>
                {settings?.sepayApiKeySet && <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm text-neutral-950">{t.admin.settingApiKeySaved(settings.sepayApiKeyHint)}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => edit('payments', { clearSepayApiKey: !clearSepayApiKey, sepayApiKey: '' })}>{clearSepayApiKey ? t.settingsUx.cancelDelete : t.admin.settingApiKeyClear}</Button>
                </div>}
                {clearSepayApiKey && <p role="status" className="text-sm">{t.settingsUx.deletePending}</p>}

                <Field
                  label={
                    settings?.sepayApiKeySet
                      ? t.admin.settingSepayKeyReplaceLabel
                      : t.admin.settingSepayKeyLabel
                  }
                  htmlFor="setting-sepay-key"
                  hint={t.admin.settingSepayKeyHint}
                >
                  <Input
                    id="setting-sepay-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={sepayApiKey}
                    className="font-mono text-[13px]"
                    onChange={(event) => {
                      setSepayApiKey(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>

                {settings?.sepayWebhookSecretSet && <Button type="button" variant="outline" size="sm" onClick={() => edit('payments', { clearSepayWebhookSecret: !clearSepayWebhookSecret, sepayWebhookSecret: '' })}>{t.admin.settingSepaySecretLabel} — {clearSepayWebhookSecret ? t.settingsUx.cancelDelete : t.admin.settingApiKeyClear}</Button>}
                {clearSepayWebhookSecret && <p role="status" className="text-sm">{t.settingsUx.deletePending}</p>}
                <Field
                  label={t.admin.settingSepaySecretLabel}
                  htmlFor="setting-sepay-secret"
                  hint={t.admin.settingSepaySecretHint}
                >
                  <Input
                    id="setting-sepay-secret"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={sepayWebhookSecret}
                    placeholder={settings?.sepayWebhookSecretSet ? '••••••••' : ''}
                    className="font-mono text-[13px]"
                    onChange={(event) => {
                      setSepayWebhookSecret(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>
              </div>
            )}

            {cryptoEnabled && (
              <div className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <Field label={t.admin.settingBep20Label} htmlFor="setting-bep20" error={addressError}>
                  <Input id="setting-bep20" value={bep20Address} invalid={Boolean(addressError)} placeholder={t.admin.settingBep20Placeholder} className="font-mono text-[13px]" onChange={(event) => { setBep20Address(event.target.value); markDirty(); }} />
                </Field>
                <Field label={t.admin.settingTrc20Label} htmlFor="setting-trc20">
                  <Input id="setting-trc20" value={trc20Address} invalid={Boolean(addressError)} placeholder={t.admin.settingTrc20Placeholder} className="font-mono text-[13px]" onChange={(event) => { setTrc20Address(event.target.value); markDirty(); }} />
                </Field>
                <p className="text-xs text-neutral-500">{t.admin.settingAddressesHint}</p>
              </div>
            )}
            </section>
            <section id="settings-panel-rates" role="tabpanel" aria-labelledby="settings-tab-rates" hidden={activeTab !== 'rates'}>
            {/* Tỉ giá có bản nháp riêng; bật SePay không gửi nhầm tỉ giá chưa lưu. */}
            <div className="space-y-3 border-t border-neutral-100 pt-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
                  {t.admin.rateTitle}
                </h2>
                <p className="mt-0.5 text-sm text-neutral-500">{t.admin.rateHint}</p>
              </div>

              <ToggleRow
                id="setting-rate-auto"
                checked={rateAuto}
                onChange={(checked) => {
                  setRateAuto(checked);
                  markDirty();
                }}
                label={t.admin.rateAutoLabel}
                hint={t.admin.rateAutoHint}
              />

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field
                  label={t.admin.settingVndRateLabel}
                  htmlFor="setting-vnd-rate"
                  hint={rateAuto ? t.admin.rateManagedHint : t.admin.settingVndRateHint}
                >
                  <Input
                    id="setting-vnd-rate"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={vndPerUsdt}
                    placeholder="26000"
                    className="tabular-nums"
                    onChange={(event) => {
                      setVndPerUsdt(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>

                <Field
                  label={t.admin.rateCnyLabel}
                  htmlFor="setting-cny-rate"
                  hint={rateAuto ? t.admin.rateManagedHint : t.admin.rateCnyHint}
                >
                  <Input
                    id="setting-cny-rate"
                    type="number"
                    min={0}
                    step="0.0001"
                    inputMode="decimal"
                    value={cnyPerUsdt}
                    placeholder="7.14"
                    className="tabular-nums"
                    onChange={(event) => {
                      setCnyPerUsdt(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>

                <Field
                  label={t.admin.rateHourLabel}
                  htmlFor="setting-rate-hour"
                  hint={t.admin.rateHourHint}
                >
                  <Input
                    id="setting-rate-hour"
                    type="number"
                    min={0}
                    max={23}
                    step={1}
                    inputMode="numeric"
                    value={rateHour}
                    placeholder="7"
                    className="tabular-nums"
                    onChange={(event) => {
                      setRateHour(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>

                <Field
                  label={t.admin.rateMarkupLabel}
                  htmlFor="setting-rate-markup"
                  hint={t.admin.rateMarkupHint}
                >
                  <Input
                    id="setting-rate-markup"
                    type="number"
                    min={0}
                    max={50}
                    step="0.01"
                    inputMode="decimal"
                    value={rateMarkupPercent}
                    placeholder="0"
                    className="tabular-nums"
                    onChange={(event) => {
                      setRateMarkupPercent(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={refreshingRate}
                  disabled={groups.rates.saving || isDraftDirty(groups.rates)}
                  onClick={() => void handleRefreshRate()}
                >
                  {t.admin.rateRefreshNow}
                </Button>
                <span className="text-xs text-neutral-500">
                  {settings?.rateUpdatedAt
                    ? t.admin.rateUpdatedAt(formatDate(settings.rateUpdatedAt))
                    : t.admin.rateNeverUpdated}
                </span>
              </div>
              {/* Nguồn hiện SẴN, không chờ tới lần lấy đầu — chủ shop cần biết
                  tỉ giá lấy ở đâu trước khi bật. */}
              <p className="font-mono text-[11px] text-neutral-400">
                {settings?.rateSource || t.admin.rateSourceHint}
              </p>
              {isDraftDirty(groups.rates) && <div className="space-y-2 border-l-2 border-amber-500 pl-3"><p className="text-sm text-neutral-700">{t.settingsUx.rateDirty}</p><Button type="button" variant="outline" size="sm" disabled={groups.rates.saving || refreshingRate} onClick={() => { changeGroups((current) => ({ ...current, rates: createDraft(current.rates.baseline) })); setRateMessage(null); }}>{t.settingsUx.discardRates}</Button></div>}
              {rateMessage && <p role="status" className="text-sm text-neutral-950">{rateMessage}</p>}
            </div>

            </section>
            <section id="settings-panel-ai" role="tabpanel" aria-labelledby="settings-tab-ai" hidden={activeTab !== 'ai'}>

            {/*
              Cấu hình dịch tự động. Nằm trong CSDL nên sửa được ngay trên web —
              đổi lại khoá có mặt trong mọi bản sao lưu, xem ghi chú ở schema.prisma.
            */}
            <div className="space-y-3 border-t border-neutral-100 pt-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
                  {t.admin.settingTranslationTitle}
                </h2>
                <p className="mt-0.5 text-sm text-neutral-500">
                  {t.admin.settingTranslationHint}
                </p>
              </div>

              <Tabs
                items={AI_PROVIDERS.map((value) => ({
                  value,
                  label: t.admin.settingAiProviders[value],
                }))}
                value={aiProvider}
                onChange={(value) => {
                  setAiProvider(value);
                  markDirty();
                }}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label={t.admin.settingAiBaseUrlLabel}
                  htmlFor="setting-ai-base-url"
                  hint={t.admin.settingAiBaseUrlHint}
                >
                  <Input
                    id="setting-ai-base-url"
                    autoComplete="off"
                    spellCheck={false}
                    value={aiBaseUrl}
                    placeholder={
                      aiProvider === 'anthropic'
                        ? 'https://api.anthropic.com'
                        : 'https://openrouter.ai/api/v1'
                    }
                    className="font-mono text-[13px]"
                    onChange={(event) => {
                      setAiBaseUrl(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>

                <Field
                  label={t.admin.settingAiModelLabel}
                  htmlFor="setting-ai-model"
                  error={aiError}
                  hint={aiProvider === 'anthropic' ? t.admin.settingAiModelHint : undefined}
                >
                  <Input
                    id="setting-ai-model"
                    autoComplete="off"
                    spellCheck={false}
                    value={aiModel}
                    invalid={Boolean(aiError)}
                    placeholder={aiProvider === 'anthropic' ? AI_DEFAULT_MODEL : 'deepseek-chat'}
                    className="font-mono text-[13px]"
                    onChange={(event) => {
                      setAiModel(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>
              </div>

              <p className="text-xs text-neutral-500">{t.settingsUx.secretsHint}</p>
              {clearAiKey && <Button type="button" size="sm" variant="outline" onClick={() => setClearAiKey(false)}>{t.settingsUx.cancelDelete}</Button>}
              {settings?.aiKeySet && !clearAiKey ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                  <span className="font-mono text-sm text-neutral-950">
                    {t.admin.settingApiKeySaved(settings.aiKeyHint)}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setClearAiKey(true);
                      setAiKey('');
                      markDirty();
                    }}
                  >
                    {t.admin.settingApiKeyClear}
                  </Button>
                </div>
              ) : null}

              <Field
                label={
                  settings?.aiKeySet && !clearAiKey
                    ? t.admin.settingApiKeyReplaceLabel
                    : t.admin.settingApiKeyLabel
                }
                htmlFor="setting-ai-key"
                hint={t.admin.settingApiKeyHint}
              >
                <Input
                  id="setting-ai-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={aiKey}
                  placeholder={aiProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
                  className="font-mono text-[13px]"
                  onChange={(event) => {
                    setAiKey(event.target.value);
                    setClearAiKey(false);
                    markDirty();
                  }}
                />
              </Field>

              {clearAiKey && (
                <p className="text-sm font-medium text-neutral-950">
                  {t.admin.settingApiKeyWillClear}
                </p>
              )}
            </div>

            </section>
            <section id="settings-panel-support" role="tabpanel" aria-labelledby="settings-tab-support" hidden={activeTab !== 'support'} className="space-y-4">
            {/* Cấu hình bot Telegram nằm ở trang riêng /admin/telegram (kèm xem trước). */}
            <div className="space-y-2 border-t border-neutral-100 pt-4">
              <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
                {t.admin.settingTelegramTitle}
              </h2>
              <Link
                href="/admin/telegram"
                className="inline-flex items-center gap-1 text-sm font-medium text-neutral-950 underline underline-offset-4 hover:text-neutral-600"
              >
                {t.admin.settingTelegramMoved}
              </Link>
            </div>

            {/* Kênh liên hệ cho khách quên mật khẩu (cửa hàng không gửi email). */}
            <div className="space-y-4 border-t border-neutral-100 pt-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
                  {t.admin.settingSupportTitle}
                </h2>
                <p className="mt-0.5 text-sm text-neutral-500">
                  {t.admin.settingSupportHint}
                </p>
              </div>

              <Field
                label={t.admin.settingSupportNoteLabel}
                htmlFor="setting-support-note"
                hint={t.admin.settingSupportNoteHint}
              >
                <Input
                  id="setting-support-note"
                  maxLength={SUPPORT_NOTE_MAX_LENGTH}
                  value={supportNote}
                  placeholder={t.auth.forgotHint}
                  onChange={(event) => {
                    setSupportNote(event.target.value);
                    markDirty();
                  }}
                />
              </Field>

              <div className="space-y-2">
                <Label>{t.admin.settingSupportChannels}</Label>
                {supportChannels.length === 0 && (
                  <p className="text-sm text-neutral-500">
                    {t.admin.settingSupportEmpty}
                  </p>
                )}
                {supportChannels.map((channel, index) => (
                  <div
                    key={index}
                    className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5 sm:flex-row sm:items-center"
                  >
                    <Input
                      aria-label={t.admin.settingSupportChannelLabel}
                      className="sm:w-36"
                      maxLength={SUPPORT_FIELD_MAX_LENGTH}
                      placeholder={t.admin.settingSupportChannelLabel}
                      value={channel.label}
                      onChange={(event) => {
                        updateChannel(index, { label: event.target.value });
                      }}
                    />
                    <Input
                      aria-label={t.admin.settingSupportChannelValue}
                      className="flex-1"
                      maxLength={SUPPORT_FIELD_MAX_LENGTH}
                      placeholder={t.admin.settingSupportChannelValue}
                      value={channel.value}
                      onChange={(event) => {
                        updateChannel(index, { value: event.target.value });
                      }}
                    />
                    <Input
                      aria-label={t.admin.settingSupportChannelUrl}
                      className="flex-1 text-[13px]"
                      maxLength={300}
                      placeholder={t.admin.settingSupportChannelUrl}
                      value={channel.url ?? ''}
                      onChange={(event) => {
                        updateChannel(index, { url: event.target.value });
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSupportChannels(
                          supportChannels.filter((_, i) => i !== index),
                        );
                        markDirty();
                      }}
                      aria-label={t.common.delete}
                      title={t.common.delete}
                      className="shrink-0 cursor-pointer self-end rounded-lg p-2 text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 sm:self-auto"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                ))}

                {supportChannels.length < SUPPORT_CHANNELS_MAX && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSupportChannels([
                        ...supportChannels,
                        { label: '', value: '' },
                      ]);
                      markDirty();
                    }}
                  >
                    <Plus className="h-4 w-4" strokeWidth={1.75} />
                    {t.admin.settingSupportAdd}
                  </Button>
                )}
              </div>
            </div>

            </section>
            {saveError && <p role="alert" className="text-sm text-red-600">{saveError}</p>}
            <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
              <Button type="submit" loading={saving} disabled={!isDraftDirty(groups[activeTab]) || (activeTab === 'rates' && refreshingRate)}>
                {t.settingsUx.saveSection}
              </Button>
              <p role="status" className="text-sm text-neutral-600">{isDraftDirty(groups[activeTab]) ? t.settingsUx.unsaved : saved ? t.settingsUx.savedSection : t.settingsUx.upToDate}</p>
            </div>
          </form>
        </Card>

        {activeTab === 'payments' && <Card className="p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-neutral-950">
            <PlugZap className="h-5 w-5" strokeWidth={1.75} />
            {t.admin.binanceStatusTitle}
          </h2>

          {statusError ? (
            <p className="mt-3 text-sm text-red-600">
              {t.admin.binanceStatusLoadError} — {statusError}
            </p>
          ) : status === null ? (
            <div className="mt-4 flex justify-center py-6">
              <Spinner className="h-5 w-5 text-neutral-400" />
            </div>
          ) : !binanceConfigured ? (
            <p className="mt-3 text-sm text-neutral-500">{t.admin.binanceNotConfigured}</p>
          ) : (
            <>
              <dl className="mt-3 divide-y divide-neutral-100 text-sm">
                <StatusRow
                  label={t.admin.infoStatus}
                  value={
                    status.connected ? (
                      <Badge variant="solid">{t.admin.binanceConnected}</Badge>
                    ) : (
                      <Badge variant="muted">{t.admin.binanceConnectionFailed}</Badge>
                    )
                  }
                />
                <StatusRow
                  label={t.admin.binanceBalanceLabel}
                  value={
                    status.usdtBalance !== null ? (
                      <span className="font-semibold tabular-nums">
                        {formatAmount(status.usdtBalance)} USDT
                      </span>
                    ) : (
                      t.common.dash
                    )
                  }
                />
              </dl>

              {status.error && <p className="mt-3 text-sm text-red-600">{status.error}</p>}

              {/* Quyền THẬT của khóa API (apiRestrictions) — không phải trạng thái tài khoản. */}
              {status.permissions && (
                <div className="mt-4 border-t border-neutral-100 pt-3">
                  <p className="text-sm font-medium">{t.admin.binancePermTitle}</p>
                  <dl className="mt-2 divide-y divide-neutral-100 text-sm">
                    <StatusRow
                      label={t.admin.binancePermRead}
                      value={
                        <PermBadge on={status.permissions.read} t={t} good={true} />
                      }
                    />
                    <StatusRow
                      label={t.admin.binancePermWithdraw}
                      value={
                        <PermBadge
                          on={status.permissions.withdraw}
                          t={t}
                          good={false}
                        />
                      }
                    />
                    <StatusRow
                      label={t.admin.binancePermTrade}
                      value={
                        <PermBadge on={status.permissions.trade} t={t} good={false} />
                      }
                    />
                    <StatusRow
                      label={t.admin.binancePermIpRestricted}
                      value={
                        <PermBadge
                          on={status.permissions.ipRestricted}
                          t={t}
                          good={true}
                        />
                      }
                    />
                  </dl>

                  {status.permissions.withdraw ? (
                    <p className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-600">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                      {t.admin.binanceWithdrawWarning}
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-neutral-500">
                      {t.admin.binanceReadOnlyOk}
                    </p>
                  )}
                  {!status.permissions.ipRestricted && (
                    <p className="mt-2 text-sm text-neutral-500">
                      {t.admin.binanceIpHint}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </Card>}
      </div>
    </div>
  );
}

/**
 * Một quyền của khóa API. `good` = giá trị "bật" có phải điều tốt không:
 * bật quyền đọc / giới hạn IP là tốt, bật quyền rút tiền / giao dịch là rủi ro.
 */
function PermBadge({
  on,
  good,
  t,
}: {
  on: boolean;
  good: boolean;
  t: Dictionary;
}) {
  const label = on ? t.admin.binancePermOn : t.admin.binancePermOff;
  const risky = on !== good;
  return (
    <Badge variant={risky ? 'outline' : on ? 'solid' : 'muted'}>{label}</Badge>
  );
}
