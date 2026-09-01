/**
 * Dựng nội dung tin nhắn + bàn phím cho bot — module THUẦN, cố ý không đụng
 * Nest/fetch/Date để unit-test trần được. Toàn bộ phần dễ sai nhất của bot
 * (escape, cắt chuỗi, callback format, phân trang) nằm ở đây; telegram.service
 * chỉ là lớp keo I/O.
 *
 * Bố cục theo mẫu chủ shop chốt (bot "Lâm Shop", khảo sát 25/08/2026 —
 * scratchpad/tg/lamshop-dump*.txt): HUB điều khiển all-inline sửa tại chỗ →
 * 🛒 Cửa hàng → DANH MỤC (đếm số) → sản phẩm `Tên | giá | Còn n` → chi tiết
 * 📦/📝 + nút Mua theo loại.
 */

import {
  cheapestAnchored,
  convertFromUsdt,
  displayPriceAmount,
  formatMoney,
  formatUsdt,
  type AnchoredPrice,
  type AnnouncementDto,
  type DisplayCurrency,
  type PaymentMethod,
  type ProductDto,
  type StoreRatesDto,
  type SupportChannelDto,
} from '@webcatt/shared';
import { brandEmojiHtml } from './animated-emoji';
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
  | { kind: 'hub' }
  | { kind: 'searchPrompt' }
  | { kind: 'catalog'; page: number }
  | { kind: 'category'; catIndex: number; page: number }
  | { kind: 'product'; productId: string; backPage: number }
  | { kind: 'productDescription'; productId: string; backPage: number }
  | { kind: 'buy'; variantId: string; productId: string; backPage: number }
  | { kind: 'qty'; variantId: string; qty: number }
  | { kind: 'method'; orderCode: string; method: PaymentMethod }
  | { kind: 'check'; orderCode: string }
  | { kind: 'cancelOrder'; orderCode: string }
  | { kind: 'mockConfirm'; orderCode: string }
  | { kind: 'orders' }
  | { kind: 'order'; orderCode: string }
  | { kind: 'account' }
  | { kind: 'depositMenu' }
  | { kind: 'depositAmount'; vnd: number }
  | { kind: 'depositMethod'; vnd: number; method: PaymentMethod }
  | { kind: 'depositCheck'; code: string }
  | { kind: 'depositCancel'; code: string }
  | { kind: 'payBalance'; orderCode: string }
  | { kind: 'support' }
  | { kind: 'langMenu' }
  | { kind: 'setLang'; lang: BotLang };

/** Bot API chặt cứng callback_data ở 64 byte. */
const CALLBACK_MAX_BYTES = 64;

/**
 * Mã 2 ký tự cho phương thức trong callback_data — tên đầy đủ ("crypto_bep20")
 * cộng mã đơn là sát trần 64 byte, mà trần này Telegram không nới.
 */
const METHOD_TO_SHORT: Record<PaymentMethod, string> = {
  mock: 'mk',
  binance_pay: 'bp',
  binance_id: 'bi',
  crypto_bep20: 'cb',
  crypto_trc20: 'ct',
  sepay: 'sp',
};
const SHORT_TO_METHOD: Record<string, PaymentMethod> = Object.fromEntries(
  Object.entries(METHOD_TO_SHORT).map(([method, short]) => [short, method]),
) as Record<string, PaymentMethod>;

