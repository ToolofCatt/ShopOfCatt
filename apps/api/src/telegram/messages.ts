/**
 * Bộ chữ của bot — tách khỏi `i18n/messages.ts` vì khác vai: bên kia là THÔNG
 * BÁO LỖI của API (đi qua exception filter), bên này là lời bot chủ động nói.
 *
 * Cùng quy ước với từ điển web: `vi` là nguồn chuẩn, kiểu suy ra từ nó, nên
 * thiếu khoá ở `en`/`zh` là lỗi biên dịch chứ không phải lỗi lúc chạy.
 */

export type BotLang = 'vi' | 'en' | 'zh';

const vi = {
  /** Tin chào — bàn phím sản phẩm gắn ngay dưới tin này. */
  start: 'Chào bạn đã đến với cửa hàng! Hôm nay bạn muốn mua gì ạ ^^',
  /** Tiêu đề tin thông báo lấy từ hộp thông báo trang chủ. */
  announcementTitle: 'Thông báo từ Admin:',
  /** Dòng kênh hỗ trợ dưới câu chào. */
  supportLine: (channels: string) => `Nhóm thông báo & hỗ trợ: ${channels}`,
  catalogEmpty: 'Cửa hàng chưa có sản phẩm nào đang bán. Vui lòng quay lại sau.',
  /** Tiền tố khi sản phẩm có nhiều loại giá khác nhau. */
  priceFrom: (price: string) => `Từ ${price}`,
  outOfStock: 'Hết hàng',
  inStock: (n: number) => `Còn ${n}`,
  soldCount: (n: number) => `Đã bán ${n}`,
  variantsTitle: 'Các loại:',
  detailBack: '« Quay lại',
  detailBuyHint: 'Để mua, hiện vui lòng đặt trên website hoặc liên hệ bên trên.',
  productGone: 'Sản phẩm này không còn bán nữa.',
  pagePrev: '« Trang trước',
  pageNext: 'Trang sau »',
  pageLabel: (page: number, total: number) => `Trang ${page}/${total}`,
  tryAgain: 'Có lỗi khi tải danh sách hàng, vui lòng thử lại sau.',
};

type BotDictionary = typeof vi;

const en: BotDictionary = {
  start: 'Welcome to the store! What would you like to buy today? ^^',
  announcementTitle: 'Announcement from Admin:',
  supportLine: (channels: string) => `News & support: ${channels}`,
  catalogEmpty: 'No products on sale yet. Please come back later.',
  priceFrom: (price: string) => `From ${price}`,
  outOfStock: 'Out of stock',
  inStock: (n: number) => `${n} left`,
  soldCount: (n: number) => `Sold ${n}`,
  variantsTitle: 'Options:',
  detailBack: '« Back',
  detailBuyHint: 'To buy, please order on the website or contact us above for now.',
  productGone: 'This product is no longer available.',
  pagePrev: '« Prev',
  pageNext: 'Next »',
  pageLabel: (page: number, total: number) => `Page ${page}/${total}`,
  tryAgain: 'Something went wrong loading the catalog, please try again later.',
};

const zh: BotDictionary = {
  start: '欢迎光临本店！今天想买点什么呢 ^^',
  announcementTitle: '管理员公告：',
  supportLine: (channels: string) => `通知与客服：${channels}`,
  catalogEmpty: '暂无在售商品，请稍后再来。',
  priceFrom: (price: string) => `${price} 起`,
  outOfStock: '缺货',
  inStock: (n: number) => `剩 ${n}`,
  soldCount: (n: number) => `已售 ${n}`,
  variantsTitle: '规格：',
  detailBack: '« 返回',
  detailBuyHint: '如需购买，目前请在网站下单或通过上方方式联系我们。',
  productGone: '该商品已下架。',
  pagePrev: '« 上一页',
  pageNext: '下一页 »',
  pageLabel: (page: number, total: number) => `第 ${page}/${total} 页`,
  tryAgain: '加载商品列表出错，请稍后重试。',
};

const DICTIONARIES: Record<BotLang, BotDictionary> = { vi, en, zh };

export function botDict(lang: BotLang): BotDictionary {
  return DICTIONARIES[lang];
}

/**
 * Đoán ngôn ngữ từ `language_code` của Telegram ("vi", "zh-hans", "en-GB"…).
 *
 * Mặc định tiếng Anh — cùng lựa chọn với web (khách không rõ nguồn gốc thì
 * tiếng Anh dễ hiểu hơn tiếng Việt), chứ không phải vì cửa hàng ưu tiên ai.
 */
export function botLang(languageCode: string | undefined): BotLang {
  const code = (languageCode ?? '').toLowerCase();
  if (code === 'vi' || code.startsWith('vi-')) return 'vi';
  if (code === 'zh' || code.startsWith('zh-')) return 'zh';
  return 'en';
}
