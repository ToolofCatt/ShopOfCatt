import { LEGAL_PAGE_SLUGS, type LegalPageDto, type LegalPageSlug, type AdminStoreSettingDto, type AiProvider, type SupportChannelDto } from '@webcatt/shared';

export const SETTINGS_TABS = ['payments', 'rates', 'ai', 'support'] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];
export function settingsTab(value: string | null): SettingsTab {
  return SETTINGS_TABS.find((tab) => tab === value) ?? 'payments';
}

export interface DraftState<T> {
  baseline: T;
  draft: T;
  saving: boolean;
  saved: boolean;
  error: string | null;
}
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export function createDraft<T>(value: T): DraftState<T> {
  return { baseline: value, draft: value, saving: false, saved: false, error: null };
}
export function isDraftDirty(state: { baseline: unknown; draft: unknown }): boolean {
  return !equal(state.baseline, state.draft);
}
export function editDraft<T>(state: DraftState<T>, patch: Partial<T>): DraftState<T> {
  return { ...state, draft: { ...state.draft, ...patch }, saved: false, error: null };
}

/** Phản hồi chỉ chuẩn hoá ô chưa sửa tiếp; từng tab giữ baseline riêng. */
export function settleDraft<T extends object>(state: DraftState<T>, sent: T, received: T): DraftState<T> {
  const draft = { ...state.draft };
  for (const key of Object.keys(received) as (keyof T)[]) {
    if (equal(state.draft[key], sent[key])) draft[key] = received[key];
  }
  return { baseline: received, draft, saving: false, saved: equal(draft, received), error: null };
}

export interface SettingsValues {
  payments: Pick<AdminStoreSettingDto, 'paymentDiscounts' | 'mockEnabled' | 'binancePayEnabled' | 'binanceIdEnabled' | 'binanceId' | 'binanceQr' | 'cryptoEnabled' | 'bep20Address' | 'trc20Address' | 'sepayEnabled' | 'sepayAccountNumber' | 'sepayBank' | 'sepayAccountHolder'> & {
    sepayApiKey: string; sepayWebhookSecret: string; clearSepayApiKey: boolean; clearSepayWebhookSecret: boolean;
  };
  rates: { vndPerUsdt: string; cnyPerUsdt: string; rateAuto: boolean; rateMarkupPercent: string; rateHour: string };
  ai: { aiProvider: AiProvider; aiBaseUrl: string; aiModel: string; aiKey: string; clearAiKey: boolean };
  support: { supportNote: string; supportChannels: SupportChannelDto[] };
}
export type SettingsDrafts = { [K in SettingsTab]: DraftState<SettingsValues[K]> };

export function settingsDrafts(next?: AdminStoreSettingDto): SettingsDrafts {
  return {
    payments: createDraft({
      paymentDiscounts: next?.paymentDiscounts ?? {},
      mockEnabled: next?.mockEnabled ?? false, binancePayEnabled: next?.binancePayEnabled ?? false,
      binanceIdEnabled: next?.binanceIdEnabled ?? false, binanceId: next?.binanceId ?? '', binanceQr: next?.binanceQr ?? '',
      cryptoEnabled: next?.cryptoEnabled ?? false, bep20Address: next?.bep20Address ?? '', trc20Address: next?.trc20Address ?? '',
      sepayEnabled: next?.sepayEnabled ?? false, sepayAccountNumber: next?.sepayAccountNumber ?? '',
      sepayBank: next?.sepayBank ?? '', sepayAccountHolder: next?.sepayAccountHolder ?? '',
      sepayApiKey: '', sepayWebhookSecret: '', clearSepayApiKey: false, clearSepayWebhookSecret: false,
    }),
    rates: createDraft({ vndPerUsdt: String(next?.vndPerUsdt ?? 0), cnyPerUsdt: String(next?.cnyPerUsdt ?? 0), rateAuto: next?.rateAuto ?? false, rateMarkupPercent: String(next?.rateMarkupPercent ?? 0), rateHour: String(next?.rateHour ?? 7) }),
    ai: createDraft({ aiProvider: next?.aiProvider ?? 'anthropic', aiBaseUrl: next?.aiBaseUrl ?? '', aiModel: next?.aiModel ?? '', aiKey: '', clearAiKey: false }),
    support: createDraft({ supportNote: next?.supportNote ?? '', supportChannels: next?.supportChannels ?? [] }),
  };
}

