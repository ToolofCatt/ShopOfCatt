import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { botDict, botLang } from './messages';
import {
  TelegramApiError,
  tgCall,
  type TgMessage,
  type TgUpdate,
  type TgUser,
} from './telegram-api';

/** Chu kỳ soi lại cài đặt — công tắc/token đổi trên /admin/settings là bot theo. */
const SUPERVISE_MS = 15_000;

/** Telegram giữ getUpdates tối đa chừng này giây rồi mới trả rỗng. */
const POLL_TIMEOUT_S = 25;

/** Nghỉ sau một lỗi mạng — đừng quay vòng nóng khi Telegram sập. */
const RETRY_DELAY_MS = 5_000;

/**
 * Mỗi chat chỉ được bot trả lời tối đa 1 lần trong khoảng này. RateLimitGuard
 * là guard HTTP nên không với tới đây — bot phải tự chặn, nếu không một script
 * spam tin là bot đốt hết hạn mức sendMessage của chính nó (~30 tin/giây).
 */
const CHAT_COOLDOWN_MS = 1_500;

/** Chống rò bộ nhớ: bảng cooldown đầy thì xoá trắng thay vì lớn mãi. */
const COOLDOWN_MAX_ENTRIES = 5_000;

/**
 * Bot Telegram bán hàng — khung Giai đoạn 1 (xem docs/BOT-TELEGRAM.md).
 *
 * Nhận update bằng LONG-POLLING chứ không webhook: không phải mở endpoint
 * công khai không xác thực, không phụ thuộc SITE_DOMAIN, chạy được cả ở dev.
 * Đổi lại chỉ được phép có MỘT instance gọi getUpdates — Telegram trả 409 cho
 * kẻ đến sau, và hiện stack chỉ chạy một container api nên ổn.
 *
 * Fail-closed: tắt trong cài đặt, hoặc thiếu/sai token ⇒ bot không chạy và
 * getReadiness() báo — không có nhánh "tạm chạy bằng cấu hình cũ".
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private superviseTimer: NodeJS.Timeout | null = null;
  private supervising = false;

  /** Token của vòng poll đang chạy; null = không có vòng nào. */
  private activeToken: string | null = null;
  /**
   * Tăng mỗi lần dừng/đổi token — vòng poll cũ so số này để tự thoát, kể cả
   * khi một vòng mới với CÙNG token đã kịp khởi động (không đua nhau getUpdates).
   */
  private generation = 0;
  /** Cắt ngay getUpdates đang treo khi dừng — xem chú thích trong tgCall. */
  private stopController = new AbortController();

  /**
   * Token đã trượt getMe. Nhớ lại để chỉ báo lỗi MỘT lần rồi im, thay vì mỗi
   * 15 giây một dòng error cho tới khi chủ shop sửa token — nhưng vẫn tự thử
   * lại khi token trong cài đặt ĐỔI (chuỗi khác là được thử).
   */
  private lastBadToken: string | null = null;

  private readonly chatCooldown = new Map<number, number>();

  constructor(private readonly settings: SettingsService) {}

  onModuleInit(): void {
    this.superviseTimer = setInterval(() => {
      void this.supervise();
    }, SUPERVISE_MS);
    // unref: đừng vì bot mà giữ tiến trình sống trong test/tắt máy chủ.
    this.superviseTimer.unref?.();
    void this.supervise();
  }

  onModuleDestroy(): void {
    if (this.superviseTimer) {
      clearInterval(this.superviseTimer);
      this.superviseTimer = null;
    }
    this.stopPolling('tắt máy chủ');
  }

  /** Soi cài đặt rồi đưa vòng poll về đúng trạng thái mong muốn. */
  private async supervise(): Promise<void> {
    if (this.supervising) return;
    this.supervising = true;
    try {
      const cfg = await this.settings.getTelegramConfig();
      const shouldRun = cfg.enabled && cfg.token !== '';

      if (!shouldRun) {
        if (this.activeToken !== null) this.stopPolling('tắt trong cài đặt');
        return;
      }
      if (this.activeToken === cfg.token) return; // đang chạy đúng token
      if (this.lastBadToken === cfg.token) return; // token hỏng — đã báo, chờ đổi

      if (this.activeToken !== null) this.stopPolling('token đổi');

      // Kiểm token bằng getMe TRƯỚC khi vào vòng poll: token sai thì báo một
      // câu rõ ràng ngay, thay vì để getUpdates 401 lặp lại trong log.
      let username: string;
      try {
        const me = await tgCall<TgUser>(cfg.token, 'getMe');
        username = me.username ? `@${me.username}` : String(me.id);
      } catch (err) {
        this.lastBadToken = cfg.token;
        this.logger.error(
          `Token bot bị Telegram từ chối (${errText(err)}) — bot KHÔNG chạy. Dán lại token trong /admin/settings.`,
        );
        return;
      }

      this.lastBadToken = null;
      this.activeToken = cfg.token;
      this.stopController = new AbortController();
      const gen = ++this.generation;
      this.logger.log(`Bot ${username}: bắt đầu long-polling`);
      void this.pollLoop(cfg.token, gen);
    } catch (err) {
      // Lỗi đọc cài đặt (CSDL chớp nhoáng…) — giữ nguyên trạng thái, lượt sau thử lại.
      this.logger.warn(`Không đọc được cài đặt bot: ${errText(err)}`);
    } finally {
      this.supervising = false;
    }
  }

  private stopPolling(reason: string): void {
    this.activeToken = null;
    this.generation += 1;
    this.stopController.abort();
    this.logger.log(`Bot: dừng long-polling (${reason})`);
  }

  /** Vòng getUpdates — sống tới khi generation đổi hoặc token bị thu hồi. */
  private async pollLoop(token: string, gen: number): Promise<void> {
    const stop = this.stopController.signal;
    let offset = 0;
    while (this.generation === gen) {
      try {
        const updates = await tgCall<TgUpdate[]>(
          token,
          'getUpdates',
          { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message'] },
          (POLL_TIMEOUT_S + 10) * 1_000,
          stop,
        );
        for (const update of updates) {
          offset = update.update_id + 1;
          if (this.generation !== gen) return;
          await this.handleMessage(token, update.message, stop);
        }
      } catch (err) {
        if (this.generation !== gen) return; // dừng chủ động — không phải lỗi
        if (err instanceof TelegramApiError && (err.code === 401 || err.code === 404)) {
          // Token bị thu hồi GIỮA CHỪNG (chủ shop revoke trên @BotFather).
          this.lastBadToken = token;
          this.stopPolling('token bị thu hồi');
          this.logger.error(
            'Token bot bị thu hồi — bot dừng. Dán token mới trong /admin/settings.',
          );
          return;
        }
        if (err instanceof TelegramApiError && err.code === 409) {
          // Một tiến trình KHÁC cũng đang getUpdates cùng token — tình huống
          // hai container api. Cứ nghỉ rồi thử lại, nhưng phải nói rõ trong log.
          this.logger.warn('getUpdates 409: có tiến trình khác đang poll cùng bot');
        } else {
          this.logger.warn(`Lỗi vòng poll (thử lại sau ${RETRY_DELAY_MS / 1000}s): ${errText(err)}`);
        }
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  /** Giai đoạn 1: chỉ chào /start và nói thật là chưa mở bán. */
  private async handleMessage(
    token: string,
    message: TgMessage | undefined,
    stop: AbortSignal,
  ): Promise<void> {
    if (!message?.text || message.from?.is_bot) return;
    // Chỉ tiếp chat riêng: bot bán hàng không có việc gì trong group, và trả
    // lời trong group là một người lạ bất kỳ điều khiển được bot nói chuyện.
    if (message.chat.type !== 'private') return;
    if (!this.passCooldown(message.chat.id)) return;

    const dict = botDict(botLang(message.from?.language_code));
    const text = message.text.trim().startsWith('/start') ? dict.start : dict.notReady;
    try {
      await tgCall(
        token,
        'sendMessage',
        { chat_id: message.chat.id, text },
        15_000,
        stop,
      );
    } catch (err) {
      // Một chat gửi trượt (bị khách chặn…) không được phép giết vòng poll.
      this.logger.warn(`sendMessage trượt (chat ${message.chat.id}): ${errText(err)}`);
    }
  }

  private passCooldown(chatId: number): boolean {
    const now = Date.now();
    const last = this.chatCooldown.get(chatId) ?? 0;
    if (now - last < CHAT_COOLDOWN_MS) return false;
    if (this.chatCooldown.size >= COOLDOWN_MAX_ENTRIES) this.chatCooldown.clear();
    this.chatCooldown.set(chatId, now);
    return true;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
