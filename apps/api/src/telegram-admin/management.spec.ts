import { describe, expect, it, vi } from 'vitest';
import {
  TELEGRAM_ADMIN_COPY,
  validTelegramAdminId,
  telegramAdminAllows,
} from '@webcatt/shared';
import { TelegramAdminBotService } from './bot.service';
import { ADMIN_COMMANDS, validateCommand } from './commands';
import { renderAdminScreen, confirmText, renderAdminPreview } from './views';
import { TelegramAdminAccessController } from './access.controller';
import { SuperAdminGuard } from '../auth/superadmin.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';

describe('Telegram management boundaries', () => {
  it('accepts only canonical numeric personal IDs', () => {
    for (const value of [
      '-100123',
      '0',
      '01',
      '1.2',
      '@owner',
      '9007199254740992',
      '1e5',
      ' 123',
    ])
      expect(validTelegramAdminId(value)).toBe(false);
    expect(validTelegramAdminId('1234567890')).toBe(true);
    expect(telegramAdminAllows('VIEWER', 'FULL')).toBe(false);
    expect(telegramAdminAllows('OPERATOR', 'FULL')).toBe(false);
    expect(telegramAdminAllows('FULL', 'OPERATOR')).toBe(true);
  });
  it('requires SUPERADMIN for every access controller route', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, TelegramAdminAccessController),
    ).toContain(SuperAdminGuard);
  });
  it('does not include admin grant, token or mock mutations in bot command registry', () => {
    for (const spec of Object.values(ADMIN_COMMANDS))
      expect(
        spec.fields.some((f) =>
          [
            'telegramBotToken',
            'telegramAdminEnabled',
            'role',
            'mockEnabled',
          ].includes(f.key),
        ),
      ).toBe(false);
    expect(ADMIN_COMMANDS['stock.withdraw'].permission).toBe('FULL');
    expect(ADMIN_COMMANDS['order.markPaid'].sensitive).toBe(true);
  });
  it('validates actual DTOs before executing bot inputs', () => {
    expect(() => validateCommand('variant.edit', { price: -1 })).toThrow();
    expect(() =>
      validateCommand('stock.withdraw', { quantity: 501, mode: 'SEQUENTIAL' }),
    ).toThrow();
    expect(() => validateCommand('order.markPaid', { note: '' })).toThrow();
    expect(() =>
      validateCommand('settings.alerts', { telegramBotToken: 'secret' }),
    ).toThrow();
    expect(() =>
      validateCommand('variant.edit', { price: 100000, priceCurrency: 'VND' }),
    ).not.toThrow();
  });
  it('renders all languages with escaped bounded HTML and permission-filtered actions', () => {
    for (const copy of Object.values(TELEGRAM_ADMIN_COPY))
      expect(copy.every((value) => value.trim().length > 0)).toBe(true);
    for (const lang of ['vi', 'en', 'zh'] as const) {
      expect(
        renderAdminPreview(lang, 'VIEWER', 'home').keyboard.length,
      ).toBeGreaterThan(0);
      const view = renderAdminScreen(
        'X',
        ['&'.repeat(5000)],
        [{ label: 'Mark paid', command: 'order.markPaid' }],
        'VIEWER',
        () => 'adm:test',
      );
      expect(view.keyboard).toHaveLength(0);
      expect(view.text.length).toBeLessThan(4096);
      const text = confirmText(
        'Test',
        'ID',
        {},
        { password: 'secret' },
        [{ key: 'password', label: 'password', type: 'text', secret: true }],
        lang,
      );
      expect(text).not.toContain('secret');
    }
  });
  it('rejects group commands and forwarded callbacks without any business calls', async () => {
    const resolve = vi.fn();
    const bot = new TelegramAdminBotService(
      { resolve } as never,
      {} as never,
      {} as never,
      { telegramAdmin: { findUnique: vi.fn().mockResolvedValue(null) } } as never,
      {} as never,
      {} as never,
    );
    try {
      expect(
        await bot.message(
          'unused',
          {
            message_id: 1,
            text: '/admin',
            from: { id: 123 },
            chat: { id: -123, type: 'group' },
          },
          new AbortController().signal,
        ),
      ).toBe(true);
      expect(resolve).not.toHaveBeenCalled();
      expect(
        await bot.message(
          'unused',
          {
            message_id: 1,
            text: '100000',
            from: { id: 123 },
            chat: { id: 123, type: 'private' },
          },
          new AbortController().signal,
        ),
      ).toBe(false);
    } finally {
      bot.onModuleDestroy();
    }
  });
});