export function encodeCallback(cb: BotCallback): string {
  switch (cb.kind) {
    case 'hub':
      return 'h';
    case 'searchPrompt':
      return 'f';
    case 'catalog':
      return `c:${cb.page}`;
    case 'category':
      return `ct:${cb.catIndex}:${cb.page}`;
    case 'product':
      return `p:${cb.productId}:${cb.backPage}`;
    case 'productDescription':
      return `pd:${cb.productId}:${cb.backPage}`;
    case 'buy':
      return `b:${cb.variantId}:${cb.productId}:${cb.backPage}`;
    case 'qty':
      return `q:${cb.variantId}:${cb.qty}`;
    case 'method':
      return `m:${cb.orderCode}:${METHOD_TO_SHORT[cb.method]}`;
    case 'check':
      return `k:${cb.orderCode}`;
    case 'cancelOrder':
      return `x:${cb.orderCode}`;
    case 'mockConfirm':
      return `z:${cb.orderCode}`;
    case 'orders':
      return 'o';
    case 'order':
      return `v:${cb.orderCode}`;
    case 'account':
      return 'a';
    case 'depositMenu':
      return 'd';
    case 'depositAmount':
      return `dn:${cb.vnd}`;
    case 'depositMethod':
      return `dw:${cb.vnd}:${METHOD_TO_SHORT[cb.method]}`;
    case 'depositCheck':
      return `dk:${cb.code}`;
    case 'depositCancel':
      return `dx:${cb.code}`;
    case 'payBalance':
      return `mb:${cb.orderCode}`;
    case 'support':
      return 's';
    case 'langMenu':
      return 'lg';
    case 'setLang':
      return `lg:${cb.lang}`;
  }
}

/** Mã đơn dạng "DH-XXXXXX" — nhận rộng hơn một chút phòng đổi độ dài sau này. */
const ORDER_CODE_RE = '([A-Z0-9-]{3,32})';
const ID_RE = '([A-Za-z0-9_-]{1,48})';

/**
 * Parse CHẶT: callback_data là dữ liệu client gửi lên (client Telegram sửa
 * được tuỳ ý), nên rác/quá dài/số không hợp lệ đều trả null thay vì cố hiểu.
 * Số lượng chặn trần 50 ngay tại đây — nút chỉ chào tối đa 10, con số lớn hơn
 * chỉ có thể là callback tự chế.
 */
export function parseCallback(data: string | undefined): BotCallback | null {
  if (!data || Buffer.byteLength(data, 'utf8') > CALLBACK_MAX_BYTES) return null;
  let m: RegExpExecArray | null;
  if (data === 'h') return { kind: 'hub' };
  if (data === 'f') return { kind: 'searchPrompt' };
  if ((m = /^c:([1-9][0-9]{0,5})$/.exec(data))) {
    return { kind: 'catalog', page: Number(m[1]) };
  }
  if ((m = /^ct:([0-9]{1,3}):([1-9][0-9]{0,5})$/.exec(data))) {
    return { kind: 'category', catIndex: Number(m[1]), page: Number(m[2]) };
  }
  if ((m = new RegExp(`^p:${ID_RE}:([1-9][0-9]{0,5})$`).exec(data))) {
    return { kind: 'product', productId: m[1], backPage: Number(m[2]) };
  }
  if ((m = new RegExp(`^pd:${ID_RE}:([1-9][0-9]{0,5})$`).exec(data))) {
    return { kind: 'productDescription', productId: m[1], backPage: Number(m[2]) };
  }
  if ((m = new RegExp(`^b:${ID_RE}:${ID_RE}:([1-9][0-9]{0,5})$`).exec(data))) {
    return { kind: 'buy', variantId: m[1], productId: m[2], backPage: Number(m[3]) };
  }
  if ((m = new RegExp(`^q:${ID_RE}:([1-9][0-9]?)$`).exec(data))) {
    const qty = Number(m[2]);
    if (qty > 50) return null;
    return { kind: 'qty', variantId: m[1], qty };
  }
  if ((m = new RegExp(`^m:${ORDER_CODE_RE}:([a-z]{2})$`).exec(data))) {
    const method = SHORT_TO_METHOD[m[2]];
    return method ? { kind: 'method', orderCode: m[1], method } : null;
  }
  if ((m = new RegExp(`^k:${ORDER_CODE_RE}$`).exec(data))) {
    return { kind: 'check', orderCode: m[1] };
  }
  if ((m = new RegExp(`^x:${ORDER_CODE_RE}$`).exec(data))) {
    return { kind: 'cancelOrder', orderCode: m[1] };
  }
  if ((m = new RegExp(`^z:${ORDER_CODE_RE}$`).exec(data))) {
    return { kind: 'mockConfirm', orderCode: m[1] };
  }
  if (data === 'o') return { kind: 'orders' };
  if ((m = new RegExp(`^v:${ORDER_CODE_RE}$`).exec(data))) {
    return { kind: 'order', orderCode: m[1] };
  }
  if (data === 'a') return { kind: 'account' };
  if (data === 'd') return { kind: 'depositMenu' };
  if ((m = /^dn:([1-9][0-9]{3,8})$/.exec(data))) {
    // Chặn thô ở codec; chặn tinh (min/max) nằm ở BalanceService.
    return { kind: 'depositAmount', vnd: Number(m[1]) };
  }
  if ((m = /^dw:([1-9][0-9]{3,8}):([a-z]{2})$/.exec(data))) {
    // Phương thức có thật hay không do codec quyết; có được NẠP bằng phương
    // thức đó không thì BalanceService quyết (fail-closed).
    const method = SHORT_TO_METHOD[m[2]];
    return method
      ? { kind: 'depositMethod', vnd: Number(m[1]), method }
      : null;
  }
  if ((m = new RegExp(`^dk:${ORDER_CODE_RE}$`).exec(data))) {
    return { kind: 'depositCheck', code: m[1] };
  }
  if ((m = new RegExp(`^dx:${ORDER_CODE_RE}$`).exec(data))) {
    return { kind: 'depositCancel', code: m[1] };
  }
  if ((m = new RegExp(`^mb:${ORDER_CODE_RE}$`).exec(data))) {
    return { kind: 'payBalance', orderCode: m[1] };
  }
  if (data === 's') return { kind: 'support' };
  if (data === 'lg') return { kind: 'langMenu' };
  if ((m = /^lg:(vi|en|zh)$/.exec(data))) {
    return { kind: 'setLang', lang: m[1] as BotLang };
  }
  return null;
}

