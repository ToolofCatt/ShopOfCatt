/**
 * Dựng nội dung tin nhắn + bàn phím cho bot — module THUẦN, cố ý không đụng
 * Nest/fetch/Date để unit-test trần được. Toàn bộ phần dễ sai nhất của bot
 * (escape, cắt chuỗi, callback format, phân trang) nằm ở đây; telegram.service
 * chỉ là lớp keo I/O.
 *
 * Bố cục theo mẫu chủ shop chốt (bot "Piggy AI Premium"): sản phẩm là NÚT BẤM
 * — nhãn `{tên} | {giá} | 📦 {tồn kho}` — chứ không phải bảng chữ.
 */

import {
  cheapestAnchored,
  convertFromUsdt,
  displayPriceAmount,
  formatMoney,
  formatUsdt,
  type AnnouncementDto,
  type DisplayCurrency,
  type ProductDto,
  type StoreRatesDto,
  type SupportChannelDto,
} from '@webcatt/shared';
import { botDict, type BotLang } from './messages';
import type { TgInlineKeyboard, TgInlineKeyboardButton } from './telegram-api';

/**
 * PHẢI khớp `CURRENCY_BY_LOCALE` ở apps/web/lib/i18n/config.ts — bot không
 * import được từ apps/web nên đành khai lại; lệch nhau là khách thấy một giá
 * trên bot và một giá khác trên web.
 */
export const CURRENCY_BY_LANG: Record<BotLang, DisplayCurrency> = {
  vi: 'VND',
  en: 'USD',
  zh: 'CNY',
};

/** Trần cứng của Bot API cho text một tin. */
const TG_TEXT_LIMIT = 4096;
/** Chừa lề cho phần Telegram tự thêm/đếm khác mình. */
const SAFETY_MARGIN = 96;

/** Trần nút Telegram là 100/bàn phím — 30 là đã phải cuộn dài, hơn nữa là vô dụng. */
export const PAGE_MAX_ITEMS = 30;

/** Nhãn nút dài hơn cỡ này là Telegram tự cắt "…" — tự cắt TÊN trước để phần
 *  giá và tồn kho (nửa sau nhãn) không bao giờ bị mất. */
const BUTTON_LABEL_MAX = 60;

// ---------------------------------------------------------------- chuỗi an toàn

/** Escape cho parse_mode HTML — tên sản phẩm/kênh liên hệ do admin gõ tự do. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HTML đã lọc của hộp thông báo → chữ trần cho Telegram.
 *
 * Telegram chỉ nhận đúng vài thẻ (b/i/u/s/a/code/pre); gặp thẻ lạ như <p> là
 * trả 400 cho CẢ tin. Nên đập phẳng: thẻ khối thành xuống dòng, còn lại bỏ,
 * rồi giải mã entity — `&amp;` giải CUỐI CÙNG kẻo "&amp;lt;" bị giải hai lần
 * thành "<" và tự tạo thẻ giả.
 */
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|ul|ol|h[1-6]|blockquote|tr|li)>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]*>/g, '');
  const decoded = stripped
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
  return decoded
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Cắt theo CODE POINT chứ không theo đơn vị UTF-16: tên sản phẩm có emoji
 * (chủ shop tự gõ), `slice` cắt giữa surrogate pair là ra ký tự rác và
 * Telegram có thể từ chối cả tin.
 */
export function truncateLabel(value: string, max: number): string {
  const points = Array.from(value);
  if (points.length <= max) return value;
  return `${points.slice(0, Math.max(1, max - 1)).join('')}…`;
}

/**
 * Cắt văn bản THÔ về đúng ngân sách rồi mới escape; escape nở chuỗi (& thành
 * &amp;) nên lặp co lại tới khi bản đã escape lọt ngân sách — cắt bản đã
 * escape thì có thể đứt giữa entity ("&am…") và vỡ HTML.
 */
function fitEscaped(raw: string, budget: number): string {
  if (budget < 20) return '';
  const all = Array.from(raw);
  let points = all.length > budget ? all.slice(0, budget) : all;
  let out = escapeHtml(points.join(''));
  while (out.length > budget && points.length > 1) {
    points = points.slice(0, Math.floor(points.length * 0.9));
    out = escapeHtml(points.join(''));
  }
  return points.length < all.length ? `${out}…` : out;
}

// ---------------------------------------------------------------- callback

export type BotCallback =
  | { kind: 'catalog'; page: number }
  | { kind: 'product'; productId: string; backPage: number };

/** Bot API chặt cứng callback_data ở 64 byte. */
const CALLBACK_MAX_BYTES = 64;

export function encodeCallback(cb: BotCallback): string {
  return cb.kind === 'catalog'
    ? `c:${cb.page}`
    : `p:${cb.productId}:${cb.backPage}`;
}

