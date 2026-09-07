import {
  telegramAdminAllows,
  telegramAdminText,
  TELEGRAM_ADMIN_COPY,
  type TelegramAdminPermission,
  type TelegramAdminTextKey,
} from '@webcatt/shared';
import { escapeHtml } from '../telegram/catalog-view';
import type { BotLang } from '../telegram/messages';
import type { TgInlineKeyboard } from '../telegram/telegram-api';
import { command, type AdminField } from './commands';

export interface AdminView {
  text: string;
  keyboard: TgInlineKeyboard;
}
export interface AdminLink {
  label: string;
  route?: string;
  command?: string;
  target?: string;
  min?: TelegramAdminPermission;
}
export const ADMIN_ROUTES = [
  'home',
  'overview',
  'orders',
  'products',
  'customers',
  'coupons',
  'content',
  'settings',
  'audit',
] as const;
export const adminText = (lang: BotLang, key: string) => {
  try {
    return telegramAdminText(lang, key as TelegramAdminTextKey);
  } catch {
    return key;
  }
};

function fieldLabel(field: AdminField, lang: BotLang) {
  return adminText(
    lang,
    field.key in TELEGRAM_ADMIN_COPY ? field.key : field.label,
  );
}

export function renderAdminScreen(
  title: string,
  lines: string[],
  links: AdminLink[],
  permission: TelegramAdminPermission,
  encode: (link: AdminLink) => string,
): AdminView {
  const keyboard = links
    .filter((link) =>
      telegramAdminAllows(
        permission,
        link.command
          ? (command(link.command)?.permission ?? 'FULL')
          : (link.min ?? 'VIEWER'),
      ),
    )
    .map((link) => [
      {
        text: Array.from(link.label).slice(0, 60).join(''),
        callback_data: encode(link),
      },
    ]);
  return {
    text: `<b>${safeText(title, 500)}</b>\n\n${safeText(lines.join('\n'), 3000)}`,
    keyboard,
  };
}

export function homeLinks(lang: BotLang): AdminLink[] {
  return ADMIN_ROUTES.filter((route) => route !== 'home').map((route) => ({
    label: adminText(lang, route),
    route,
  }));
}

export function fieldPrompt(
  field: AdminField,
  value: unknown,
  index: number,
  count: number,
  lang: BotLang,
): string {
  const current =
    value === undefined || value === null
      ? '-'
      : field.secret
        ? adminText(lang, 'masked')
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  return `<b>${index + 1}/${count} · ${escapeHtml(fieldLabel(field, lang))}</b>\n${safeText(current, 2000)}\n\n${escapeHtml(adminText(lang, field.type === 'stock' ? 'importHint' : 'input'))}`;
}

export function confirmText(
  title: string,
  target: string,
  before: Record<string, unknown>,
  payload: Record<string, unknown>,
  fields: AdminField[],
  lang: BotLang,
): string {
  const lines = fields
    .filter((f) => f.key in payload)
    .map((field) => {
      const next = payload[field.key];
      const display = field.secret
        ? `[${adminText(lang, 'masked')}]`
        : field.type === 'stock'
          ? `${String(next).split('\n').length} ${adminText(lang, 'count')}`
          : (typeof next === 'object'
              ? JSON.stringify(next)
              : String(next)
            ).slice(0, 180);
      const old = field.secret
        ? '***'
        : before[field.key] === undefined
          ? '-'
          : String(before[field.key]).slice(0, 100);
      return `${fieldLabel(field, lang)}: ${old} → ${display}`;
    });
  const context = ['status', 'totalAmount', 'availableStock']
    .filter((key) => before[key] !== undefined)
    .map((key) => `${key}: ${String(before[key])}`);
  return `<b>${safeText(title, 300)}</b>\n<code>${safeText(target, 300)}</code>\n\n${safeText([...context, ...lines].join('\n'), 2800)}`;
}

function safeText(value: string, budget: number): string {
  let result = '';
  for (const point of value) {
    const escaped = escapeHtml(point);
    if (result.length + escaped.length > budget - 3) return result + '...';
    result += escaped;
  }
  return result;
}

