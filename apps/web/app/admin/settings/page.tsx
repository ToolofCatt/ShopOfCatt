'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Plus, PlugZap, ServerCrash, ShieldAlert, Trash2 } from 'lucide-react';
import {
  SUPPORT_CHANNELS_MAX,
  SUPPORT_FIELD_MAX_LENGTH,
  SUPPORT_NOTE_MAX_LENGTH,
  VIETQR_BANKS,
  type AdminStoreSettingDto,
  type BinanceStatusDto,
  type SupportChannelDto,
} from '@webcatt/shared';
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
import { formatAmount } from '@/components/admin/helpers';

/** Một dòng bật/tắt phương thức thanh toán: checkbox + tên + mô tả ngắn. */
function ToggleRow({
  id,
  checked,
  disabled = false,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-neutral-200 p-3.5 transition-colors',
        disabled ? 'opacity-60' : 'cursor-pointer hover:border-neutral-400',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-neutral-950 disabled:cursor-not-allowed"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-neutral-950">{label}</span>
        <span className="mt-0.5 block text-xs text-neutral-500">{hint}</span>
      </span>
    </label>
  );
}

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
  const { t } = useI18n();

  const [settings, setSettings] = useState<AdminStoreSettingDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mockEnabled, setMockEnabled] = useState(false);
  const [binancePayEnabled, setBinancePayEnabled] = useState(false);
  const [cryptoEnabled, setCryptoEnabled] = useState(false);
  const [bep20Address, setBep20Address] = useState('');
  const [trc20Address, setTrc20Address] = useState('');
  const [bankTransferEnabled, setBankTransferEnabled] = useState(false);
  const [bankBin, setBankBin] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [usdtVndRate, setUsdtVndRate] = useState('');
  const [supportNote, setSupportNote] = useState('');
  const [supportChannels, setSupportChannels] = useState<SupportChannelDto[]>([]);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);

  const [status, setStatus] = useState<BinanceStatusDto | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  /** Đồng bộ biểu mẫu với cấu hình máy chủ vừa trả về. */
  const apply = (next: AdminStoreSettingDto) => {
    setSettings(next);
    setMockEnabled(next.mockEnabled);
    setBinancePayEnabled(next.binancePayEnabled);
    setCryptoEnabled(next.cryptoEnabled);
    setBep20Address(next.bep20Address);
    setTrc20Address(next.trc20Address);
    setBankTransferEnabled(next.bankTransferEnabled);
    setBankBin(next.bankBin);
    setBankAccountNumber(next.bankAccountNumber);
    setBankAccountName(next.bankAccountName);
    setUsdtVndRate(next.usdtVndRate > 0 ? String(next.usdtVndRate) : '');
    setSupportNote(next.supportNote);
    setSupportChannels(next.supportChannels);
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

  const markDirty = () => {
    setSaved(false);
    setAddressError(null);
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
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const next = await apiFetch<AdminStoreSettingDto>('/admin/settings', {
        method: 'PUT',
        body: {
          mockEnabled,
          binancePayEnabled,
          cryptoEnabled,
          bep20Address: bep20Address.trim(),
          trc20Address: trc20Address.trim(),
          bankTransferEnabled,
          bankBin: bankBin.trim(),
          bankAccountNumber: bankAccountNumber.trim(),
          bankAccountName: bankAccountName.trim(),
          usdtVndRate: usdtVndRate.trim() === '' ? 0 : Number(usdtVndRate),
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

            {/* Chuyển khoản ngân hàng VN — giá niêm yết là USDT nên bắt buộc
                có tỉ giá mới sinh được số tiền VND cho mã QR. */}
            <ToggleRow
              id="setting-bank"
              checked={bankTransferEnabled}
              onChange={(value) => {
                setBankTransferEnabled(value);
                markDirty();
              }}
              label={t.admin.settingBankTransfer}
              hint={t.admin.settingBankTransferHint}
            />

            {bankTransferEnabled && (
              <div className="space-y-4 rounded-lg border border-neutral-200 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t.admin.settingBankLabel} htmlFor="setting-bank-bin">
                    <select
                      id="setting-bank-bin"
                      value={bankBin}
                      onChange={(event) => {
                        setBankBin(event.target.value);
                        markDirty();
                      }}
                      className="h-10 w-full cursor-pointer rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition-colors focus:border-neutral-950"
                    >
                      <option value="">{t.admin.settingBankPick}</option>
                      {VIETQR_BANKS.map((bank) => (
                        <option key={bank.bin} value={bank.bin}>
                          {bank.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label={t.admin.settingBankAccountLabel}
                    htmlFor="setting-bank-account"
                  >
                    <Input
                      id="setting-bank-account"
                      inputMode="numeric"
                      className="font-mono"
                      value={bankAccountNumber}
                      onChange={(event) => {
                        setBankAccountNumber(event.target.value.replace(/\D/g, ''));
                        markDirty();
                      }}
                    />
                  </Field>
                </div>
                <Field
                  label={t.admin.settingBankHolderLabel}
                  htmlFor="setting-bank-holder"
                  hint={t.admin.settingBankHolderHint}
                >
                  <Input
                    id="setting-bank-holder"
                    value={bankAccountName}
                    onChange={(event) => {
                      setBankAccountName(event.target.value.toUpperCase());
                      markDirty();
                    }}
                  />
                </Field>
                <Field
                  label={t.admin.settingRateLabel}
                  htmlFor="setting-rate"
                  hint={t.admin.settingRateHint}
                >
                  <Input
                    id="setting-rate"
                    inputMode="decimal"
                    className="tabular-nums"
                    placeholder="26000"
                    value={usdtVndRate}
                    onChange={(event) => {
                      setUsdtVndRate(event.target.value.replace(/[^\d.]/g, ''));
                      markDirty();
                    }}
                  />
                </Field>
              </div>
            )}

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