// ---------------------------------------------------------------- giá

/**
 * VND tròn nghìn viết gọn kiểu shop Telegram: 75000 → "75k", 3800000 →
 * "3800k". Số LẺ giữ nguyên định dạng đầy đủ ("77.982 ₫") — làm tròn ở nhãn
 * là nhãn nói dối giá, khách bấm vào thấy số khác ngay.
 */
export function compactMoney(amount: number, currency: DisplayCurrency): string {
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

/** Giá MỘT loại theo ngôn ngữ khách — dùng cho nút Mua và bảng chọn số lượng. */
export function displayVariantPrice(
  variant: AnchoredPrice,
  lang: BotLang,
  rates: StoreRatesDto | null,
): string {
  const hien = displayPriceAmount(variant, CURRENCY_BY_LANG[lang], rates);
  return compactMoney(hien.amount, hien.currency);
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

/** Nhãn nút theo số đông shop bot VN (Piggy/sahasa): `{tên} | {giá} | 📦 n`. */
export function productButtonLabel(
  product: ProductDto,
  lang: BotLang,
  rates: StoreRatesDto | null,
): string {
  const dict = botDict(lang);
  const price = productPriceLabel(product, lang, rates);
  const stock =
    product.availableStock > 0
      ? `📦 ${product.availableStock}`
      : dict.outOfStock;
  const suffix = ` | ${price} | ${stock}`;
  const nameBudget = Math.max(6, BUTTON_LABEL_MAX - Array.from(suffix).length);
  return `${truncateLabel(product.name, nameBudget)}${suffix}`;
}

// ---------------------------------------------------------------- hub

export interface StorefrontView {
  text: string;
  keyboard: TgInlineKeyboard;
  page: number;
  totalPages: number;
}

/**
 * HUB điều khiển — tin đầu tiên khách thấy, mọi màn khác quay về đây.
 * Nút hàng đầu hiện luôn SỐ DƯ (kiểu Lâm Shop) để khách thấy ví ngay.
 */
export function renderHub(
  customerName: string,
  balanceUsdt: number | null,
  lang: BotLang,
  rates: StoreRatesDto | null,
  /** Lời chào chủ shop tự soạn; rỗng = câu mặc định dùng thương hiệu đang xuất bản. */
  greeting = '',
  storeName = 'Digital Store',
): { text: string; keyboard: TgInlineKeyboard } {
  const dict = botDict(lang);

  const soDu = convertFromUsdt(balanceUsdt ?? 0, CURRENCY_BY_LANG[lang], rates);
  const nhanSoDu =
    soDu === null ? formatUsdt(balanceUsdt ?? 0) : formatMoney(soDu, CURRENCY_BY_LANG[lang]);

  // Tối giản kiểu Panda Shop: chào + số dư + mời chọn — hết. Không khối "uy
  // tín chuyên nghiệp" nào nữa; chữ càng ít càng đỡ trôi nút.
  const chao =
    greeting.trim() !== ''
      ? escapeHtml(greeting.trim())
      : escapeHtml(dict.hubHello(storeName.trim() || 'Digital Store', customerName.trim() || '...'));
  const text = [
    chao,
    escapeHtml(dict.hubBalanceLine2(nhanSoDu)),
    '',
    escapeHtml(dict.hubChoose),
  ].join('\n');

  const keyboard: TgInlineKeyboard = [
    [{ text: dict.menuShop, callback_data: encodeCallback({ kind: 'catalog', page: 1 }) }],
    [{ text: dict.searchBtn, callback_data: encodeCallback({ kind: 'searchPrompt' }) }],
    [{ text: dict.hubLangBtn, callback_data: encodeCallback({ kind: 'langMenu' }) }],
  ];
  return { text, keyboard };
}

// ---------------------------------------------------------------- cửa hàng + danh mục

export interface CategoryGroup {
  label: string;
  products: ProductDto[];
}

/** Nhóm sản phẩm theo danh mục, thứ tự ổn định — index là địa chỉ callback. */
export function groupCategories(
  products: readonly ProductDto[],
  lang: BotLang,
): CategoryGroup[] {
  const dict = botDict(lang);
  const map = new Map<string, ProductDto[]>();
  for (const product of products) {
    const label = product.category?.trim() || dict.categoryOther;
    const list = map.get(label) ?? [];
    list.push(product);
    map.set(label, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'vi'))
    .map(([label, list]) => ({ label, products: list }));
}

function productRows(
  products: readonly ProductDto[],
  lang: BotLang,
  rates: StoreRatesDto | null,
  page: number,
): { rows: TgInlineKeyboard; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_MAX_ITEMS));
  const current = Math.min(Math.max(1, Math.trunc(page)), totalPages);
  const start = (current - 1) * PAGE_MAX_ITEMS;
  const rows: TgInlineKeyboard = products
    .slice(start, start + PAGE_MAX_ITEMS)
    .map((product) => [
      {
        text: productButtonLabel(product, lang, rates),
        callback_data: encodeCallback({
          kind: 'product',
          productId: product.id,
          backPage: current,
        }),
      },
    ]);
  return { rows, page: current, totalPages };
}

