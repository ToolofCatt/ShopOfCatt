import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderDetailDto } from '@webcatt/shared';
import { TelegramService } from './telegram.service';
import { encodeCallback, type BotCallback } from './catalog-view';
import { K, translate } from '../i18n/messages';
import type { TgCallbackQuery } from './telegram-api';

const TOKEN = '123456:fixture';
const STOP = new AbortController().signal;
type Internals = {
  activeToken: string | null;
  handleCallback(token: string, cb: TgCallbackQuery, stop: AbortSignal): Promise<void>;
  notifySweep(): Promise<void>;
};

function fixture(options: { locked?: boolean; long?: boolean; failure?: number; documentFailure?: number; deposit?: boolean; initializing?: boolean } = {}) {
  const user = { id: 'u1', code: 100001, telegramLangChosen: true, telegramLang: 'vi', telegramChatId: '100001', balance: 20, lockedAt: options.locked ? new Date() : null };
  const lines = options.long ? ['PREFIX|' + '<>&🔑'.repeat(1500) + '|SUFFIX', 'SECOND-KEY'] : ['TEST-KEY'];
  const detail: OrderDetailDto = {
    id: 'o1', code: 'DH-FIXTURE', status: 'DELIVERED', subtotalAmount: 5, totalAmount: 5,
    discountAmount: 0, couponCode: null, currency: 'USDT', createdAt: new Date().toISOString(), paidAt: null, expiresAt: null,
    payment: { mode: 'MOCK', status: 'SUCCESS' },
    items: [{ id: 'i1', productId: 'p1', productSlug: 'test', productName: 'TEST-PRODUCT', variantName: 'TEST-VARIANT', unitPrice: 5, quantity: lines.length, deliveredLines: lines }],
  };
  if (options.initializing) {
    detail.status = 'PENDING';
    detail.payment = { mode: 'INITIALIZING' as NonNullable<OrderDetailDto['payment']>['mode'], status: 'PENDING' };
  }
  let orderNotified = false;
  let depositNotified = false;
  let mutations = 0;
  const sent: { method: string; body: Record<string, any> | FormData }[] = [];
  const events: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const method = String(url).split('/').pop()!;
    const body = init.body instanceof FormData ? init.body : JSON.parse(init.body);
    sent.push({ method, body });
    events.push(method);
    const fail = method === 'sendDocument' ? options.documentFailure : ['sendMessage', 'editMessageText'].includes(method) ? options.failure : undefined;
    return new Response(JSON.stringify(fail ? { ok: false, error_code: fail, description: 'fixture failure' } : { ok: true, result: { message_id: 1 } }), { status: fail ?? 200 });
  }));
  const mutate = async () => { mutations++; throw new Error('MUTATION_REACHED'); };
  const users = { findByChat: async () => user, findOrCreate: async () => user };
  const orders = { create: mutate, selectPayment: mutate, cancel: mutate, checkPayment: mutate, getOwnDetail: async () => detail };
  const payments = { confirmMock: mutate };
  const balance = {
    listDepositMethods: async () => ['crypto_bep20'], createDeposit: mutate, payOrderWithBalance: mutate,
    cancelDeposit: mutate, listUnnotifiedDeposits: async () => options.deposit && !depositNotified ? [{ id: 'd1', code: 'NAP-FIXTURE', chatId: user.telegramChatId, lang: 'vi', amountUsdt: 5, balance: 20 }] : [],
    markDepositNotified: async () => { depositNotified = true; events.push('deposit-mark'); },
  };
  const prisma = {
    order: {
      findUnique: async () => null, count: async () => 0,
      findMany: async () => !options.deposit && !orderNotified ? [{ id: detail.id, code: detail.code, userId: user.id, user }] : [],
      updateMany: async () => { orderNotified = true; events.push('order-mark'); return { count: 1 }; },
    },
    telegramStockAlertRecipient: { findMany: async () => [] },
    telegramStockAlert: { deleteMany: async () => ({ count: 0 }) },
  };
  const settings = { getPublicRates: async () => null, getEnabledMethods: async () => [{ method: 'crypto_bep20' }], getTelegramConfig: async () => ({ membershipRequired: false, ownerChatId: '' }) };
  const service = new TelegramService(...[settings, {}, {}, orders, payments, users, balance, prisma, {}] as unknown as ConstructorParameters<typeof TelegramService>) as unknown as Internals;
  service.activeToken = TOKEN;
  const callback = (parsed: BotCallback): TgCallbackQuery => ({ id: 'fixture', from: { id: 100001, language_code: 'vi' }, message: { message_id: 1, chat: { id: 100001, type: 'private' } }, data: encodeCallback(parsed) });
  return { service, callback, sent, events, lines, mutations: () => mutations, orderNotified: () => orderNotified, depositNotified: () => depositNotified };
}
afterEach(() => vi.unstubAllGlobals());

