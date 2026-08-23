/**
 * Bộ chữ của bot — tách khỏi `i18n/messages.ts` vì khác vai: bên kia là THÔNG
 * BÁO LỖI của API (đi qua exception filter), bên này là lời bot chủ động nói.
 *
 * Cùng quy ước với từ điển web: `vi` là nguồn chuẩn, kiểu suy ra từ nó, nên
 * thiếu khoá ở `en`/`zh` là lỗi biên dịch chứ không phải lỗi lúc chạy.
 */

export type BotLang = 'vi' | 'en' | 'zh';

const vi = {
  /** Trả lời /start. */
  start:
    'Xin chào! Đây là bot bán hàng của cửa hàng.\n\n' +
    'Bot đang được hoàn thiện — hiện CHƯA mua được hàng qua đây. ' +
    'Bạn vẫn mua được trên website như bình thường.',
  /** Mọi tin nhắn khác khi bot chưa mở bán. */
  notReady:
    'Bot đang được hoàn thiện, chưa nhận lệnh nào. Vui lòng quay lại sau hoặc mua trên website.',
};

type BotDictionary = typeof vi;

const en: BotDictionary = {
  start:
    'Hello! This is the store’s sales bot.\n\n' +
    'The bot is still under construction — you cannot buy here YET. ' +
    'You can still order on the website as usual.',
  notReady:
    'The bot is under construction and does not accept commands yet. Please come back later or order on the website.',
};

const zh: BotDictionary = {
  start:
    '你好！这是本店的销售机器人。\n\n' +
    '机器人仍在建设中——目前还不能在这里购买。您仍可以照常在网站上下单。',
  notReady: '机器人仍在建设中，暂不接受任何指令。请稍后再来，或在网站上下单。',
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