function pageNav(
  current: number,
  totalPages: number,
  dict: ReturnType<typeof botDict>,
  data: (page: number) => string,
): TgInlineKeyboardButton[] {
  const nav: TgInlineKeyboardButton[] = [];
  if (current > 1) nav.push({ text: dict.pagePrev, callback_data: data(current - 1) });
  // Nút giữa bấm cũng vô hại: render lại đúng trang, Telegram trả
  // "message is not modified" và service nuốt trong im lặng.
  nav.push({ text: dict.pageLabel(current, totalPages), callback_data: data(current) });
  if (current < totalPages) nav.push({ text: dict.pageNext, callback_data: data(current + 1) });
  return nav;
}

/**
 * Màn CỬA HÀNG (nút 🛒 từ hub): nhiều danh mục → bảng danh mục kèm đếm số;
 * chỉ một danh mục thì khỏi bắt khách bấm thêm một lần — vào thẳng danh sách.
 * `page` chỉ có nghĩa ở dạng danh sách phẳng.
 */
export function renderStorefront(
  products: readonly ProductDto[],
  lang: BotLang,
  rates: StoreRatesDto | null,
  page = 1,
): StorefrontView {
  const dict = botDict(lang);
  const nhom = groupCategories(products, lang);
  const quayVeHub: TgInlineKeyboardButton = {
    text: dict.hubBackBtn,
    callback_data: encodeCallback({ kind: 'hub' }),
  };

  if (products.length === 0) {
    return {
      text: [`<b>${escapeHtml(dict.shopTitle)}</b>`, '', escapeHtml(dict.catalogEmpty)].join('\n'),
      keyboard: [[quayVeHub]],
      page: 1,
      totalPages: 1,
    };
  }

  /*
   * Ít hàng thì PHẲNG HOÁ dù có nhiều danh mục (học Piggy/sahasa): shop 3 sản
   * phẩm chia 3 danh mục mà bắt khách bấm hai lần mới thấy hàng là tự đuổi
   * khách. Danh mục chỉ đáng giá khi danh sách phẳng không còn nhìn nổi.
   */
  if (nhom.length <= 1 || products.length <= PAGE_MAX_ITEMS) {
    const { rows, page: current, totalPages } = productRows(products, lang, rates, page);
    const keyboard = [...rows];
    if (totalPages > 1) keyboard.push(pageNav(current, totalPages, dict, (p) => `c:${p}`));
    keyboard.push([quayVeHub]);
    return {
      text: `<b>${escapeHtml(dict.shopTitle)}</b>`,
      keyboard,
      page: current,
      totalPages,
    };
  }

  // Danh mục xếp BA CỘT chữ HOA, không đếm số — đúng kiểu Panda Shop.
  const keyboard: TgInlineKeyboard = [];
  for (let i = 0; i < nhom.length; i += 3) {
    const hang: TgInlineKeyboardButton[] = [];
    for (const [offset, group] of [nhom[i], nhom[i + 1], nhom[i + 2]].entries()) {
      if (!group) continue;
      hang.push({
        text: truncateLabel(group.label.toLocaleUpperCase('vi'), 14),
        callback_data: encodeCallback({ kind: 'category', catIndex: i + offset, page: 1 }),
      });
    }
    keyboard.push(hang);
  }
  keyboard.push([quayVeHub]);
  return {
    text: `<b>${escapeHtml(dict.shopTitle)}</b>`,
    keyboard,
    page: 1,
    totalPages: 1,
  };
}