/**
 * Parse CHẶT: callback_data là dữ liệu client gửi lên (client Telegram sửa
 * được tuỳ ý), nên rác/quá dài/số trang không nguyên dương đều trả null thay
 * vì cố hiểu.
 */
export function parseCallback(data: string | undefined): BotCallback | null {
  if (!data || Buffer.byteLength(data, 'utf8') > CALLBACK_MAX_BYTES) return null;
  const catalog = /^c:([1-9][0-9]{0,5})$/.exec(data);
  if (catalog) return { kind: 'catalog', page: Number(catalog[1]) };
  const product = /^p:([A-Za-z0-9_-]{1,48}):([1-9][0-9]{0,5})$/.exec(data);
  if (product) {
    return { kind: 'product', productId: product[1], backPage: Number(product[2]) };
  }
  return null;
}

// ---------------------------------------------------------------- giá

/**
 * VND tròn nghìn viết gọn kiểu shop Telegram: 75000 → "75k", 3800000 →
 * "3800k". Số LẺ giữ nguyên định dạng đầy đủ ("77.982 ₫") — làm tròn ở nhãn
 * là nhãn nói dối giá, khách bấm vào thấy số khác ngay.
 */
function compactMoney(amount: number, currency: DisplayCurrency): string {
  if (
    currency === 'VND' &&
    Number.isInteger(amount) &&
    amount > 0 &&
    amount % 1000 === 0
  ) {
    return `${amount / 1000}k`;
  }
  return formatMoney(amount, currency);
}

/** Giá hiện trên nhãn nút — cùng nguồn giá neo với thẻ sản phẩm trên web. */
export function productPriceLabel(
  product: ProductDto,
  lang: BotLang,
  rates: StoreRatesDto | null,
): string {
  const dict = botDict(lang);
  const currency = CURRENCY_BY_LANG[lang];
  const neo = cheapestAnchored(product.variants);
  let text: string;
  if (neo) {
    const hien = displayPriceAmount(neo, currency, rates);
    text = compactMoney(hien.amount, hien.currency);
  } else {
    // Không loại nào đang bán → lùi về minPrice, quy đổi như web (priceUsdt):
    // thiếu tỉ giá thì hiện USDT chứ không bịa số.
    const doi = convertFromUsdt(product.minPrice, currency, rates);
    text = doi === null ? formatUsdt(product.minPrice) : compactMoney(doi, currency);
  }
  return product.maxPrice > product.minPrice ? dict.priceFrom(text) : text;
}

// ---------------------------------------------------------------- nút sản phẩm

/** Nhãn nút: `{tên} | {giá} | 📦 {tồn}` — nhìn thấy đủ ba thứ không cần mở chi tiết. */
export function productButtonLabel(
  product: ProductDto,
  lang: BotLang,
  rates: StoreRatesDto | null,
): string {
  const price = productPriceLabel(product, lang, rates);
  // "Còn 0" cấp sản phẩm là quy ước chủ shop trên web — nút cũng không âm.
  const suffix = ` | ${price} | 📦 ${Math.max(0, product.availableStock)}`;
  const nameBudget = Math.max(6, BUTTON_LABEL_MAX - Array.from(suffix).length);
  return `${truncateLabel(product.name, nameBudget)}${suffix}`;
}

// ---------------------------------------------------------------- danh sách

export interface StorefrontView {
  text: string;
  keyboard: TgInlineKeyboard;
  page: number;
  totalPages: number;
}

function supportLineText(
  lang: BotLang,
  supportChannels: readonly SupportChannelDto[],
): string | null {
  if (supportChannels.length === 0) return null;
  const channels = supportChannels
    .map((channel) => `${channel.label}: ${channel.value}`)
    .join(' • ');
  return escapeHtml(botDict(lang).supportLine(channels));
}

/**
 * Tin chào + bàn phím sản phẩm. `page` vượt biên thì KẸP về trang gần nhất
 * chứ không báo lỗi — danh sách đổi giữa hai cú bấm là chuyện bình thường
 * (admin vừa tắt bớt sản phẩm), khách không có lỗi gì để phải thấy lỗi.
 */
