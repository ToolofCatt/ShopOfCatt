import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import type {
  TelegramAdminPermission,
  TelegramAdminTextKey,
} from '@webcatt/shared';
import { CreateProductDto } from '../admin/dto/create-product.dto';
import { UpdateProductDto } from '../admin/dto/update-product.dto';
import { CreateVariantDto } from '../admin/dto/create-variant.dto';
import { UpdateVariantDto } from '../admin/dto/update-variant.dto';
import {
  CreateCouponDto,
  UpdateCouponDto,
} from '../coupons/dto/coupon-admin.dto';
import { UpdateAnnouncementDto } from '../announcement/dto/update-announcement.dto';
import { UpdateLegalPageDto } from '../legal/dto/update-legal-page.dto';
import {
  PatchPaymentSettingsDto,
  PatchRateSettingsDto,
  PatchSupportSettingsDto,
  PatchAiSettingsDto,
} from '../settings/dto/update-settings-sections.dto';
import { UpdateTelegramSettingsDto } from '../settings/dto/update-telegram-settings.dto';
import { K } from '../i18n/messages';
import {
  WithdrawStockDto,
  WITHDRAW_MAX,
} from '../admin/dto/withdraw-stock.dto';

export interface AdminField {
  key: string;
  label: TelegramAdminTextKey | string;
  type: 'text' | 'number' | 'boolean' | 'choice' | 'stock' | 'json';
  choices?: string[];
  optional?: boolean;
  secret?: boolean;
  max?: number;
}
export interface AdminCommand {
  title: TelegramAdminTextKey;
  permission: TelegramAdminPermission;
  sensitive?: boolean;
  fields: AdminField[];
  dto?: new () => object;
}
const text = (
  key: string,
  label: string = key,
  optional = false,
): AdminField => ({ key, label, type: 'text', optional });
const number = (
  key: string,
  label: string = key,
  optional = false,
): AdminField => ({ key, label, type: 'number', optional });
const bool = (key = 'active', label = 'active'): AdminField => ({
  key,
  label,
  type: 'boolean',
  choices: ['true', 'false'],
});
const priceFields: AdminField[] = [
  number('price'),
  {
    key: 'priceCurrency',
    label: 'priceCurrency',
    type: 'choice',
    choices: ['VND', 'USDT', 'USD', 'CNY'],
  },
];
const productFields: AdminField[] = [
  text('name'),
  text('slug', 'slug', true),
  text('category', 'category', true),
  text('shortDescription', 'shortDescription', true),
  text('description', 'description', true),
  number('sortOrder', 'sortOrder', true),
  {
    key: 'stockDrawMode',
    label: 'mode',
    type: 'choice',
    choices: ['SEQUENTIAL', 'RANDOM'],
    optional: true,
  },
  bool(),
];
const couponFields: AdminField[] = [
  { key: 'type', label: 'type', type: 'choice', choices: ['PERCENT', 'FIXED'] },
  number('value'),
  number('minAmount', 'minAmount', true),
  number('maxUses', 'maxUses', true),
  number('perUserLimit', 'perUserLimit', true),
  text('startsAt', 'startsAt', true),
  text('expiresAt', 'expiresAt', true),
  text('note', 'note', true),
  bool(),
];
const secret = (key: string): AdminField => ({
  ...text(key, key, true),
  secret: true,
});

