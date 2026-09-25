import type { AdminMailOfferDto, MailPriceCurrency } from '@webcatt/shared';

/** 3k/3.000/3,000 chỉ là cú pháp nhập VND; API luôn nhận chuỗi số chuẩn. */
export function parseMailPriceInput(value: string, currency: MailPriceCurrency): string | null {
  let raw = value.trim().toLowerCase().replace(/\s/g, '');
  if (!raw) return null;
  if (currency === 'VND') {
    if (/^\d+(?:[.,]\d{1,3})?k$/.test(raw)) {
      const [whole, part = ''] = raw.slice(0, -1).replace(',', '.').split('.');
      raw = (BigInt(whole) * 1000n + BigInt(part.padEnd(3, '0'))).toString();
    } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, '');
    if (!/^\d{1,9}$/.test(raw) || BigInt(raw) < 1n) return null;
    return BigInt(raw).toString();
  }
  if (/^\d+,\d{1,6}$/.test(raw)) raw = raw.replace(',', '.');
  if (!/^\d{1,9}(?:\.\d{1,6})?$/.test(raw) || Number(raw) <= 0) return null;
  const [whole, fraction = ''] = raw.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return BigInt(whole).toString() + (trimmed ? '.' + trimmed : '');
}
export type MailPricingMode = 'AUTO' | MailPriceCurrency;
export interface MailOfferDraft { mode: MailPricingMode; amount: string; active: boolean }
export function offerDraft(offer: AdminMailOfferDto): MailOfferDraft {
  return { mode: offer.saleAmount === null && offer.salePrice === null ? 'AUTO' : offer.saleCurrency, amount: offer.saleAmount ?? offer.salePrice ?? offer.priceAmount, active: offer.active };
}
export function priceBucket(offer: AdminMailOfferDto, field: 'cost' | 'sale'): string {
  return field === 'cost' ? 'USDT:'+offer.cost : offer.priceCurrency+':'+offer.priceAmount;
}
export interface MailOfferFilters { query: string; category: string; active: string; stock: string; mode: string; price: string; priceField: 'cost' | 'sale' }
export function filterMailOffers(offers: AdminMailOfferDto[], filters: MailOfferFilters, withoutPrice = false) {
  const query = filters.query.trim().toLowerCase();
  return offers.filter(offer => (!query || (offer.name+' '+offer.code).toLowerCase().includes(query))
    && (!filters.category || offer.category === filters.category)
    && (!filters.active || offer.active === (filters.active === 'on'))
    && (!filters.stock || (offer.stock > 0) === (filters.stock === 'in'))
    && (!filters.mode || offerDraft(offer).mode === filters.mode)
    && (withoutPrice || !filters.price || priceBucket(offer, filters.priceField) === filters.price));
}