describe('locked customer callbacks', () => {
  const actions: BotCallback[] = [
    { kind: 'qty', variantId: 'v1', qty: 1 },
    { kind: 'method', orderCode: 'DH-FIXTURE', method: 'crypto_bep20' },
    { kind: 'check', orderCode: 'DH-FIXTURE' },
    { kind: 'mockConfirm', orderCode: 'DH-FIXTURE' },
    { kind: 'cancelOrder', orderCode: 'DH-FIXTURE' },
    { kind: 'payBalance', orderCode: 'DH-FIXTURE' },
    { kind: 'depositAmount', vnd: 100_000 },
    { kind: 'depositMethod', vnd: 100_000, method: 'crypto_bep20' },
    { kind: 'depositCancel', code: 'NAP-FIXTURE' },
  ];
  it.each(actions)('blocks $kind before a business mutation', async action => {
    const f = fixture({ locked: true });
    await f.service.handleCallback(TOKEN, f.callback(action), STOP);
    expect(f.mutations()).toBe(0);
    const answered = f.sent.find(s => s.method === 'answerCallbackQuery')?.body as Record<string, unknown>;
    expect(answered.text).toBe(translate(K.accountLocked, 'vi'));
    expect(answered.show_alert).toBe(true);
  });
});

describe('delivered keys and notification acknowledgement', () => {
  it('reopening an initializing payment allows choosing the enabled method again', async () => {
    const f = fixture({ initializing: true });
    await f.service.handleCallback(TOKEN, f.callback({ kind: 'order', orderCode: 'DH-FIXTURE' }), STOP);
    const view = f.sent.find(s => s.method === 'editMessageText')?.body as Record<string, any>;
    const callbacks = view.reply_markup.inline_keyboard.flat().map((button: { callback_data?: string }) => button.callback_data);
    expect(callbacks).toContain('m:DH-FIXTURE:cb');
    expect(callbacks).not.toContain('z:DH-FIXTURE');
    expect(f.orderNotified()).toBe(false);
  });
  it('manual order view does not mark notified before successful edit/fallback', async () => {
    const f = fixture({ failure: 429 });
    await f.service.handleCallback(TOKEN, f.callback({ kind: 'order', orderCode: 'DH-FIXTURE' }), STOP);
    expect(f.orderNotified()).toBe(false);
  });

  it.each([429, 500, 503, 403])('failed key send %s remains pending, never acknowledged as delivery', async failure => {
    const f = fixture({ failure });
    await f.service.notifySweep();
    expect(f.orderNotified()).toBe(false);
  });

  it.each([429, 500, 503, 403])('failed wallet notification %s remains pending', async failure => {
    const f = fixture({ failure, deposit: true });
    await f.service.notifySweep();
    expect(f.depositNotified()).toBe(false);
  });

  it.each(['sweep', 'manual'] as const)('%s sends oversized keys as complete UTF-8 document before marking', async route => {
    const f = fixture({ long: true });
    if (route === 'sweep') await f.service.notifySweep();
    else await f.service.handleCallback(TOKEN, f.callback({ kind: 'order', orderCode: 'DH-FIXTURE' }), STOP);
    const document = f.sent.find(s => s.method === 'sendDocument');
    expect(document).toBeDefined();
    const file = (document!.body as FormData).get('document') as Blob;
    const text = await file.text();
    for (const line of f.lines) expect(text).toContain(line);
    expect(text).toContain('TEST-PRODUCT');
    expect(text).toContain('DH-FIXTURE');
    for (const message of f.sent.filter(s => ['sendMessage', 'editMessageText'].includes(s.method))) {
      expect(String((message.body as Record<string, unknown>).text).length).toBeLessThanOrEqual(4096);
    }
    expect(f.orderNotified()).toBe(true);
    expect(f.events.indexOf('sendDocument')).toBeLessThan(f.events.indexOf('order-mark'));
  });

  it('document upload failure leaves long order pending after summary succeeds', async () => {
    const f = fixture({ long: true, documentFailure: 503 });
    await f.service.notifySweep();
    expect(f.orderNotified()).toBe(false);
  });

  it('short manual view marks only after successful edit', async () => {
    const f = fixture();
    await f.service.handleCallback(TOKEN, f.callback({ kind: 'order', orderCode: 'DH-FIXTURE' }), STOP);
    expect(f.orderNotified()).toBe(true);
    expect(f.events.indexOf('editMessageText')).toBeLessThan(f.events.indexOf('order-mark'));
  });
});