/** Danh sách sản phẩm của MỘT danh mục (bấm từ màn cửa hàng). */
export function renderCategoryProducts(
  products: readonly ProductDto[],
  catIndex: number,
  lang: BotLang,
  rates: StoreRatesDto | null,
  page = 1,
): StorefrontView | null {
  const dict = botDict(lang);
  const nhom = groupCategories(products, lang);
  // Danh mục đổi giữa hai cú bấm (admin sửa) → null, service vẽ lại màn cửa hàng.
  const group = nhom[catIndex];
  if (!group) return null;

  const { rows, page: current, totalPages } = productRows(group.products, lang, rates, page);
  const keyboard = [...rows];
  if (totalPages > 1) {
    keyboard.push(pageNav(current, totalPages, dict, (p) => `ct:${catIndex}:${p}`));
  }
  keyboard.push([
    { text: dict.backToCategories, callback_data: encodeCallback({ kind: 'catalog', page: 1 }) },
  ]);
  return {
    text: `<b>${escapeHtml(dict.categoryTitle(group.label))}</b>`,
    keyboard,
    page: current,
    totalPages,
  };
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

const DETAIL_DESCRIPTION_PREVIEW_POINTS = 420;
const DETAIL_DESCRIPTION_PREVIEW_BUDGET = 1_200;

function productDescriptionText(product: ProductDto): string {
  const parts = [product.shortDescription, product.description]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part !== '');
  return parts.filter((part, index) => index === 0 || part !== parts[0]).join('\n\n');
}

function descriptionPreview(raw: string): { text: string; truncated: boolean } {
  const points = Array.from(raw.trim());
  const tooManyPoints = points.length > DETAIL_DESCRIPTION_PREVIEW_POINTS;
  const visible = tooManyPoints
    ? `${points.slice(0, DETAIL_DESCRIPTION_PREVIEW_POINTS - 1).join('')}…`
    : points.join('');
  const tooManyEscapedChars = escapeHtml(visible).length > DETAIL_DESCRIPTION_PREVIEW_BUDGET;
  return {
    text: fitEscaped(visible, DETAIL_DESCRIPTION_PREVIEW_BUDGET),
    truncated: tooManyPoints || tooManyEscapedChars,
  };
}

