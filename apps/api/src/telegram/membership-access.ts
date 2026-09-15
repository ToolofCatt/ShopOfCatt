import { tgCall } from './telegram-api';

export interface MembershipConfig {
  membershipRequired: boolean;
  membershipChatId: string;
  membershipJoinUrl: string;
}

interface ChatMember { status: string; is_member?: boolean }
interface Channel { id: number; type: string; title?: string; username?: string; invite_link?: string }

/** Số lấy từ Telegram Desktop thường thiếu tiền tố Bot API -100. */
export function normalizeChannelId(value: string): string {
  const trimmed = value.trim();
  if (/^[1-9]\d{4,12}$/.test(trimmed)) return '-100' + trimmed;
  if (/^-100[1-9]\d{4,12}$/.test(trimmed)) return trimmed;
  if (/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(trimmed)) return trimmed;
  throw new Error('INVALID_CHANNEL');
}

export function validJoinUrl(value: string): boolean {
  return /^https:\/\/t\.me\/(?:[A-Za-z][A-Za-z0-9_]{4,31}|\+[A-Za-z0-9_-]{8,128}|joinchat\/[A-Za-z0-9_-]{8,128})\/?$/.test(value);
}

export function isChannelMember(member: ChatMember): boolean {
  return ['creator', 'administrator', 'member'].includes(member.status)
    || (member.status === 'restricted' && member.is_member === true);
}

/** Chỉ đọc Telegram. Không mời khách, cấp quyền bot hay tạo link ngoài ý muốn. */
export async function inspectMembershipChannel(token: string, rawId: string, rawUrl: string) {
  const chatId = normalizeChannelId(rawId);
  const [chat, bot] = await Promise.all([
    tgCall<Channel>(token, 'getChat', { chat_id: chatId }, 7_000),
    tgCall<{ id: number }>(token, 'getMe', {}, 7_000),
  ]);
  if (!['channel', 'supergroup'].includes(chat.type)) throw new Error('NOT_A_CHANNEL');
  const member = await tgCall<ChatMember>(token, 'getChatMember', { chat_id: chat.id, user_id: bot.id }, 7_000);
  if (!['creator', 'administrator'].includes(member.status)) throw new Error('BOT_NOT_ADMIN');
  const publicUrl = chat.username ? 'https://t.me/' + chat.username : '';
  const joinUrl = rawUrl.trim() || publicUrl || chat.invite_link || '';
  if (!validJoinUrl(joinUrl)) throw new Error('INVALID_JOIN_URL');
  // Kênh public phải dẫn đúng kênh đã kiểm tra, không để khách vào nhầm kênh.
  if (publicUrl && joinUrl.replace(/\/$/, '').toLowerCase() !== publicUrl.toLowerCase()) throw new Error('WRONG_CHANNEL_URL');
  return { chatId: String(chat.id), title: chat.title ?? '', joinUrl };
}

/** Không cache kết quả dương: rời kênh phải bị chặn cả khi bấm nút cũ. */
export async function checkChannelMembership(token: string, config: MembershipConfig, userId: number, stop: AbortSignal): Promise<'allowed' | 'join' | 'unavailable'> {
  if (!config.membershipRequired) return 'allowed';
  try {
    const chatId = normalizeChannelId(config.membershipChatId);
    if (!validJoinUrl(config.membershipJoinUrl) || !Number.isSafeInteger(userId) || userId <= 0) return 'unavailable';
    const botId = Number(token.split(':')[0]);
    const bot = await tgCall<ChatMember>(token, 'getChatMember', { chat_id: chatId, user_id: botId }, 5_000, stop);
    if (!['creator', 'administrator'].includes(bot.status)) return 'unavailable';
    const member = await tgCall<ChatMember>(token, 'getChatMember', { chat_id: chatId, user_id: userId }, 5_000, stop);
    return isChannelMember(member) ? 'allowed' : 'join';
  } catch {
    // Lỗi API/mạng không chứng minh đã tham gia; giữ chặn và cho khách thử lại.
    return 'unavailable';
  }
}
