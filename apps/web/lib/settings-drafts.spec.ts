import { describe, expect, it } from 'vitest';
import { createDraft, editDraft, settleDraft, isDraftDirty, settingsTab, settingsDrafts, settingsPayload, hasPolicyText, canRunSetup, policyDrafts, settlePolicy, mergeSettingsSection } from './settings-drafts';
import type { AdminStoreSettingDto } from '@webcatt/shared';

// Chặn mất bản nháp do phản hồi lưu hoặc lấy tỉ giá đến sau lần nhập tiếp theo.
describe('independent settings drafts', () => {
  it('persists payment discounts in the payment tab only and keeps edits made while saving', () => {
    const drafts=settingsDrafts();
    const sent={...drafts.payments.draft,paymentDiscounts:{binance_pay:10}};
    expect(settingsPayload('payments',sent).paymentDiscounts).toEqual({binance_pay:10});
    expect(settingsPayload('rates',drafts.rates.draft)).not.toHaveProperty('paymentDiscounts');
    const editing=editDraft(createDraft(sent),{paymentDiscounts:{binance_pay:15}});
    const settled=settleDraft(editing,sent,sent);
    expect(settled.draft.paymentDiscounts).toEqual({binance_pay:15});
    expect(isDraftDirty(settled)).toBe(true);
  });
  it('normalizes server values without replacing edits made during save', () => {
    const initial = createDraft({ title: 'Old', body: 'Old body' });
    const sent = { title: ' New ', body: 'New body' };
    const current = editDraft(editDraft(initial, sent), { body: 'Still typing' });
    const next = settleDraft(current, sent, { title: 'New', body: 'New body' });
    expect(next.draft).toEqual({ title: 'New', body: 'Still typing' });
    expect(next.baseline).toEqual({ title: 'New', body: 'New body' });
    expect(isDraftDirty(next)).toBe(true);
    expect(next.saved).toBe(false);
  });

  it('clears only the submitted secret, retaining a new replacement typed in flight', () => {
    const sent = { aiKey: 'sent-key', clearAiKey: false };
    const current = editDraft(createDraft({ aiKey: '', clearAiKey: false }), sent);
    expect(settleDraft(current, sent, { aiKey: '', clearAiKey: false }).draft.aiKey).toBe('');
    const editing = editDraft(current, { aiKey: 'next-key' });
    expect(settleDraft(editing, sent, { aiKey: '', clearAiKey: false }).draft.aiKey).toBe('next-key');
  });

  it('keeps state isolated when another group settles', () => {
    const support = editDraft(createDraft({ supportNote: 'before' }), { supportNote: 'unsaved' });
    const rates = createDraft({ vndPerUsdt: '25000' });
    const groups = { support, rates };
    const next = { ...groups, rates: settleDraft(rates, rates.draft, { vndPerUsdt: '26000' }) };
    expect(next.support).toBe(support);
    expect(next.rates.draft.vndPerUsdt).toBe('26000');
  });

  it('accepts only supported URL tabs', () => {
    expect(settingsTab('rates')).toBe('rates');
    expect(settingsTab('ai')).toBe('ai');
    expect(settingsTab('support')).toBe('support');
    expect(settingsTab('unknown')).toBe('payments');
    expect(settingsTab(null)).toBe('payments');
  });
});

const fixture = {
  mockEnabled: false, binancePayEnabled: false, binanceIdEnabled: false, binanceId: '', binanceQr: '',
  cryptoEnabled: false, bep20Address: '', trc20Address: '', sepayEnabled: false,
  sepayAccountNumber: '', sepayBank: '', sepayAccountHolder: '',
  vndPerUsdt: 25000, cnyPerUsdt: 7, rateAuto: false, rateMarkupPercent: 1, rateHour: 7,
  rateUpdatedAt: null, rateSource: '', sepayApiKeySet: true, sepayApiKeyHint: '1234', sepayWebhookSecretSet: true,
  aiProvider: 'anthropic', aiBaseUrl: '', aiModel: '', aiKeySet: true, aiKeyHint: '1234',
  telegramBotEnabled: false, telegramBotTokenSet: false, telegramBotTokenHint: '', telegramSendAnnouncement: false,
  telegramStockAlertsEnabled: false, telegramOwnerChatId: '', telegramOwnerOrderAlertsEnabled: false,
  telegramOwnerStuckAlertsEnabled: false, telegramOwnerStuckMinutes: 10, telegramOwnerLowStockAlertsEnabled: false,
  telegramOwnerLowStockThreshold: 0, telegramGreeting: '', telegramMembershipRequired: false,
  telegramMembershipChatId: '', telegramMembershipJoinUrl: '', supportChannels: [], supportNote: '',
} satisfies AdminStoreSettingDto;