/** Trang chi tiết — phần mô tả dài được tách riêng để hành động mua không trôi. */
export function renderProductDetail(
  product: ProductDto,
  lang: BotLang,
  rates: StoreRatesDto | null,
  supportChannels: readonly SupportChannelDto[],
  backPage: number,
): { text: string; keyboard: TgInlineKeyboard } {
  const dict = botDict(lang);
  const currency = CURRENCY_BY_LANG[lang];

  const head: string[] = [
    // Logo hãng thật (nếu nhận ra) đứng trước tên — xem BRAND_EMOJI.
    `${brandEmojiHtml(product.name)}<b>${escapeHtml(product.name)}</b>`,
    escapeHtml(dict.detailPriceLine(productPriceLabel(product, lang, rates))),
    escapeHtml(dict.detailStockLine(Math.max(0, product.availableStock))),
    escapeHtml(dict.detailSoldLine(product.sold)),
  ];

  const hasStock = product.variants.some((variant) => variant.availableStock > 0);
  const moTa: string[] = [];
  let hasMoreDescription = false;
  const fullDescription = productDescriptionText(product);
  if (fullDescription !== '') {
    moTa.push('', escapeHtml(dict.detailDescTitle));
    const preview = descriptionPreview(fullDescription);
    if (preview.text !== '') moTa.push(preview.text);
    hasMoreDescription = preview.truncated;
  }

  const variantLines: string[] = [];
  if (product.variants.length > 1) {
    // Chỉ liệt kê khi có NHIỀU loại — một loại thì giá/kho ở đầu đã nói đủ.
    variantLines.push('', escapeHtml(dict.variantsTitle));
    for (const variant of product.variants) {
      const hien = displayPriceAmount(variant, currency, rates);
      const price = formatMoney(hien.amount, hien.currency);
      const stock =
        variant.availableStock > 0 ? `📦 ${variant.availableStock}` : dict.outOfStock;
      variantLines.push(
        `• <b>${escapeHtml(variant.name)}</b> — ${escapeHtml(price)} — ${escapeHtml(stock)}`,
      );
    }
  }

  const tail: string[] = [
    '',
    escapeHtml(hasStock ? dict.detailChoose : dict.detailUnavailable),
  ];

  const keyboard: TgInlineKeyboard = [];
  // Mỗi loại còn hàng một nút Mua — loại hết hàng không chào nút hỏng.
  for (const variant of product.variants) {
    if (variant.availableStock <= 0) continue;
    keyboard.push([
      {
        text: `🛒 ${truncateLabel(variant.name, 26)} — ${displayVariantPrice(variant, lang, rates)}`,
        callback_data: encodeCallback({
          kind: 'buy',
          variantId: variant.id,
          productId: product.id,
          backPage,
        }),
      },
    ]);
  }
  if (!hasStock) {
    keyboard.push([
      {
        text: dict.detailOutOfStockSupport,
        callback_data: encodeCallback({ kind: 'support' }),
      },
    ]);
  }
  if (hasMoreDescription) {
    keyboard.push([
      {
        text: dict.detailMore,
        callback_data: encodeCallback({
          kind: 'productDescription',
          productId: product.id,
          backPage,
        }),
      },
    ]);
  }
  keyboard.push([
    {
      text: dict.backToCategories,
      callback_data: encodeCallback({ kind: 'catalog', page: backPage }),
    },
  ]);

  return {
    text: [...head, ...moTa, ...variantLines, ...tail].join('\n'),
    keyboard,
  };
}

/** Màn mô tả đầy đủ — vẫn chặn trần 4096 và quay lại đúng sản phẩm/trang cũ. */
export function renderProductDescription(
  product: ProductDto,
  lang: BotLang,
  backPage: number,
): { text: string; keyboard: TgInlineKeyboard } {
  const dict = botDict(lang);
  const head = [
    `${brandEmojiHtml(product.name)}<b>${escapeHtml(product.name)}</b>`,
    `<b>${escapeHtml(dict.detailFullTitle)}</b>`,
    '',
  ];
  const budget = TG_TEXT_LIMIT - SAFETY_MARGIN - head.join('\n').length;
  const body = fitEscaped(productDescriptionText(product), budget);
  return {
    text: [...head, body || escapeHtml(dict.detailNoDescription)].join('\n'),
    keyboard: [
      [
        {
          text: dict.detailBackToProduct,
          callback_data: encodeCallback({
            kind: 'product',
            productId: product.id,
            backPage,
          }),
        },
      ],
      [
        {
          text: dict.backToCategories,
          callback_data: encodeCallback({ kind: 'catalog', page: backPage }),
        },
      ],
    ],
  };
}

