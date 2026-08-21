'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, PlugZap, ServerCrash, ShieldAlert, Trash2 } from 'lucide-react';
import {
  AI_DEFAULT_MODEL,
  AI_PROVIDERS,
  DISPLAY_CURRENCY_MODES,
  SUPPORT_CHANNELS_MAX,
  SUPPORT_FIELD_MAX_LENGTH,
  SUPPORT_NOTE_MAX_LENGTH,
  type AdminStoreSettingDto,
  type AiProvider,
  type BinanceStatusDto,
  type DisplayCurrencyMode,
  type SupportChannelDto,
} from '@webcatt/shared';
import { Tabs } from '@/components/admin/tabs';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import type { Dictionary } from '@/lib/i18n/dictionaries/vi';
import { cn } from '@/lib/cn';
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
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const [settings, setSettings] = useState<AdminStoreSettingDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mockEnabled, setMockEnabled] = useState(false);
  const [binancePayEnabled, setBinancePayEnabled] = useState(false);
  const [binanceIdEnabled, setBinanceIdEnabled] = useState(false);
  const [binanceId, setBinanceId] = useState('');
  const [binanceQr, setBinanceQr] = useState('');
  const [sepayEnabled, setSepayEnabled] = useState(false);
  const [sepayAccountNumber, setSepayAccountNumber] = useState('');
  const [sepayBank, setSepayBank] = useState('');
  const [sepayAccountHolder, setSepayAccountHolder] = useState('');
  const [vndPerUsdt, setVndPerUsdt] = useState('0');
  const [cnyPerUsdt, setCnyPerUsdt] = useState('0');
  const [rateAuto, setRateAuto] = useState(false);
  const [rateMarkupPercent, setRateMarkupPercent] = useState('0');
  const [rateHour, setRateHour] = useState('7');
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrencyMode>('auto');
  const [refreshingRate, setRefreshingRate] = useState(false);
  const [rateMessage, setRateMessage] = useState<string | null>(null);
  /* Khoá webhook: máy chủ không trả về, nên ô này luôn rỗng khi mở trang. */
  const [sepayApiKey, setSepayApiKey] = useState('');
  const [sepayWebhookSecret, setSepayWebhookSecret] = useState('');
  const [sepayError, setSepayError] = useState<string | null>(null);
  const [cryptoEnabled, setCryptoEnabled] = useState(false);
  const [bep20Address, setBep20Address] = useState('');
  const [trc20Address, setTrc20Address] = useState('');
  const [aiProvider, setAiProvider] = useState<AiProvider>('anthropic');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiModel, setAiModel] = useState('');
  /*
    Khoá API: máy chủ KHÔNG BAO GIỜ trả khoá về, nên ô này luôn rỗng khi mở
    trang. Rỗng = "không đổi gì", chứ không phải "xoá khoá" — muốn xoá thì bấm
    nút riêng, nếu không mỗi lần lưu cài đặt là khoá bay mất.
  */
  const [aiKey, setAiKey] = useState('');
  const [clearAiKey, setClearAiKey] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [supportNote, setSupportNote] = useState('');
  const [supportChannels, setSupportChannels] = useState<SupportChannelDto[]>([]);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [binanceIdError, setBinanceIdError] = useState<string | null>(null);

  const [status, setStatus] = useState<BinanceStatusDto | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  /** Đồng bộ biểu mẫu với cấu hình máy chủ vừa trả về. */
  const apply = (next: AdminStoreSettingDto) => {
    setSettings(next);
    setMockEnabled(next.mockEnabled);
    setBinancePayEnabled(next.binancePayEnabled);
    setBinanceIdEnabled(next.binanceIdEnabled);
    setBinanceId(next.binanceId);
    setBinanceQr(next.binanceQr);
    setSepayEnabled(next.sepayEnabled);
    setSepayAccountNumber(next.sepayAccountNumber);
    setSepayBank(next.sepayBank);
    setSepayAccountHolder(next.sepayAccountHolder);
    setVndPerUsdt(String(next.vndPerUsdt));
    setCnyPerUsdt(String(next.cnyPerUsdt));
    setRateAuto(next.rateAuto);
    setRateMarkupPercent(String(next.rateMarkupPercent));
    setRateHour(String(next.rateHour));
    setDisplayCurrency(next.displayCurrency);
    setSepayApiKey('');
    setSepayWebhookSecret('');
    setCryptoEnabled(next.cryptoEnabled);
    setBep20Address(next.bep20Address);
    setTrc20Address(next.trc20Address);
    setSupportNote(next.supportNote);
    setSupportChannels(next.supportChannels);
    setAiProvider(next.aiProvider);
    setAiBaseUrl(next.aiBaseUrl);
    setAiModel(next.aiModel);
    setAiKey('');
    setClearAiKey(false);
  };

  useEffect(() => {
    let active = true;
    apiFetch<AdminStoreSettingDto>('/admin/settings', { token })
      .then((data) => {
        if (active) apply(data);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [token, t]);

  // Trạng thái Binance tải riêng — cuộc gọi ra Binance có thể chậm.
  useEffect(() => {
    let active = true;
    apiFetch<BinanceStatusDto>('/admin/binance/status', { token })
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch((err: unknown) => {
        if (active) setStatusError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [token, t]);

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
    if (refreshingRate) return;
    setRefreshingRate(true);
    setRateMessage(null);
    try {
      const kq = await apiFetch<{
        ok: boolean;
        vndPerUsdt?: number;
        cnyPerUsdt?: number;
        reason?: string;
      }>('/admin/rates/refresh', { method: 'POST', token });
      if (kq.ok) {
        // Đọc lại cả cấu hình: tỉ giá vừa được ghi ở phía máy chủ, không phải
        // do biểu mẫu này gửi lên.
        const moi = await apiFetch<AdminStoreSettingDto>('/admin/settings', { token });
        apply(moi);
        setRateMessage(t.admin.rateRefreshDone);
      } else {
        setRateMessage(`${t.admin.rateRefreshFailed} ${kq.reason ?? ''}`.trim());
      }
    } catch (err) {
      setRateMessage(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setRefreshingRate(false);
    }
  };

  const markDirty = () => {
    setSaved(false);
    setAddressError(null);
    setAiError(null);
    setSepayError(null);
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
    if (saving) return;

    if (cryptoEnabled && !bep20Address.trim() && !trc20Address.trim()) {
      setAddressError(t.admin.errCryptoAddressRequired);
      return;
    }
    setAddressError(null);
    // Bật nhận tiền mà chưa điền ID thì khách sẽ thấy một phương thức không
    // chuyển đi đâu được. Máy chủ cũng chặn, đây chỉ là báo sớm ngay tại ô nhập.
    if (binanceIdEnabled && !binanceId.trim()) {
      setBinanceIdError(t.admin.errBinanceIdRequired);
      return;
    }
    setBinanceIdError(null);
    // Anthropic có model mặc định, nhà cung cấp khác thì không đoán được.
    // Máy chủ cũng chặn; đây chỉ là báo sớm ngay tại ô nhập.
    if (aiProvider === 'openai' && aiModel.trim() === '') {
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
    if (sepayEnabled) {
      const rate = Number(vndPerUsdt);
      const thieuKhoa = sepayApiKey.trim() === '' && settings?.sepayApiKeySet !== true;
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
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const next = await apiFetch<AdminStoreSettingDto>('/admin/settings', {
        method: 'PUT',
        body: {
          mockEnabled,
          binancePayEnabled,
          binanceIdEnabled,
          binanceId: binanceId.trim(),
          binanceQr,
          sepayEnabled,
          sepayAccountNumber: sepayAccountNumber.trim(),
          sepayBank: sepayBank.trim(),
          sepayAccountHolder: sepayAccountHolder.trim(),
          vndPerUsdt: Number(vndPerUsdt) || 0,
          cnyPerUsdt: Number(cnyPerUsdt) || 0,
          rateAuto,
          rateMarkupPercent: Number(rateMarkupPercent) || 0,
          rateHour: Number(rateHour) || 0,
          displayCurrency,
          // Rỗng = giữ khoá cũ; máy chủ phân biệt bằng việc KHÔNG gửi trường.
          ...(sepayApiKey.trim() === '' ? {} : { sepayApiKey: sepayApiKey.trim() }),
          ...(sepayWebhookSecret.trim() === ''
            ? {}
            : { sepayWebhookSecret: sepayWebhookSecret.trim() }),
          cryptoEnabled,
          bep20Address: bep20Address.trim(),
          trc20Address: trc20Address.trim(),
          aiProvider,
          aiBaseUrl: aiBaseUrl.trim(),
          aiModel: aiModel.trim(),
          // Ba trạng thái: bấm xoá → chuỗi rỗng, có gõ → khoá mới, không đụng
          // tới → KHÔNG gửi trường này để máy chủ giữ nguyên khoá cũ.
          ...(clearAiKey
            ? { aiApiKey: '' }
            : aiKey.trim() !== ''
              ? { aiApiKey: aiKey.trim() }
              : {}),
          supportNote: supportNote.trim(),
          // Bỏ các dòng còn trống trước khi gửi.
          supportChannels: supportChannels
            .map((channel) => ({
              label: channel.label.trim(),
              value: channel.value.trim(),
              url: channel.url?.trim() ?? '',
            }))
            .filter((channel) => channel.label !== '' && channel.value !== ''),
        },
        token,
      });
      apply(next);
      setSaved(true);
    } catch (err) {
      setSaveError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setSaving(false);
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

      <div className="space-y-6">
        <Card className="p-6">
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" noValidate>
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

                  <Field
                    label={t.admin.settingVndRateLabel}
                    htmlFor="setting-vnd-rate"
                    hint={t.admin.settingVndRateHint}
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

                {settings?.sepayApiKeySet ? (
                  <p className="font-mono text-sm text-neutral-950">
                    {t.admin.settingApiKeySaved(settings.sepayApiKeyHint)}
                  </p>
                ) : null}

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

            {/*
              Tỉ giá: vừa dùng để dựng số tiền chuyển khoản VND, vừa dùng để hiện
              giá theo ngôn ngữ khách chọn. Vì thế nó nằm RIÊNG, không nhét trong
              khối SePay — tắt SePay thì vẫn cần tỉ giá để hiện giá.
            */}
            <div className="space-y-3 border-t border-neutral-100 pt-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
                  {t.admin.rateTitle}
                </h2>
                <p className="mt-0.5 text-sm text-neutral-500">{t.admin.rateHint}</p>
              </div>

              {/*
                Tiền hiện cho khách. "Theo ngôn ngữ" là mặc định; ép cứng một đơn
                vị dùng khi cửa hàng muốn niêm yết một giá duy nhất cho mọi khách.
              */}
              <Field label={t.admin.displayCurrencyLabel} htmlFor="setting-display-currency">
                <div id="setting-display-currency">
                  <Tabs
                    items={DISPLAY_CURRENCY_MODES.map((value) => ({
                      value,
                      label: t.admin.displayCurrencyModes[value],
                    }))}
                    value={displayCurrency}
                    onChange={(value) => {
                      setDisplayCurrency(value);
                      markDirty();
                    }}
                  />
                </div>
              </Field>

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
              {rateMessage && <p className="text-sm text-neutral-950">{rateMessage}</p>}
            </div>

            {cryptoEnabled && (
              <div className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                <Field
                  label={t.admin.settingBep20Label}
                  htmlFor="setting-bep20"
                  error={addressError}
                >
                  <Input
                    id="setting-bep20"
                    value={bep20Address}
                    invalid={Boolean(addressError)}
                    placeholder={t.admin.settingBep20Placeholder}
                    className="font-mono text-[13px]"
                    onChange={(event) => {
                      setBep20Address(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>
                <Field label={t.admin.settingTrc20Label} htmlFor="setting-trc20">
                  <Input
                    id="setting-trc20"
                    value={trc20Address}
                    invalid={Boolean(addressError)}
                    placeholder={t.admin.settingTrc20Placeholder}
                    className="font-mono text-[13px]"
                    onChange={(event) => {
                      setTrc20Address(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>
                <p className="text-xs text-neutral-500">{t.admin.settingAddressesHint}</p>
              </div>
            )}

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

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            {saved && !saveError && (
              <p className="text-sm font-medium text-emerald-600">{t.admin.settingsSaved}</p>
            )}

            <div className="border-t border-neutral-100 pt-4">
              <Button type="submit" loading={saving}>
                {t.common.save}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-6">
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
        </Card>
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