export function renderStorefront(
  products: readonly ProductDto[],
  lang: BotLang,
  rates: StoreRatesDto | null,
  supportChannels: readonly SupportChannelDto[],
  page = 1,
  /** Lời chào chủ shop tự soạn; rỗng/không truyền = câu mặc định theo ngôn ngữ. */
  greeting = '',
): StorefrontView {
  const dict = botDict(lang);
  const loiChao = greeting.trim() !== '' ? greeting.trim() : dict.start;
  const lines: string[] = [escapeHtml(loiChao)];
  const support = supportLineText(lang, supportChannels);
  if (support) lines.push('', support);

  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_MAX_ITEMS));
  const current = Math.min(Math.max(1, Math.trunc(page)), totalPages);
  const keyboard: TgInlineKeyboard = [];

  if (products.length === 0) {
    lines.push('', escapeHtml(dict.catalogEmpty));
  } else {
    const start = (current - 1) * PAGE_MAX_ITEMS;
    for (const product of products.slice(start, start + PAGE_MAX_ITEMS)) {
      keyboard.push([
        {
          text: productButtonLabel(product, lang, rates),
          callback_data: encodeCallback({
            kind: 'product',
            productId: product.id,
            backPage: current,
          }),
        },
      ]);
    }
    if (totalPages > 1) {
      const nav: TgInlineKeyboardButton[] = [];
      if (current > 1) {
        nav.push({
          text: dict.pagePrev,
          callback_data: encodeCallback({ kind: 'catalog', page: current - 1 }),
        });
      }
      // Nút giữa bấm cũng vô hại: render lại đúng trang, Telegram trả
      // "message is not modified" và service nuốt trong im lặng.
      nav.push({
        text: dict.pageLabel(current, totalPages),
        callback_data: encodeCallback({ kind: 'catalog', page: current }),
      });
      if (current < totalPages) {
        nav.push({
          text: dict.pageNext,
          callback_data: encodeCallback({ kind: 'catalog', page: current + 1 }),
        });
      }
      keyboard.push(nav);
    }
  }

  return { text: lines.join('\n'), keyboard, page: current, totalPages };
}

// ---------------------------------------------------------------- thông báo admin

/**
 * Tin "Thông báo từ Admin" từ hộp thông báo trang chủ. null = không có gì để
 * gửi (tắt, hoặc bật mà rỗng — đừng gửi một tin trống).
 */
export function renderAnnouncement(
  announcement: AnnouncementDto,
  lang: BotLang,
): string | null {
  if (!announcement.active) return null;
  const dict = botDict(lang);
  const parts: string[] = [`<b>${escapeHtml(dict.announcementTitle)}</b>`];
  const title = announcement.title.trim();
  if (title !== '') parts.push(`<b>${escapeHtml(title)}</b>`);
  const body = htmlToPlainText(announcement.body);
  if (body !== '') {
    parts.push(fitEscaped(body, TG_TEXT_LIMIT - SAFETY_MARGIN - 200));
  }
  if (parts.length === 1) return null;
  return parts.join('\n');
}

// ---------------------------------------------------------------- chi tiết

/** Trang chi tiết một sản phẩm — thay tại chỗ tin chào bằng editMessageText. */
export function renderProductDetail(
  product: ProductDto,
  lang: BotLang,
  rates: StoreRatesDto | null,
  supportChannels: readonly SupportChannelDto[],
  backPage: number,
): { text: string; keyboard: TgInlineKeyboard } {
  const dict = botDict(lang);
  const currency = CURRENCY_BY_LANG[lang];

  const head: string[] = [`<b>${escapeHtml(product.name)}</b>`];
  if (product.category) head.push(escapeHtml(product.category));
  if (product.shortDescription) {
    head.push('', `<i>${escapeHtml(product.shortDescription)}</i>`);
  }

  const variantLines: string[] = [];
  if (product.variants.length > 0) {
    variantLines.push('', escapeHtml(dict.variantsTitle));
    for (const variant of product.variants) {
      const hien = displayPriceAmount(variant, currency, rates);
      const price = formatMoney(hien.amount, hien.currency);
      const stock =
        variant.availableStock > 0
          ? dict.inStock(variant.availableStock)
          : dict.outOfStock;
      variantLines.push(
        `• <b>${escapeHtml(variant.name)}</b> — ${escapeHtml(price)} — ${escapeHtml(stock)}`,
      );
    }
  }

  const tail: string[] = [''];
  const stockLine = [
    // "Đã bán 0" ở cửa hàng mới là bằng chứng NGƯỢC — ẩn như trên web.
    product.sold > 0 ? dict.soldCount(product.sold) : null,
    dict.inStock(Math.max(0, product.availableStock)),
  ]
    .filter((part): part is string => part !== null)
    .join(' • ');
  tail.push(escapeHtml(stockLine));
  const support = supportLineText(lang, supportChannels);
  if (support) tail.push(support);
  tail.push(escapeHtml(dict.detailBuyHint));

  // Mô tả nhét vừa phần còn lại của trần 4096 — dài quá thì cắt, âm thì bỏ.
  const fixed = [...head, ...variantLines, ...tail].join('\n');
  const middle: string[] = [];
  if (product.description) {
    const budget = TG_TEXT_LIMIT - SAFETY_MARGIN - fixed.length - 2;
    const fitted = fitEscaped(product.description, budget);
    if (fitted !== '') middle.push('', fitted);
  }

  const keyboard: TgInlineKeyboard = [
    [
      {
        text: dict.detailBack,
        callback_data: encodeCallback({ kind: 'catalog', page: backPage }),
      },
    ],
  ];

  return {
    text: [...head, ...middle, ...variantLines, ...tail].join('\n'),
    keyboard,
  };
}
