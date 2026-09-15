import type { TgInlineKeyboard } from './telegram-api';
import type { BotLang } from './messages';
import { validJoinUrl } from './membership-access';

export const JOIN_CALLBACK = 'membership:check';

const words = {
  vi: { title: '🔒 YÊU CẦU THAM GIA', body: '👋 Để bắt đầu sử dụng bot, bạn vui lòng tham gia kênh bên dưới.', hint: '👇 Sau khi hoàn tất, bấm nút xác nhận.', channel: '📢 Kênh thông báo', check: '✅ Tôi đã tham gia', pending: 'Bạn chưa tham gia kênh. Hãy tham gia rồi kiểm tra lại.', error: 'Chưa kiểm tra được thành viên. Vui lòng thử lại sau.', success: '✅ Đã xác nhận tham gia kênh.' },
  en: { title: '🔒 JOIN OUR CHANNEL', body: '👋 Please join the channel below to start using the bot.', hint: '👇 Once joined, tap the confirmation button.', channel: '📢 Announcement channel', check: '✅ I have joined', pending: 'You have not joined yet. Join the channel and check again.', error: 'Unable to check membership. Please try again later.', success: '✅ Channel membership confirmed.' },
  zh: { title: '🔒 请先加入频道', body: '👋 使用机器人前，请先加入下方频道。', hint: '👇 加入后，请点击确认按钮。', channel: '📢 公告频道', check: '✅ 我已加入', pending: '尚未加入频道，请加入后重试。', error: '暂时无法验证成员身份，请稍后重试。', success: '✅ 已确认加入频道。' },
};

export const membershipText = (lang: BotLang) => words[lang];

export function renderMembershipGate(lang: BotLang, url: string): { text: string; keyboard: TgInlineKeyboard } {
  const t = words[lang];
  return {
    text: ['<b>' + t.title + '</b>', '', t.body, '', t.hint].join('\n'),
    keyboard: [
      ...(validJoinUrl(url) ? [[{ text: t.channel, url }]] : []),
      [{ text: t.check, callback_data: JOIN_CALLBACK }],
    ],
  };
}