describe('section PATCH payload contract', () => {
  it('omits retained secrets and does not cross section boundaries', () => {
    const groups = settingsDrafts(fixture);
    const payments = settingsPayload('payments', groups.payments.draft);
    expect(payments).not.toHaveProperty('sepayApiKey');
    expect(payments).not.toHaveProperty('sepayWebhookSecret');
    expect(payments).not.toHaveProperty('vndPerUsdt');
    expect(payments).not.toHaveProperty('aiProvider');
    expect(settingsPayload('rates', groups.rates.draft)).toEqual({ vndPerUsdt: 25000, cnyPerUsdt: 7, rateAuto: false, rateMarkupPercent: 1, rateHour: 7 });
    expect(settingsPayload('support', groups.support.draft)).toEqual({ supportNote: '', supportChannels: [] });
    expect(settingsPayload('ai', groups.ai.draft)).toEqual({ aiProvider: 'anthropic', aiBaseUrl: '', aiModel: '' });
  });

  it('sends deletion only on explicit intent; whitespace means retain', () => {
    const groups = settingsDrafts(fixture);
    expect(settingsPayload('ai', { ...groups.ai.draft, aiKey: ' ' })).not.toHaveProperty('aiApiKey');
    expect(settingsPayload('ai', { ...groups.ai.draft, clearAiKey: true })).toHaveProperty('aiApiKey', '');
    expect(settingsPayload('payments', { ...groups.payments.draft, clearSepayApiKey: true })).toHaveProperty('sepayApiKey', '');
    expect(settingsPayload('payments', { ...groups.payments.draft, sepayWebhookSecret: ' next ' })).toHaveProperty('sepayWebhookSecret', 'next');
  });

  it('trims contacts and excludes incomplete rows without mutating draft', () => {
    const groups = settingsDrafts(fixture);
    const draft = { ...groups.support.draft, supportNote: ' hello ', supportChannels: [{ label: ' Chat ', value: ' cat ', url: ' https://example.com ' }, { label: '', value: '' }] };
    expect(settingsPayload('support', draft)).toEqual({ supportNote: 'hello', supportChannels: [{ label: 'Chat', value: 'cat', url: 'https://example.com' }] });
    expect(draft.supportNote).toBe(' hello ');
  });
});

describe('policy and setup boundaries', () => {
  it('settles the submitted policy only, rejects a mismatched response slug', () => {
    const policies = policyDrafts([{ slug: 'terms', title: 'Terms', body: 'Old terms', updatedAt: '2026-01-01' }]);
    policies.refund = editDraft(policies.refund, { body: 'Refund draft' });
    policies.terms = editDraft(policies.terms, { body: 'New terms' });
    const sent = policies.terms.draft;
    const next = settlePolicy(policies, 'terms', sent, { slug: 'terms', title: 'Terms', body: 'New terms', updatedAt: '2026-09-17' });
    expect(next.refund).toBe(policies.refund);
    expect(next.refund.draft.body).toBe('Refund draft');
    expect(next.terms.saved).toBe(true);
    expect(() => settlePolicy(policies, 'terms', sent, { slug: 'privacy', title: 'Privacy', body: 'Wrong', updatedAt: '' })).toThrow();
  });
  it('merges rate metadata without accepting other settings from an old response', () => {
    const current = { ...fixture, supportNote: 'Just saved', aiKeySet: false };
    const next = mergeSettingsSection(current, { ...fixture, vndPerUsdt: 26000, rateSource: 'feed' }, 'rates');
    expect(next.supportNote).toBe('Just saved');
    expect(next.aiKeySet).toBe(false);
    expect(next.vndPerUsdt).toBe(26000);
    expect(next.rateSource).toBe('feed');
  });
  it('treats markup and whitespace entities as empty, not a published policy', () => {
    expect(hasPolicyText('<p>&nbsp; &#160; &#xA0; <br></p>')).toBe(false);
    expect(hasPolicyText('<p>Store policy</p>')).toBe(true);
  });
  it('allows privileged setup operations only for SUPERADMIN', () => {
    expect(canRunSetup('SUPERADMIN')).toBe(true);
    expect(canRunSetup('ADMIN')).toBe(false);
    expect(canRunSetup(undefined)).toBe(false);
  });
});
