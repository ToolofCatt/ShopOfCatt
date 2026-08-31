import {
  displayPriceAmount,
  formatMoney,
  type AnchoredPrice,
  type StoreRatesDto,
} from '@webcatt/shared';
import { CURRENCY_BY_LANG, encodeCallback, escapeHtml } from './catalog-view';
import { brandEmojiHtml } from './animated-emoji';
import { botDict, type BotLang } from './messages';
import type { TgInlineKeyboard } from './telegram-api';

export interface StockAlertInput extends AnchoredPrice {
  productId: string;
  productName: string;
  variantName: string;
  added: number;
  total: number;
  createdAt: Date;
}

export interface StockAlertView {
  text: string;
  keyboard: TgInlineKeyboard;
}

const DATE_LOCALE: Record<BotLang, string> = {
  vi: 'vi-VN',
  en: 'en-GB',
  zh: 'zh-CN',
};

/**
 * Tin marketing được dựng thuần từ ảnh chụp lúc nhập kho. Không đọc lại tên
 * hay giá hiện tại: admin sửa sản phẩm trong lúc outbox đang gửi cũng không làm
 * mỗi khách nhận một nội dung khác nhau.
 */
export function renderStockAlert(
  alert: StockAlertInput,
  lang: BotLang,
  rates: StoreRatesDto | null,
  botUsername: string | null,
): StockAlertView {
  const dict = botDict(lang);
  const shown = displayPriceAmount(alert, CURRENCY_BY_LANG[lang], rates);
  const time = new Intl.DateTimeFormat(DATE_LOCALE[lang], {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour12: false,
  }).format(alert.createdAt);
  const username = botUsername?.startsWith('@') ? botUsername : null;

  const lines = [
    `<b>${escapeHtml(dict.stockAlertTitle)}</b>`,
    '',
    `🏷️ ${escapeHtml(dict.stockAlertProductLabel)}: ${brandEmojiHtml(alert.productName)}${escapeHtml(alert.productName)} · ${escapeHtml(alert.variantName)}`,
    escapeHtml(dict.stockAlertAdded(alert.added)),
    escapeHtml(dict.stockAlertPrice(formatMoney(shown.amount, shown.currency))),
    escapeHtml(dict.stockAlertInventory(alert.total)),
    escapeHtml(dict.stockAlertTime(time)),
    ...(username ? ['', `<i>${escapeHtml(dict.stockAlertOrderAt(username))}</i>`] : []),
  ];

  return {
    text: lines.join('\n'),
    keyboard: [
      [
        {
          text: dict.stockAlertBuyButton,
          callback_data: encodeCallback({
            kind: 'product',
            productId: alert.productId,
            backPage: 1,
          }),
        },
      ],
    ],
  };
}
