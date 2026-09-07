import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramAdminBotService } from './bot.service';
import type { TelegramAdmin } from '@prisma/client';
import type { TgMessage } from '../telegram/telegram-api';

const actor = {
  id: 'admin-one',
  telegramUserId: '1234567',
  name: 'Operator',
  permission: 'OPERATOR',
  enabled: true,
  version: 1,
} as TelegramAdmin;
const message = (text: string): TgMessage => ({
  message_id: 5,
  chat: { id: 1234567, type: 'private' },
  from: { id: 1234567, language_code: 'en' },
  text,
});
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const payloads: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      payloads.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 10 } }),
        { status: 200 },
      );
    }),
  );
  const access = { resolve: vi.fn(async () => actor) };
  const actions = {
    snapshot: vi.fn(async () => ({ label: 'Test', hash: 'hash', current: {} })),
    prepare: vi.fn(async (_a, kind, target, payload) => ({
      id: 'action',
      kind,
      targetId: target,
      payload,
      expected: 'hash',
    })),
    execute: vi.fn(async () => ({ state: 'done', summary: '1' })),
  };
  const screens = {
    load: vi.fn(async () => ({
      title: 'Admin',
      lines: ['Test'],
      links: [{ label: 'Import', command: 'stock.import', target: 'variant' }],
    })),
  };
  const bot = new TelegramAdminBotService(
    access as never,
    actions as never,
    screens as never,
    { telegramAdmin: { updateMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({inAdminMode:true}) } } as never,
    {} as never,
    {} as never,
  );
  const signal = new AbortController().signal;
  const click = async (data: string, id = 1234567, msgId = 10) =>
    bot.callback(
      'test',
      {
        id: 'cb',
        from: { id },
        message: { message_id: msgId, chat: { id, type: 'private' } },
        data,
      },
      signal,
    );
  const button = (label: string) => {
    const keyboard = [...payloads].reverse().find((p) => p.reply_markup)
      ?.reply_markup as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    return keyboard.inline_keyboard.flat().find((b) => b.text === label)!
      .callback_data;
  };
  return { bot, access, actions, screens, payloads, signal, click, button };
}

describe('Telegram admin conversation', () => {
  it('does not interpret post-restart admin input as a customer deposit', async () => {
    const f=fixture();try{
      expect(await f.bot.message('test',message('100000'),f.signal)).toBe(true);
      expect(f.actions.prepare).not.toHaveBeenCalled();
      expect(await f.bot.message('test',message('/start'),f.signal)).toBe(false);
    }finally{f.bot.onModuleDestroy();}
  });
  it('routes numeric stock input before customer deposits and does not repeat confirmation', async () => {
    const f = fixture();
    try {
      await f.bot.message('test', message('/admin'), f.signal);
      await f.click(f.button('Import'));
      expect(await f.bot.message('test', message('100000'), f.signal)).toBe(
        true,
      );
      expect(f.actions.prepare).toHaveBeenCalledWith(
        actor,
        'stock.import',
        'variant',
        { content: '100000' },
        'hash',
        'Test',
      );
      const confirm = f.button('Confirm');
      await f.click(confirm);
      await f.click(confirm);
      expect(f.actions.execute).toHaveBeenCalledTimes(1);
    } finally {
      f.bot.onModuleDestroy();
    }
  });
  it('rejects copied buttons and revoked permission with an old confirmation', async () => {
    const f = fixture();
    try {
      await f.bot.message('test', message('/admin'), f.signal);
      const button = f.button('Import');
      await f.click(button, 7654321);
      expect(f.actions.snapshot).not.toHaveBeenCalled();
      await f.click(button);
      await f.bot.message('test', message('KEY'), f.signal);
      const confirm = f.button('Confirm');
      f.access.resolve.mockResolvedValue({ ...actor, version: 2 });
      await f.click(confirm);
      expect(f.actions.execute).not.toHaveBeenCalled();
    } finally {
      f.bot.onModuleDestroy();
    }
  });
  it('requires retyping target for sensitive action before preparing a confirmation', async () => {
    const f = fixture();
    try {
      f.access.resolve.mockResolvedValue({ ...actor, permission: 'FULL' });
      f.screens.load.mockResolvedValue({
        title: 'Order',
        lines: ['Test'],
        links: [
          { label: 'Paid', command: 'order.markPaid', target: 'DH-TEST' },
        ],
      });
      await f.bot.message('test', message('/admin'), f.signal);
      await f.click(f.button('Paid'));
      await f.bot.message('test', message('Bank verified'), f.signal);
      expect(f.actions.prepare).not.toHaveBeenCalled();
      await f.bot.message('test', message('WRONG'), f.signal);
      expect(f.actions.prepare).not.toHaveBeenCalled();
      await f.bot.message('test', message('Test'), f.signal);
      expect(f.actions.prepare).toHaveBeenCalledOnce();
    } finally {
      f.bot.onModuleDestroy();
    }
  });
  it('clears draft on /cancel and returns /start to the customer handler', async () => {
    const f = fixture();
    try {
      await f.bot.message('test', message('/admin'), f.signal);
      await f.click(f.button('Import'));
      await f.bot.message('test', message('/cancel'), f.signal);
      expect(f.actions.prepare).not.toHaveBeenCalled();
      expect(await f.bot.message('test', message('/start'), f.signal)).toBe(
        false,
      );
    } finally {
      f.bot.onModuleDestroy();
    }
  });
});