export const ADMIN_COMMANDS = {
  'product.create': {
    title: 'add',
    permission: 'OPERATOR',
    fields: [text('name'), ...priceFields, text('category', 'category', true)],
    dto: CreateProductDto,
  },
  'product.edit': {
    title: 'edit',
    permission: 'OPERATOR',
    fields: productFields,
    dto: UpdateProductDto,
  },
  'product.delete': {
    title: 'remove',
    permission: 'FULL',
    sensitive: true,
    fields: [],
  },
  'product.translate': {
    title: 'translate',
    permission: 'OPERATOR',
    fields: [],
  },
  'variant.create': {
    title: 'add',
    permission: 'OPERATOR',
    fields: [text('name'), ...priceFields],
    dto: CreateVariantDto,
  },
  'variant.edit': {
    title: 'edit',
    permission: 'OPERATOR',
    fields: [
      text('name'),
      ...priceFields,
      number('sortOrder', 'sortOrder', true),
      bool(),
    ],
    dto: UpdateVariantDto,
  },
  'variant.delete': {
    title: 'remove',
    permission: 'FULL',
    sensitive: true,
    fields: [],
  },
  'stock.import': {
    title: 'import',
    permission: 'OPERATOR',
    fields: [{ key: 'content', label: 'importHint', type: 'stock' }],
  },
  'stock.withdraw': {
    title: 'withdraw',
    permission: 'FULL',
    sensitive: true,
    fields: [
      number('quantity'),
      {
        key: 'mode',
        label: 'mode',
        type: 'choice',
        choices: ['SEQUENTIAL', 'RANDOM'],
      },
    ],
    dto: WithdrawStockDto,
  },
  'stock.restore': { title: 'restore', permission: 'OPERATOR', fields: [] },
  'stock.delete': {
    title: 'remove',
    permission: 'FULL',
    sensitive: true,
    fields: [],
  },
  'order.cancel': { title: 'cancel', permission: 'OPERATOR', fields: [] },
  'order.redeliver': { title: 'redeliver', permission: 'OPERATOR', fields: [] },
  'order.markPaid': {
    title: 'markPaid',
    permission: 'FULL',
    sensitive: true,
    fields: [text('note')],
  },
  'customer.lock': { title: 'lock', permission: 'OPERATOR', fields: [] },
  'customer.unlock': { title: 'unlock', permission: 'OPERATOR', fields: [] },
  'customer.reset': {
    title: 'resetPassword',
    permission: 'FULL',
    sensitive: true,
    fields: [],
  },
  'coupon.create': {
    title: 'add',
    permission: 'OPERATOR',
    fields: [text('code'), ...couponFields],
    dto: CreateCouponDto,
  },
  'coupon.edit': {
    title: 'edit',
    permission: 'OPERATOR',
    fields: couponFields,
    dto: UpdateCouponDto,
  },
  'coupon.delete': { title: 'remove', permission: 'OPERATOR', fields: [] },
  'announcement.edit': {
    title: 'edit',
    permission: 'OPERATOR',
    fields: [text('title', 'titleField'), text('body'), bool()],
    dto: UpdateAnnouncementDto,
  },
  'announcement.translate': {
    title: 'translate',
    permission: 'OPERATOR',
    fields: [],
  },
  'legal.edit': {
    title: 'edit',
    permission: 'OPERATOR',
    fields: [text('title', 'titleField'), text('body')],
    dto: UpdateLegalPageDto,
  },
  'settings.payments': {
    title: 'payments',
    permission: 'FULL',
    sensitive: true,
    fields: [
      bool('binancePayEnabled'),
      bool('binanceIdEnabled'),
      text('binanceId', 'Binance ID', true),
      bool('cryptoEnabled'),
      text('bep20Address', 'BEP20', true),
      text('trc20Address', 'TRC20', true),
      bool('sepayEnabled'),
      text('sepayAccountNumber', 'Bank account', true),
      text('sepayBank', 'Bank', true),
      text('sepayAccountHolder', 'Account holder', true),
      secret('sepayApiKey'),
      secret('sepayWebhookSecret'),
    ],
    dto: PatchPaymentSettingsDto,
  },
  'settings.rates': {
    title: 'rates',
    permission: 'FULL',
    sensitive: true,
    fields: [
      number('vndPerUsdt', 'VND/USDT'),
      number('cnyPerUsdt', 'CNY/USDT'),
      bool('rateAuto'),
      number('rateMarkupPercent', 'Markup %'),
      number('rateHour', 'Hour (0-23)'),
    ],
    dto: PatchRateSettingsDto,
  },
  'settings.support': {
    title: 'support',
    permission: 'OPERATOR',
    fields: [
      { key: 'supportChannels', label: 'support', type: 'json' },
      text('supportNote', 'note', true),
    ],
    dto: PatchSupportSettingsDto,
  },
  'settings.ai': {
    title: 'ai',
    permission: 'FULL',
    sensitive: true,
    fields: [
      {
        key: 'aiProvider',
        label: 'Provider',
        type: 'choice',
        choices: ['openai', 'anthropic'],
      },
      text('aiBaseUrl', 'Base URL', true),
      text('aiModel', 'Model', true),
      secret('aiApiKey'),
    ],
    dto: PatchAiSettingsDto,
  },
  'settings.alerts': {
    title: 'alerts',
    permission: 'FULL',
    fields: [
      bool('telegramSendAnnouncement'),
      bool('telegramStockAlertsEnabled'),
      text('telegramGreeting', 'Greeting', true),
      text('telegramOwnerChatId', 'Notification Chat ID', true),
      bool('telegramOwnerOrderAlertsEnabled'),
      bool('telegramOwnerStuckAlertsEnabled'),
      number('telegramOwnerStuckMinutes', 'Minutes'),
      bool('telegramOwnerLowStockAlertsEnabled'),
      number('telegramOwnerLowStockThreshold', 'Threshold'),
    ],
    dto: UpdateTelegramSettingsDto,
  },
} satisfies Record<string, AdminCommand>;
export type AdminCommandKind = keyof typeof ADMIN_COMMANDS;
export function command(kind: string): AdminCommand | undefined {
  return (ADMIN_COMMANDS as Record<string, AdminCommand>)[kind];
}

export function validateCommand(
  kind: string,
  payload: Record<string, unknown>,
): void {
  const spec = command(kind);
  if (!spec) throw new BadRequestException(K.forbidden);
  if (
    Object.keys(payload).some(
      (key) => !spec.fields.some((field) => field.key === key),
    )
  )
    throw new BadRequestException(K.adminStockContentInvalid);
  if (spec.dto) {
    const errors = validateSync(plainToInstance(spec.dto, payload), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length)
      throw new BadRequestException(
        Object.values(errors[0].constraints ?? {})[0] ??
          K.adminStockContentInvalid,
      );
  }
  if (
    kind === 'stock.withdraw' &&
    (!Number.isInteger(payload.quantity) ||
      Number(payload.quantity) < 1 ||
      Number(payload.quantity) > WITHDRAW_MAX)
  )
    throw new BadRequestException(K.adminStockContentInvalid);
  if (
    kind === 'order.markPaid' &&
    (typeof payload.note !== 'string' || !payload.note.trim())
  )
    throw new BadRequestException(K.adminStockContentInvalid);
}
