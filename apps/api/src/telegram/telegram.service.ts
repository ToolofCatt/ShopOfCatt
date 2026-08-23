import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AnnouncementService } from '../announcement/announcement.service';
import { ProductsService } from '../products/products.service';
import { SettingsService } from '../settings/settings.service';
import {
  parseCallback,
  renderAnnouncement,
  renderProductDetail,
  renderStorefront,
  type StorefrontView,
} from './catalog-view';
import { botDict, botLang, type BotLang } from './messages';
import {
  TelegramApiError,
  tgCall,
  type TgCallbackQuery,
  type TgInlineKeyboard,
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

/**
 * Cooldown RIÊNG cho nút bấm, ngắn hơn hẳn tin nhắn: mở chi tiết rồi bấm
 * "Quay lại" ngay là thao tác bình thường — bắt chờ 1,5 giây là nút "chết"
 * khó hiểu. 0,5 giây chỉ để chặn giữ-nút-spam.
 */
const CALLBACK_COOLDOWN_MS = 500;

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
  private readonly callbackCooldown = new Map<number, number>();

  constructor(
    private readonly settings: SettingsService,
    private readonly products: ProductsService,
    private readonly announcements: AnnouncementService,
  ) {}

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
          {
            offset,
            timeout: POLL_TIMEOUT_S,
            allowed_updates: ['message', 'callback_query'],
          },
          (POLL_TIMEOUT_S + 10) * 1_000,
          stop,
        );
        for (const update of updates) {
          offset = update.update_id + 1;
          if (this.generation !== gen) return;
          if (update.callback_query) {
            await this.handleCallback(token, update.callback_query, stop);
          } else {
            await this.handleMessage(token, update.message, stop);
          }
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

  /**
   * Ba nguồn của một lần vẽ danh sách hàng — độc lập nhau nên chạy song song.
   * KHÔNG cache: cooldown đã chặn dội, còn tồn kho cũ 30-60 giây là loại sai
   * lệch tự chuốc ngay trước khi bot bán thật (GĐ3).
   */
  private async loadStorefront(lang: BotLang) {
    const [products, rates, support] = await Promise.all([
      this.products.list(lang),
      this.settings.getPublicRates(),
      this.settings.getSupportInfo(),
    ]);
    return { products, rates, support: support.supportChannels };
  }

  private async sendHtml(
    token: string,
    chatId: number,
    text: string,
    keyboard: TgInlineKeyboard | null,
    stop: AbortSignal,
  ): Promise<void> {
    await tgCall(
      token,
      'sendMessage',
      {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        // Link t.me trong kênh hỗ trợ sẽ kéo preview to đùng che tin nếu không tắt.
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
      },
      15_000,
      stop,
    );
  }

  /**
   * GĐ2: mọi tin nhắn đều trả về "mặt tiền" — tin chào + bàn phím sản phẩm.
   * /start được thêm tin "Thông báo từ Admin" phía trước (chỉ /start, kẻo mỗi
   * câu khách gõ lại dội một tin thông báo).
   */
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

    const lang = botLang(message.from?.language_code);
    const dict = botDict(lang);
    const chatId = message.chat.id;
    try {
      if (message.text.trim().startsWith('/start')) {
        const announcement = renderAnnouncement(
          await this.announcements.getPublic(lang),
          lang,
        );
        if (announcement !== null) {
          await this.sendHtml(token, chatId, announcement, null, stop);
        }
      }
      const { products, rates, support } = await this.loadStorefront(lang);
      const view = renderStorefront(products, lang, rates, support);
      await this.sendHtml(token, chatId, view.text, view.keyboard, stop);
    } catch (err) {
      // Một chat trượt (bị khách chặn, CSDL chớp nhoáng…) không được phép giết
      // vòng poll. Báo khách bằng chữ trần — parse_mode lúc này chính là thứ
      // vừa có thể hỏng.
      this.logger.warn(`Trả lời chat ${chatId} trượt: ${errText(err)}`);
      try {
        await tgCall(
          token,
          'sendMessage',
          { chat_id: chatId, text: dict.tryAgain },
          15_000,
          stop,
        );
      } catch {
        // Đến câu xin lỗi cũng trượt thì thôi — đừng lặp vô hạn.
      }
    }
  }

  /** Cú bấm nút inline: mở chi tiết sản phẩm / chuyển trang, sửa tin tại chỗ. */
  private async handleCallback(
    token: string,
    cb: TgCallbackQuery,
    stop: AbortSignal,
  ): Promise<void> {
    // LUÔN answerCallbackQuery kể cả khi bỏ qua — không answer là client treo
    // spinner trên nút tới ~30 giây, trông như bot chết.
    const answer = async (payload: Record<string, unknown> = {}) => {
      try {
        await tgCall(
          token,
          'answerCallbackQuery',
          { callback_query_id: cb.id, ...payload },
          15_000,
          stop,
        );
      } catch (err) {
        this.logger.warn(`answerCallbackQuery trượt: ${errText(err)}`);
      }
    };

    const message = cb.message;
    const parsed = parseCallback(cb.data);
    if (!message || message.chat.type !== 'private' || parsed === null) {
      await answer();
      return;
    }
    if (!this.passCallbackCooldown(message.chat.id)) {
      await answer();
      return;
    }

    const lang = botLang(cb.from.language_code);
    const dict = botDict(lang);
    let data: Awaited<ReturnType<TelegramService['loadStorefront']>>;
    try {
      data = await this.loadStorefront(lang);
    } catch (err) {
      this.logger.warn(`Tải dữ liệu cho callback trượt: ${errText(err)}`);
      await answer({ text: dict.tryAgain });
      return;
    }

    let view: { text: string; keyboard: StorefrontView['keyboard'] };
    if (parsed.kind === 'catalog') {
      view = renderStorefront(data.products, lang, data.rates, data.support, parsed.page);
      await answer();
    } else {
      const product = data.products.find((p) => p.id === parsed.productId);
      if (!product) {
        // Sản phẩm vừa bị tắt/xoá giữa hai cú bấm — báo khách rồi vẽ lại danh
        // sách để cái nút mồ côi biến mất.
        await answer({ text: dict.productGone, show_alert: true });
        view = renderStorefront(data.products, lang, data.rates, data.support, parsed.backPage);
      } else {
        view = renderProductDetail(product, lang, data.rates, data.support, parsed.backPage);
        await answer();
      }
    }

    try {
      await tgCall(
        token,
        'editMessageText',
        {
          chat_id: message.chat.id,
          message_id: message.message_id,
          text: view.text,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: view.keyboard },
        },
        15_000,
        stop,
      );
    } catch (err) {
      // Bấm lại đúng nút đang mở: Telegram trả 400 "message is not modified" —
      // không phải lỗi, nuốt trong im lặng thay vì rác log.
      if (
        err instanceof TelegramApiError &&
        err.message.includes('message is not modified')
      ) {
        return;
      }
      // Tin quá cũ (Telegram khoá sửa sau ~48h) hay chat bị chặn — kệ, vòng
      // poll phải sống tiếp.
      this.logger.warn(`editMessageText trượt (chat ${message.chat.id}): ${errText(err)}`);
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

  /** Bản sao của passCooldown cho nút bấm — bảng riêng, ngưỡng riêng. */
  private passCallbackCooldown(chatId: number): boolean {
    const now = Date.now();
    const last = this.callbackCooldown.get(chatId) ?? 0;
    if (now - last < CALLBACK_COOLDOWN_MS) return false;
    if (this.callbackCooldown.size >= COOLDOWN_MAX_ENTRIES) {
      this.callbackCooldown.clear();
    }
    this.callbackCooldown.set(chatId, now);
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