/** Kết quả 🔎 tìm kiếm — bố cục theo Panda Shop. */
export function renderSearchResults(
  matches: readonly ProductDto[],
  query: string,
  lang: BotLang,
  rates: StoreRatesDto | null,
): { text: string; keyboard: TgInlineKeyboard } {
  const dict = botDict(lang);
  const keyboard: TgInlineKeyboard = matches.slice(0, PAGE_MAX_ITEMS).map((product) => [
    {
      text: productButtonLabel(product, lang, rates),
      callback_data: encodeCallback({ kind: 'product', productId: product.id, backPage: 1 }),
    },
  ]);
  keyboard.push([
    { text: dict.backToCategories, callback_data: encodeCallback({ kind: 'catalog', page: 1 }) },
  ]);
  return {
    text: escapeHtml(dict.searchResults(query, matches.length)),
    keyboard,
  };
}

/**
 * Lọc sản phẩm theo từ khoá — không phân biệt hoa thường lẫn DẤU tiếng Việt
 * ("gôk" thì chịu, nhưng "grok"/"GROK"/"grók" đều ra).
 */
export function searchProducts(
  products: readonly ProductDto[],
  query: string,
): ProductDto[] {
  const bo_dau = (v: string) =>
    v.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const q = bo_dau(query.trim());
  if (q === '') return [];
  return products.filter(
    (p) => bo_dau(p.name).includes(q) || bo_dau(p.category ?? '').includes(q),
  );
}

// ---------------------------------------------------------------- hỗ trợ + ngôn ngữ

export function supportLineText(
  lang: BotLang,
  supportChannels: readonly SupportChannelDto[],
): string | null {
  if (supportChannels.length === 0) return null;
  const channels = supportChannels
    .map((channel) => `${channel.label}: ${channel.value}`)
    .join(' • ');
  return escapeHtml(botDict(lang).supportLine(channels));
}

/** Màn ☎️ Hỗ Trợ & Liên Hệ — danh sách kênh admin đã cấu hình. */
export function renderSupport(
  supportChannels: readonly SupportChannelDto[],
  supportNote: string,
  lang: BotLang,
): { text: string; keyboard: TgInlineKeyboard } {
  const dict = botDict(lang);
  const lines = [`<b>${escapeHtml(dict.hubSupportBtn)}</b>`];
  if (supportNote.trim() !== '') lines.push('', escapeHtml(supportNote.trim()));
  if (supportChannels.length > 0) {
    lines.push('');
    for (const channel of supportChannels) {
      lines.push(`• ${escapeHtml(channel.label)}: ${escapeHtml(channel.value)}`);
    }
  } else {
    lines.push('', escapeHtml(dict.supportUnavailable));
  }
  return {
    text: lines.join('\n'),
    keyboard: [
      [{ text: dict.hubBackBtn, callback_data: encodeCallback({ kind: 'hub' }) }],
    ],
  };
}

/** Màn 🌐 chọn ngôn ngữ — theo mẫu Lâm Shop. */
export function renderLanguageMenu(
  lang: BotLang,
): { text: string; keyboard: TgInlineKeyboard } {
  const dict = botDict(lang);
  const text = [
    `<b>${escapeHtml(dict.langTitle)}</b>`,
    '━━━━━━━━━━━━━━━━━━',
    '',
    escapeHtml(dict.langCurrent(dict.langNames[lang] ?? lang)),
    escapeHtml(dict.langChoose),
  ].join('\n');
  const keyboard: TgInlineKeyboard = (['vi', 'en', 'zh'] as const).map((code) => [
    {
      text: dict.langNames[code] ?? code,
      callback_data: encodeCallback({ kind: 'setLang', lang: code }),
    },
  ]);
  keyboard.push([{ text: dict.hubBackBtn, callback_data: encodeCallback({ kind: 'hub' }) }]);
  return { text, keyboard };
}
