import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MailOffer, MailProviderSetting } from '@prisma/client';
import { K } from '../i18n/messages';

type PriceOffer = Pick<MailOffer, 'cost' | 'salePrice'> & Partial<Pick<MailOffer, 'saleCurrency' | 'saleAmount'>>;
export function mailPriceQuote(offer: PriceOffer, setting: Pick<MailProviderSetting, 'multiplier'>, vndPerUsdt: Prisma.Decimal | number = 0) {
  const fixed = offer.saleAmount ?? offer.salePrice;
  const currency = fixed !== null && fixed !== undefined && offer.saleCurrency === 'VND' ? 'VND' : 'USDT';
  const amount = fixed ?? offer.cost.mul(setting.multiplier).toDecimalPlaces(6, Prisma.Decimal.ROUND_CEIL);
  const rate = new Prisma.Decimal(vndPerUsdt);
  if (currency === 'VND' && !rate.gt(0)) return { price: new Prisma.Decimal(0), currency, amount, ready: false } as const;
  // Giữ giá neo nguyên; USDT trừ ví làm tròn xuống6chữ số như cơ chế neo của shop.
  const price = currency === 'VND' ? amount.div(rate).toDecimalPlaces(6, Prisma.Decimal.ROUND_FLOOR) : amount;
  return { price, currency, amount, ready: price.gt(0) } as const;
}
export function mailSalePrice(offer: PriceOffer, setting: Pick<MailProviderSetting, 'multiplier'>, vndPerUsdt: Prisma.Decimal | number = 0) {
  const quote = mailPriceQuote(offer, setting, vndPerUsdt);
  if (!quote.ready) throw new BadRequestException(K.mailRateRequired);
  return quote.price;
}