function secretPatch(key: string, value: string, clear: boolean): Record<string, string> {
  return clear ? { [key]: '' } : value.trim() ? { [key]: value.trim() } : {};
}

/** Chỉ gửi trường thuộc tab đang lưu, không gửi nhầm bí mật hay bản nháp tab khác. */
export function settingsPayload<K extends SettingsTab>(tab: K, draft: SettingsValues[K]): Record<string, unknown> {
  if (tab === 'payments') {
    const d = draft as SettingsValues['payments'];
    return {
      paymentDiscounts: d.paymentDiscounts ?? {},
      mockEnabled: d.mockEnabled, binancePayEnabled: d.binancePayEnabled, binanceIdEnabled: d.binanceIdEnabled,
      binanceId: d.binanceId.trim(), binanceQr: d.binanceQr, cryptoEnabled: d.cryptoEnabled,
      bep20Address: d.bep20Address.trim(), trc20Address: d.trc20Address.trim(), sepayEnabled: d.sepayEnabled,
      sepayAccountNumber: d.sepayAccountNumber.trim(), sepayBank: d.sepayBank.trim(), sepayAccountHolder: d.sepayAccountHolder.trim(),
      ...secretPatch('sepayApiKey', d.sepayApiKey, d.clearSepayApiKey),
      ...secretPatch('sepayWebhookSecret', d.sepayWebhookSecret, d.clearSepayWebhookSecret),
    };
  }
  if (tab === 'rates') {
    const d = draft as SettingsValues['rates'];
    return { vndPerUsdt: Number(d.vndPerUsdt), cnyPerUsdt: Number(d.cnyPerUsdt), rateAuto: d.rateAuto, rateMarkupPercent: Number(d.rateMarkupPercent), rateHour: Number(d.rateHour) };
  }
  if (tab === 'ai') {
    const d = draft as SettingsValues['ai'];
    return { aiProvider: d.aiProvider, aiBaseUrl: d.aiBaseUrl.trim(), aiModel: d.aiModel.trim(), ...secretPatch('aiApiKey', d.aiKey, d.clearAiKey) };
  }
  const d = draft as SettingsValues['support'];
  return {
    supportNote: d.supportNote.trim(),
    supportChannels: d.supportChannels.map((channel) => ({ label: channel.label.trim(), value: channel.value.trim(), url: channel.url?.trim() ?? '' })).filter((channel) => channel.label && channel.value),
  };
}

/** Không thay trạng thái tab khác bằng bản snapshot có thể đã cũ của API. */
export function mergeSettingsSection(current: AdminStoreSettingDto, next: AdminStoreSettingDto, tab: SettingsTab): AdminStoreSettingDto {
  const keys = Object.keys(settingsDrafts(next)[tab].draft) as (keyof AdminStoreSettingDto)[];
  const metadata: Record<SettingsTab, (keyof AdminStoreSettingDto)[]> = {
    payments: ['sepayApiKeySet', 'sepayApiKeyHint', 'sepayWebhookSecretSet'],
    rates: ['rateUpdatedAt', 'rateSource'], ai: ['aiKeySet', 'aiKeyHint'], support: [],
  };
  const patch = Object.fromEntries([...keys, ...metadata[tab]].filter((key) => key in next).map((key) => [key, next[key]]));
  return { ...current, ...patch };
}

export function hasPolicyText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ').trim() !== '';
}
export function canRunSetup(role: string | undefined): boolean { return role === 'SUPERADMIN'; }

export type PolicyValues = Pick<LegalPageDto, 'title' | 'body'>;
export type PolicyDrafts = Record<LegalPageSlug, DraftState<PolicyValues>>;
export function policyDrafts(pages: LegalPageDto[]): PolicyDrafts {
  return Object.fromEntries(LEGAL_PAGE_SLUGS.map((slug) => {
    const page = pages.find((entry) => entry.slug === slug);
    return [slug, createDraft({ title: page?.title ?? '', body: page?.body ?? '' })];
  })) as PolicyDrafts;
}
export function settlePolicy(current: PolicyDrafts, slug: LegalPageSlug, sent: PolicyValues, updated: LegalPageDto): PolicyDrafts {
  // Không bao giờ ghi phản hồi của slug khác vào chính sách đang soạn.
  if (updated.slug !== slug) throw new Error('Policy response mismatch');
  return { ...current, [slug]: settleDraft(current[slug], sent, { title: updated.title, body: updated.body }) };
}
