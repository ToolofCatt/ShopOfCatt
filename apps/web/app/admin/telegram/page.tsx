'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, RefreshCw, Send } from 'lucide-react';
import {
  TELEGRAM_GREETING_MAX_LENGTH,
  type AdminStoreSettingDto,
  type TelegramStatusDto,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { Button, Card, Field, Input, Spinner } from '@/components/ui';
import { PageHeader } from '@/components/admin/page-header';
import { TelegramSimulator } from '@/components/admin/telegram-simulator';
import { ToggleRow } from '@/components/admin/toggle-row';
import { TEXTAREA_CLASSES } from '@/components/admin/helpers';

export default function AdminTelegramPage() {
  const { token } = useAuth();
  const { t } = useI18n();

  const [settings, setSettings] = useState<AdminStoreSettingDto | null>(null);
  const [status, setStatus] = useState<TelegramStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  // Ô token: rỗng nghĩa là "giữ token cũ" — token thật không bao giờ xuống đây.
  const [tokenInput, setTokenInput] = useState('');
  const [sendAnnouncement, setSendAnnouncement] = useState(true);
  const [stockAlertsEnabled, setStockAlertsEnabled] = useState(true);
  const [ownerChatId, setOwnerChatId] = useState('');
  const [ownerOrderAlerts, setOwnerOrderAlerts] = useState(true);
  const [ownerStuckAlerts, setOwnerStuckAlerts] = useState(true);
  const [ownerStuckMinutes, setOwnerStuckMinutes] = useState(5);
  const [ownerLowStockAlerts, setOwnerLowStockAlerts] = useState(true);
  const [ownerLowStockThreshold, setOwnerLowStockThreshold] = useState(3);
  const [greeting, setGreeting] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testingOwner, setTestingOwner] = useState(false);
  const [ownerTestSent, setOwnerTestSent] = useState(false);

  /** Tăng sau mỗi lần lưu → trình giả lập chạy lại cuộc trò chuyện từ đầu. */
  const [simKey, setSimKey] = useState(0);

  const applySettings = (next: AdminStoreSettingDto) => {
    setSettings(next);
    setEnabled(next.telegramBotEnabled);
    setSendAnnouncement(next.telegramSendAnnouncement);
    setStockAlertsEnabled(next.telegramStockAlertsEnabled);
    setOwnerChatId(next.telegramOwnerChatId);
    setOwnerOrderAlerts(next.telegramOwnerOrderAlertsEnabled);
    setOwnerStuckAlerts(next.telegramOwnerStuckAlertsEnabled);
    setOwnerStuckMinutes(next.telegramOwnerStuckMinutes);
    setOwnerLowStockAlerts(next.telegramOwnerLowStockAlertsEnabled);
    setOwnerLowStockThreshold(next.telegramOwnerLowStockThreshold);
    setGreeting(next.telegramGreeting);
    setTokenInput('');
  };

  const refreshStatus = useCallback(async () => {
    if (!token) return;
    try {
      setStatus(await apiFetch<TelegramStatusDto>('/admin/telegram/status', { token }));
    } catch {
      // Trạng thái chỉ là thông tin phụ — lỗi thoáng qua thì giữ giá trị cũ.
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const [nextSettings] = await Promise.all([
          apiFetch<AdminStoreSettingDto>('/admin/settings', { token }),
          refreshStatus(),
        ]);
        if (!cancelled) applySettings(nextSettings);
      } catch (err) {
        if (!cancelled) setLoadError(apiErrorMessage(err, t.common.connectionError));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const save = async () => {
    if (!token || saving) return;
    // Ô rỗng nghĩa là "giữ token cũ", nên chỉ coi là thiếu khi máy chủ cũng
    // báo chưa có token nào — cùng lối với khoá API SePay bên trang Cài đặt.
    if (enabled && tokenInput.trim() === '' && settings?.telegramBotTokenSet !== true) {
      setFormError(t.admin.errTelegramTokenRequired);
      return;
    }
    setFormError(null);
    setSaving(true);
    setSaved(false);
    try {
      const next = await apiFetch<AdminStoreSettingDto>('/admin/telegram/settings', {
        method: 'PUT',
        body: {
          telegramBotEnabled: enabled,
          telegramSendAnnouncement: sendAnnouncement,
          telegramStockAlertsEnabled: stockAlertsEnabled,
          telegramOwnerChatId: ownerChatId.trim(),
          telegramOwnerOrderAlertsEnabled: ownerOrderAlerts,
          telegramOwnerStuckAlertsEnabled: ownerStuckAlerts,
          telegramOwnerStuckMinutes: ownerStuckMinutes,
          telegramOwnerLowStockAlertsEnabled: ownerLowStockAlerts,
          telegramOwnerLowStockThreshold: ownerLowStockThreshold,
          telegramGreeting: greeting.trim(),
          // Rỗng = giữ token cũ; máy chủ phân biệt bằng việc KHÔNG gửi trường.
          ...(tokenInput.trim() === '' ? {} : { telegramBotToken: tokenInput.trim() }),
        },
        token,
      });
      applySettings(next);
      setSaved(true);
      // Lời chào / công tắc thông báo đổi là bản xem trước phải diễn lại theo.
      setSimKey((key) => key + 1);
      void refreshStatus();
    } catch (err) {
      setFormError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setSaving(false);
    }
  };

  const sendOwnerTest = async () => {
    if (!token || testingOwner || ownerChatId.trim() === '') return;
    setTestingOwner(true);
    setOwnerTestSent(false);
    setFormError(null);
    try {
      await apiFetch<{ ok: true }>('/admin/telegram/owner-test', {
        method: 'POST',
        token,
      });
      setOwnerTestSent(true);
      void refreshStatus();
    } catch (err) {
      setFormError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setTestingOwner(false);
    }
  };

  const statusText =
    status === null
      ? ''
      : status.running && status.botUsername
        ? t.admin.telegramStatusRunning(status.botUsername)
        : status.enabled && status.tokenSet
          ? t.admin.telegramStatusConnecting
          : t.admin.telegramStatusStopped;

  if (loadError && settings === null) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title={t.admin.navTelegram} description={t.admin.telegramPageHint} />
        <Card className="p-6 text-sm text-red-600">{loadError}</Card>
      </div>
    );
  }

  if (settings === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t.admin.navTelegram} description={t.admin.telegramPageHint} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
        {/* ------------------------------ Cấu hình ------------------------------ */}
        <Card className="space-y-5 p-6">
          {/* Trạng thái sống của bot */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  status?.running
                    ? 'bg-emerald-500'
                    : status?.enabled
                      ? 'bg-amber-500'
                      : 'bg-neutral-300',
                )}
              />
              <span className="font-medium text-neutral-950">{t.admin.telegramStatusTitle}:</span>
              <span className="text-neutral-700">{statusText}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshStatus()}>
              <RefreshCw strokeWidth={1.75} className="h-3.5 w-3.5" />
              {t.admin.telegramStatusRefresh}
            </Button>
            {status?.lastError && <p className="w-full text-xs text-red-600">{status.lastError}</p>}
            {status?.lastSuccessAt && (
              <p className="w-full text-xs text-neutral-500">
                {t.admin.telegramLastSuccess(new Date(status.lastSuccessAt).toLocaleString())}
                {status.consecutiveFailures > 0
                  ? ` · ${t.admin.telegramFailureCount(status.consecutiveFailures)}`
                  : ''}
              </p>
            )}
            {status?.lastFailureAt && (
              <p className="w-full text-xs text-neutral-500">
                {t.admin.telegramLastFailure(new Date(status.lastFailureAt).toLocaleString())}
              </p>
            )}
          </div>

          <ToggleRow
            id="telegram-enabled"
            checked={enabled}
            onChange={(checked) => {
              setEnabled(checked);
              setSaved(false);
              setFormError(null);
            }}
            label={t.admin.settingTelegramEnable}
            hint={t.admin.settingTelegramEnableHint}
          />

          <div className="space-y-2">
            {settings.telegramBotTokenSet ? (
              <p className="font-mono text-sm text-neutral-950">
                {t.admin.settingApiKeySaved(settings.telegramBotTokenHint)}
              </p>
            ) : null}
            <Field
              label={
                settings.telegramBotTokenSet
                  ? t.admin.settingTelegramTokenReplaceLabel
                  : t.admin.settingTelegramTokenLabel
              }
              htmlFor="telegram-token"
              hint={t.admin.settingTelegramTokenHint}
            >
              <Input
                id="telegram-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={tokenInput}
                className="font-mono text-[13px]"
                onChange={(event) => {
                  setTokenInput(event.target.value);
                  setSaved(false);
                  setFormError(null);
                }}
              />
            </Field>

            {/* Hướng dẫn tạo bot — cho chủ shop chưa từng đụng @BotFather. */}
            {!settings.telegramBotTokenSet && (
              <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2.5">
                <p className="text-xs font-medium text-neutral-950">{t.admin.telegramGuideTitle}</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-neutral-600">
                  <li>{t.admin.telegramGuideStep1}</li>
                  <li>{t.admin.telegramGuideStep2}</li>
                  <li>{t.admin.telegramGuideStep3}</li>
                </ol>
              </div>
            )}
          </div>

          <ToggleRow
            id="telegram-send-announcement"
            checked={sendAnnouncement}
            onChange={(checked) => {
              setSendAnnouncement(checked);
              setSaved(false);
            }}
            label={t.admin.telegramSendAnnouncementLabel}
            hint={t.admin.telegramSendAnnouncementHint}
          />

          <ToggleRow
            id="telegram-stock-alerts"
            checked={stockAlertsEnabled}
            onChange={(checked) => {
              setStockAlertsEnabled(checked);
              setSaved(false);
            }}
            label={t.admin.telegramStockAlertsLabel}
            hint={t.admin.telegramStockAlertsHint}
          />

          <div className="space-y-4 border-t border-neutral-200 pt-5">
            <div className="flex items-start gap-3">
              <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-neutral-700" strokeWidth={1.75} />
              <div>
                <h2 className="text-base font-semibold text-neutral-950">
                  {t.admin.telegramOwnerAlertsTitle}
                </h2>
                <p className="mt-0.5 text-sm text-neutral-500">{t.admin.telegramOwnerAlertsHint}</p>
              </div>
            </div>

            <Field
              label={t.admin.telegramOwnerChatLabel}
              htmlFor="telegram-owner-chat"
              hint={t.admin.telegramOwnerChatHint}
            >
              <Input
                id="telegram-owner-chat"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={ownerChatId}
                placeholder="123456789 hoặc -100…"
                className="font-mono text-[13px]"
                onChange={(event) => {
                  setOwnerChatId(event.target.value);
                  setSaved(false);
                  setOwnerTestSent(false);
                  setFormError(null);
                }}
              />
            </Field>

            <ToggleRow
              id="telegram-owner-order-alerts"
              checked={ownerOrderAlerts}
              onChange={(checked) => {
                setOwnerOrderAlerts(checked);
                setSaved(false);
              }}
              label={t.admin.telegramOwnerOrderAlertsLabel}
              hint={t.admin.telegramOwnerOrderAlertsHint}
            />

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-end">
              <ToggleRow
                id="telegram-owner-stuck-alerts"
                checked={ownerStuckAlerts}
                onChange={(checked) => {
                  setOwnerStuckAlerts(checked);
                  setSaved(false);
                }}
                label={t.admin.telegramOwnerStuckAlertsLabel}
                hint={t.admin.telegramOwnerStuckAlertsHint}
              />
              <Field
                label={t.admin.telegramOwnerStuckMinutesLabel}
                htmlFor="telegram-owner-stuck-minutes"
              >
                <Input
                  id="telegram-owner-stuck-minutes"
                  type="number"
                  min={5}
                  max={1440}
                  disabled={!ownerStuckAlerts}
                  value={ownerStuckMinutes}
                  onChange={(event) => {
                    setOwnerStuckMinutes(Number(event.target.value));
                    setSaved(false);
                  }}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-end">
              <ToggleRow
                id="telegram-owner-stock-alerts"
                checked={ownerLowStockAlerts}
                onChange={(checked) => {
                  setOwnerLowStockAlerts(checked);
                  setSaved(false);
                }}
                label={t.admin.telegramOwnerLowStockAlertsLabel}
                hint={t.admin.telegramOwnerLowStockAlertsHint}
              />
              <Field
                label={t.admin.telegramOwnerLowStockThresholdLabel}
                htmlFor="telegram-owner-stock-threshold"
              >
                <Input
                  id="telegram-owner-stock-threshold"
                  type="number"
                  min={0}
                  max={10000}
                  disabled={!ownerLowStockAlerts}
                  value={ownerLowStockThreshold}
                  onChange={(event) => {
                    setOwnerLowStockThreshold(Number(event.target.value));
                    setSaved(false);
                  }}
                />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                loading={testingOwner}
                disabled={
                  ownerChatId.trim() === '' || ownerChatId.trim() !== settings.telegramOwnerChatId
                }
                onClick={() => void sendOwnerTest()}
              >
                <Send className="h-4 w-4" strokeWidth={1.75} />
                {t.admin.telegramOwnerSendTest}
              </Button>
              {ownerTestSent && (
                <span className="text-sm text-emerald-700">{t.admin.telegramOwnerTestSent}</span>
              )}
              {ownerChatId.trim() !== settings.telegramOwnerChatId && (
                <span className="text-xs text-neutral-500">
                  {t.admin.telegramOwnerSaveBeforeTest}
                </span>
              )}
            </div>
          </div>

          <Field
            label={t.admin.telegramGreetingLabel}
            htmlFor="telegram-greeting"
            hint={t.admin.telegramGreetingHint}
          >
            <textarea
              id="telegram-greeting"
              rows={3}
              maxLength={TELEGRAM_GREETING_MAX_LENGTH}
              value={greeting}
              className={TEXTAREA_CLASSES}
              onChange={(event) => {
                setGreeting(event.target.value);
                setSaved(false);
              }}
            />
          </Field>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex items-center gap-3">
            <Button loading={saving} onClick={() => void save()}>
              {t.common.save}
            </Button>
            {saved && <span className="text-sm text-emerald-700">{t.admin.settingsSaved}</span>}
          </div>
        </Card>

        {/* ------------------------------ Giả lập ------------------------------ */}
        <Card className="space-y-4 p-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
              {t.admin.telegramPreviewTitle}
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">{t.admin.telegramPreviewHint}</p>
          </div>
          <TelegramSimulator botName={status?.botUsername ?? null} refreshKey={simKey} />
        </Card>
      </div>
    </div>
  );
}