export function renderAdminPreview(
  lang: BotLang,
  permission: TelegramAdminPermission,
  screen: string,
): AdminView {
  const text = (key: string) => adminText(lang, key);
  const encode = (link: AdminLink) =>
    `demo:${link.command ? `form|${link.command}|0` : (link.route ?? 'home')}`;
  const back: AdminLink = { label: text('back'), route: 'home' };
  const parts = screen.split('|'),
    kind = parts[0] ?? 'home';
  if (kind === 'form' || kind === 'confirm') {
    const spec = command(parts[1] ?? '');
    if (!spec || !telegramAdminAllows(permission, spec.permission))
      return { text: text('forbidden'), keyboard: [] };
    const index = Math.max(0, Math.min(50, Number(parts[2]) || 0));
    const field = spec.fields[index];
    if (kind === 'form' && field) {
      const links: AdminLink[] = [
        ...(field.choices ?? [text('save')]).map((value) => ({
          label: value,
          route: `form|${parts[1]}|${index + 1}`,
        })),
        back,
      ];
      return {
        text: fieldPrompt(
          field,
          field.secret ? '***' : undefined,
          index,
          spec.fields.length,
          lang,
        ),
        keyboard: links.map((l) => [
          { text: l.label, callback_data: encode(l) },
        ]),
      };
    }
    return {
      text: confirmText(text(spec.title), 'DEMO', {}, {}, spec.fields, lang),
      keyboard: [
        [{ text: text('confirm'), callback_data: 'demo:done' }],
        [{ text: text('cancel'), callback_data: 'demo:home' }],
      ],
    };
  }
  if (kind === 'done')
    return {
      text: escapeHtml(text('testOnly')),
      keyboard: [[{ text: text('back'), callback_data: 'demo:home' }]],
    };
  const action = (label: string, command: string): AdminLink => ({
    label: text(label),
    command,
  });
  const map: Record<string, { lines: string[]; links: AdminLink[] }> = {
    home: { lines: [text(permission)], links: homeLinks(lang) },
    overview: {
      lines: [
        `${text('revenue')}: 120 USDT`,
        `${text('pending')}: 2`,
        `${text('stock')}: 5`,
      ],
      links: [
        { label: text('orders'), route: 'orders' },
        { label: text('lowStock'), route: 'variant' },
      ],
    },
    products: {
      lines: ['DEMO'],
      links: [
        { label: 'Digital product · 5', route: 'product' },
        action('add', 'product.create'),
      ],
    },
    product: {
      lines: ['Digital product', '5 AVAILABLE'],
      links: [
        { label: '30 days · 10 USDT · 5', route: 'variant' },
        action('edit', 'product.edit'),
        action('add', 'variant.create'),
      ],
    },
    variant: {
      lines: ['30 days · 10 USDT', '5 AVAILABLE'],
      links: [
        action('edit', 'variant.edit'),
        action('import', 'stock.import'),
        action('withdraw', 'stock.withdraw'),
      ],
    },
    orders: {
      lines: ['DEMO'],
      links: [{ label: 'DH-DEMO · PENDING · 10 USDT', route: 'order' }],
    },
    order: {
      lines: ['DH-DEMO', 'PENDING · 10 USDT'],
      links: [
        action('markPaid', 'order.markPaid'),
        action('cancel', 'order.cancel'),
      ],
    },
    customers: {
      lines: ['DEMO'],
      links: [{ label: '#12345678', route: 'customer' }],
    },
    customer: {
      lines: ['#12345678', 'USER'],
      links: [
        action('lock', 'customer.lock'),
        action('resetPassword', 'customer.reset'),
      ],
    },
    coupons: {
      lines: ['DEMO'],
      links: [action('add', 'coupon.create'), action('edit', 'coupon.edit')],
    },
    content: {
      lines: ['DEMO'],
      links: [
        action('announcement', 'announcement.edit'),
        action('legal', 'legal.edit'),
      ],
    },
    settings: {
      lines: ['DEMO'],
      links: ['payments', 'rates', 'support', 'ai', 'alerts'].map((k) =>
        action(k, `settings.${k}`),
      ),
    },
    audit: { lines: ['DEMO · stock.add · Telegram'], links: [] },
  };
  const data = map[kind] ?? map.home!;
  return renderAdminScreen(
    text(kind === 'home' ? 'title' : kind),
    data.lines,
    [...data.links, ...(kind === 'home' ? [] : [back])],
    permission,
    encode,
  );
}
