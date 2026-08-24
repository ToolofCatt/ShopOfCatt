import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AnnouncementService } from '../announcement/announcement.service';
import { BalanceService } from '../balance/balance.service';
import { isMessageKey, parseMessage, translate } from '../i18n/messages';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { SettingsService } from '../settings/settings.service';
import {
  parseCallback,
  renderAnnouncement,
  renderCategoryProducts,
  renderHub,
  renderLanguageMenu,
  renderProductDetail,
  renderStorefront,
  renderSupport,
  type BotCallback,
  type StorefrontView,
} from './catalog-view';
import { DEPOSIT_MAX_VND, DEPOSIT_MIN_VND } from '../balance/balance.service';
import {
  renderMethodChooser,
  renderOrderDelivered,
  renderOrderList,
  renderOrderView,
  renderPaymentInstructions,
  renderQuantityPicker,
  type BotView,
} from './order-view';
import { TelegramUsersService } from './telegram-users.service';
import {
  mainMenuKeyboard,
  matchMenuAction,
  renderAccount,
  renderDepositConfirm,
  renderDepositCredited,
  renderDepositInstructions,
  renderDepositMenu,
  type MenuAction,
} from './wallet-view';
import { botDict, botLang, type BotLang } from './messages';
import {
  TelegramApiError,
  tgCall,
  tgDisplayName,
  tgSendPhotoUpload,
  type TgCallbackQuery,
  type TgInlineKeyboard,
  type TgMessage,
  type TgReplyKeyboard,
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
 * Mỗi chat tối đa bấy nhiêu đơn PENDING. Đơn PENDING giữ chỗ KHO THẬT tới khi
 * hết hạn, mà tạo chat Telegram gần như miễn phí — không chặn là một kẻ phá
 * đặt loạt đơn không trả tiền và khoá sạch kho khỏi tay khách thật.
 */
const MAX_PENDING_PER_CHAT = 2;

/**
 * Chu kỳ vòng ĐẨY key: quét đơn DELIVERED của khách Telegram chưa được báo
 * (outbox `telegramNotifiedAt`) rồi nhắn thẳng vào chat. Webhook SePay chốt
 * đơn trong vài giây, nên 15 giây là khách gần như nhận key "ngay lập tức"
 * mà không phải bấm gì.
 */
const NOTIFY_MS = 15_000;

/** Mỗi lượt đẩy tối đa bấy nhiêu đơn — phần dư sang lượt sau, khỏi giữ vòng lặp lâu. */
const NOTIFY_BATCH = 10;

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
  private notifyTimer: NodeJS.Timeout | null = null;
  private notifying = false;

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

  /** @username sau lần getMe thành công gần nhất — cho trang /admin/telegram. */
  private botUsername: string | null = null;
  /** Lỗi gần nhất đáng cho chủ shop biết (token bị từ chối/thu hồi). */
  private lastError: string | null = null;

  private readonly chatCooldown = new Map<number, number>();
  private readonly callbackCooldown = new Map<number, number>();

  constructor(
    private readonly settings: SettingsService,
    private readonly products: ProductsService,
    private readonly announcements: AnnouncementService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly users: TelegramUsersService,
    private readonly balance: BalanceService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.superviseTimer = setInterval(() => {
      void this.supervise();
    }, SUPERVISE_MS);
    // unref: đừng vì bot mà giữ tiến trình sống trong test/tắt máy chủ.
    this.superviseTimer.unref?.();
    this.notifyTimer = setInterval(() => {
      void this.notifySweep();
    }, NOTIFY_MS);
    this.notifyTimer.unref?.();
    void this.supervise();
  }

  onModuleDestroy(): void {
    if (this.superviseTimer) {
      clearInterval(this.superviseTimer);
      this.superviseTimer = null;
    }
    if (this.notifyTimer) {
      clearInterval(this.notifyTimer);
      this.notifyTimer = null;
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
        this.lastError = `Token bị Telegram từ chối: ${errText(err)}`;
        this.logger.error(
          `Token bot bị Telegram từ chối (${errText(err)}) — bot KHÔNG chạy. Dán lại token trong /admin/telegram.`,
        );
        return;
      }

      this.lastBadToken = null;
      this.lastError = null;
      this.botUsername = username;
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
    this.botUsername = null;
    this.generation += 1;
    this.stopController.abort();
    this.logger.log(`Bot: dừng long-polling (${reason})`);
  }

  /** Trạng thái sống của bot cho trang /admin/telegram. */
  getStatus(): { running: boolean; botUsername: string | null; lastError: string | null } {
    return {
      running: this.activeToken !== null,
      botUsername: this.botUsername,
      lastError: this.lastError,
    };
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
          this.lastError = 'Token bị thu hồi trên @BotFather — bot đã dừng.';
          this.stopPolling('token bị thu hồi');
          this.logger.error(
            'Token bot bị thu hồi — bot dừng. Dán token mới trong /admin/telegram.',
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
    const [products, rates, support, cfg] = await Promise.all([
      this.products.list(lang),
      this.settings.getPublicRates(),
      this.settings.getSupportInfo(),
      this.settings.getTelegramConfig(),
    ]);
    return {
      products,
      rates,
      support: support.supportChannels,
      greeting: cfg.greeting,
      sendAnnouncement: cfg.sendAnnouncement,
    };
  }

  /**
   * Gửi ảnh QR: tải bytes về rồi upload — Telegram không tự tải nổi
   * qr.sepay.vn (400 "failed to get HTTP URL content", đã gặp thật).
   * Trượt kiểu gì cũng chỉ log — hướng dẫn chữ đã đủ số liệu chuyển khoản.
   */
  private async sendQrPhoto(
    token: string,
    chatId: number,
    url: string,
    caption: string,
    stop: AbortSignal,
  ): Promise<void> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`tai QR duoc HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      /*
       * qr.sepay.vn trả LỖI DẠNG HTML với status 200 ("Ngân hàng này không
       * được hỗ trợ") — kiểm magic bytes PNG/JPEG trước khi đẩy cho Telegram,
       * không thì lỗi hiện ra là IMAGE_PROCESS_FAILED vô nghĩa.
       */
      const dau = new Uint8Array(bytes.slice(0, 3));
      const laPng = dau[0] === 0x89 && dau[1] === 0x50 && dau[2] === 0x4e;
      const laJpeg = dau[0] === 0xff && dau[1] === 0xd8;
      if (!laPng && !laJpeg) {
        const loi = Buffer.from(bytes.slice(0, 120)).toString('utf8');
        throw new Error(`SePay không trả ảnh mà trả: ${loi}`);
      }
      await tgSendPhotoUpload(token, chatId, bytes, caption, stop);
    } catch (err) {
      this.logger.warn(`Gửi ảnh QR trượt (chat ${chatId}): ${errText(err)}`);
    }
  }

  private async sendHtml(
    token: string,
    chatId: number,
    text: string,
    // Mảng = bàn phím inline; object = bàn phím CỐ ĐỊNH dưới ô nhập.
    keyboard: TgInlineKeyboard | TgReplyKeyboard | null,
    stop: AbortSignal,
  ): Promise<void> {
    const replyMarkup = keyboard
      ? Array.isArray(keyboard)
        ? { inline_keyboard: keyboard }
        : keyboard
      : null;
    await tgCall(
      token,
      'sendMessage',
      {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        // Link t.me trong kênh hỗ trợ sẽ kéo preview to đùng che tin nếu không tắt.
        link_preview_options: { is_disabled: true },
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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
  /**
   * Ngôn ngữ của MỘT chat: khách đã tự chọn ở màn 🌐 thì lựa chọn đó thắng,
   * chưa chọn thì đoán theo language_code của app như cũ.
   */
  private async resolveLang(chatId: number, languageCode?: string): Promise<BotLang> {
    const user = await this.users.findByChat(chatId);
    if (
      user?.telegramLangChosen &&
      (['vi', 'en', 'zh'] as readonly string[]).includes(user.telegramLang)
    ) {
      return user.telegramLang as BotLang;
    }
    return botLang(languageCode);
  }

  /** Số liệu màn 👤 — chỉ những con số CÓ THẬT: tổng chi + đơn đã giao. */
  private async accountStats(userId: string): Promise<{ spentUsdt: number; doneCount: number }> {
    const [tong, done] = await Promise.all([
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: { userId, status: { in: ['PAID', 'DELIVERED'] } },
      }),
      this.prisma.order.count({ where: { userId, status: 'DELIVERED' } }),
    ]);
    return { spentUsdt: Number(tong._sum.totalAmount ?? 0), doneCount: done };
  }

  /** Dựng HUB cho một chat — tên + số dư thật (nếu đã có tài khoản). */
  private async hubFor(
    chatId: number,
    from: TgUser | undefined,
    lang: BotLang,
  ): Promise<{ text: string; keyboard: TgInlineKeyboard }> {
    const [user, rates, cfg] = await Promise.all([
      this.users.findByChat(chatId),
      this.settings.getPublicRates(),
      this.settings.getTelegramConfig(),
    ]);
    const ordersCount = user
      ? await this.prisma.order.count({ where: { userId: user.id } })
      : null;
    const ten = from?.first_name ?? user?.telegramName ?? '';
    return renderHub(
      ten,
      user ? Number(user.balance) : null,
      lang,
      rates,
      cfg.greeting,
      ordersCount,
    );
  }

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

    const chatId = message.chat.id;
    const lang = await this.resolveLang(chatId, message.from?.language_code);
    const dict = botDict(lang);
    const text = message.text.trim();
    try {
      // Nút menu cố định gửi TEXT của nó — so với nhãn của cả ba ngôn ngữ.
      const menu: MenuAction | null = text.startsWith('/orders')
        ? 'orders'
        : matchMenuAction(text);
      if (menu !== null && menu !== 'shop') {
        await this.handleMenuAction(token, chatId, message.from, lang, menu, stop);
        return;
      }
      if (menu === 'shop') {
        const data = await this.loadStorefront(lang);
        const view = renderStorefront(data.products, lang, data.rates);
        await this.sendHtml(token, chatId, view.text, view.keyboard, stop);
        return;
      }

      // Khách GÕ MỘT CON SỐ = số tiền muốn nạp (kiểu Lâm Shop) — hỏi xác nhận
      // bằng nút, không tạo mã ngay kẻo gõ nhầm cũng thành mã nạp.
      if (/^[0-9]{3,10}$/.test(text)) {
        const vnd = Number(text);
        if (vnd < DEPOSIT_MIN_VND || vnd > DEPOSIT_MAX_VND) {
          await this.sendHtml(token, chatId, escapeText(dict.depositRange), null, stop);
          return;
        }
        const view = renderDepositConfirm(vnd, lang);
        await this.sendHtml(token, chatId, view.text, view.keyboard, stop);
        return;
      }

      if (text.startsWith('/start')) {
        const cfg = await this.settings.getTelegramConfig();
        if (cfg.sendAnnouncement) {
          const announcement = renderAnnouncement(
            await this.announcements.getPublic(lang),
            lang,
          );
          if (announcement !== null) {
            await this.sendHtml(token, chatId, announcement, null, stop);
          }
        }
        // Tin riêng gắn bàn phím CỐ ĐỊNH: Telegram chỉ cho một reply_markup
        // mỗi tin, mà HUB đã dùng chỗ đó cho nút inline.
        await this.sendHtml(
          token,
          chatId,
          escapeText(dict.menuHint),
          mainMenuKeyboard(lang),
          stop,
        );
      }
      // Mọi text còn lại → HUB (kiểu Lâm Shop: gõ gì cũng quay về bảng điều khiển).
      const hub = await this.hubFor(chatId, message.from, lang);
      await this.sendHtml(token, chatId, hub.text, hub.keyboard, stop);
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

    const chatId = message.chat.id;
    const lang = await this.resolveLang(chatId, cb.from.language_code);
    const dict = botDict(lang);

    /** Sửa tin hiện tại thành `view`; kèm ảnh (QR) thì gửi ảnh thành tin MỚI. */
    const edit = async (view: { text: string; keyboard: TgInlineKeyboard }) => {
      try {
        await tgCall(
          token,
          'editMessageText',
          {
            chat_id: chatId,
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
        // Bấm lại đúng nút đang mở: Telegram trả 400 "message is not modified"
        // — không phải lỗi, nuốt trong im lặng thay vì rác log.
        if (
          err instanceof TelegramApiError &&
          err.message.includes('message is not modified')
        ) {
          return;
        }
        // Tin quá cũ (Telegram khoá sửa sau ~48h) hay chat bị chặn — kệ, vòng
        // poll phải sống tiếp.
        this.logger.warn(`editMessageText trượt (chat ${chatId}): ${errText(err)}`);
      }
    };

    try {
      await this.runCallback(token, parsed, {
        chatId,
        from: cb.from,
        lang,
        answer,
        edit,
        stop,
      });
    } catch (err) {
      /*
       * Lỗi nghiệp vụ từ service (hết hàng, đơn không tồn tại, mock đang tắt…)
       * mang KHOÁ i18n — dịch cho khách xem thay vì im lặng. Lỗi lạ thì câu
       * chung chung; cả hai đều KHÔNG được giết vòng poll.
       */
      await answer({ text: this.botErrorText(err, lang), show_alert: true });
    }
  }

  /** Một nút menu cố định (hoặc lệnh /orders) — gửi TIN MỚI, không sửa tin cũ. */
  private async handleMenuAction(
    token: string,
    chatId: number,
    from: TgUser | undefined,
    lang: BotLang,
    action: Exclude<MenuAction, 'shop'>,
    stop: AbortSignal,
  ): Promise<void> {
    const dict = botDict(lang);
    switch (action) {
      case 'orders': {
        const user = await this.users.findByChat(chatId);
        const [orders, rates] = await Promise.all([
          user ? this.orders.listOwn(user.id) : Promise.resolve([]),
          this.settings.getPublicRates(),
        ]);
        const view = renderOrderList(orders, lang, rates);
        await this.sendHtml(token, chatId, view.text, view.keyboard, stop);
        return;
      }
      case 'account': {
        const user = await this.users.findOrCreate(chatId, tgDisplayName(from), lang);
        const [stats, rates] = await Promise.all([
          this.accountStats(user.id),
          this.settings.getPublicRates(),
        ]);
        const view = renderAccount(
          {
            name: from?.first_name ?? user.telegramName,
            code: user.code,
            balance: Number(user.balance),
            ...stats,
          },
          lang,
          rates,
        );
        await this.sendHtml(token, chatId, view.text, view.keyboard, stop);
        return;
      }
      case 'deposit': {
        const cfg = await this.settings.getSepayConfig();
        if (!cfg.ready || cfg.vndPerUsdt <= 0) {
          // Fail-closed: chưa có đường đối soát thì nói thẳng, không chào mã nạp.
          await this.sendHtml(token, chatId, escapeText(dict.depositUnavailable), null, stop);
          return;
        }
        const [user, rates] = await Promise.all([
          this.users.findByChat(chatId),
          this.settings.getPublicRates(),
        ]);
        const view = renderDepositMenu(lang, user ? Number(user.balance) : null, rates);
        await this.sendHtml(token, chatId, view.text, view.keyboard, stop);
        return;
      }
      case 'support': {
        const info = await this.settings.getSupportInfo();
        const view = renderSupport(info.supportChannels, info.supportNote, lang);
        await this.sendHtml(token, chatId, view.text, view.keyboard, stop);
        return;
      }
    }
  }

  /** Ngữ cảnh một cú bấm — gom lại cho các nhánh khỏi 6 tham số lẻ. */
  private async runCallback(
    token: string,
    parsed: BotCallback,
    ctx: {
      chatId: number;
      from: TgUser;
      lang: BotLang;
      answer: (payload?: Record<string, unknown>) => Promise<void>;
      edit: (view: { text: string; keyboard: TgInlineKeyboard }) => Promise<void>;
      stop: AbortSignal;
    },
  ): Promise<void> {
    const { chatId, lang, answer, edit, stop } = ctx;
    const dict = botDict(lang);

    switch (parsed.kind) {
      case 'hub': {
        const hub = await this.hubFor(chatId, ctx.from, lang);
        await answer();
        await edit(hub);
        return;
      }
      case 'catalog': {
        const data = await this.loadStorefront(lang);
        await answer();
        await edit(renderStorefront(data.products, lang, data.rates, parsed.page));
        return;
      }
      case 'category': {
        const data = await this.loadStorefront(lang);
        await answer();
        const view = renderCategoryProducts(
          data.products, parsed.catIndex, lang, data.rates, parsed.page,
        );
        // Danh mục đổi giữa hai cú bấm (admin sửa) → vẽ lại màn cửa hàng.
        await edit(view ?? renderStorefront(data.products, lang, data.rates));
        return;
      }
      case 'product': {
        const data = await this.loadStorefront(lang);
        const product = data.products.find((p) => p.id === parsed.productId);
        if (!product) {
          // Sản phẩm vừa bị tắt/xoá giữa hai cú bấm — báo khách rồi vẽ lại
          // danh sách để cái nút mồ côi biến mất.
          await answer({ text: dict.productGone, show_alert: true });
          await edit(renderStorefront(data.products, lang, data.rates));
          return;
        }
        await answer();
        await edit(
          renderProductDetail(product, lang, data.rates, data.support, parsed.backPage),
        );
        return;
      }
      case 'support': {
        const info = await this.settings.getSupportInfo();
        await answer();
        await edit(renderSupport(info.supportChannels, info.supportNote, lang));
        return;
      }
      case 'langMenu': {
        await answer();
        await edit(renderLanguageMenu(lang));
        return;
      }
      case 'setLang': {
        await this.users.setLanguage(chatId, tgDisplayName(ctx.from), parsed.lang);
        const dictMoi = botDict(parsed.lang);
        await answer({
          text: dictMoi.langSet(dictMoi.langNames[parsed.lang] ?? parsed.lang),
        });
        // HUB vẽ lại bằng ngôn ngữ mới + bàn phím CỐ ĐỊNH mới (nhãn đổi tiếng).
        const hub = await this.hubFor(chatId, ctx.from, parsed.lang);
        await edit(hub);
        await this.sendHtml(
          token,
          chatId,
          escapeText(dictMoi.menuHint),
          mainMenuKeyboard(parsed.lang),
          stop,
        );
        return;
      }
      case 'buy': {
        const data = await this.loadStorefront(lang);
        const product = data.products.find((p) => p.id === parsed.productId);
        const variant = product?.variants.find((v) => v.id === parsed.variantId);
        if (!product || !variant || variant.availableStock <= 0) {
          await answer({ text: dict.variantSoldOut, show_alert: true });
          return;
        }
        await answer();
        await edit(renderQuantityPicker(product, variant, lang, data.rates, parsed.backPage));
        return;
      }
      case 'qty': {
        const user = await this.users.findOrCreate(
          chatId,
          tgDisplayName(ctx.from),
          lang,
        );
        const pending = await this.prisma.order.count({
          where: { userId: user.id, status: 'PENDING' },
        });
        if (pending >= MAX_PENDING_PER_CHAT) {
          await answer({ text: dict.tooManyPending(pending), show_alert: true });
          return;
        }
        const created = await this.orders.create(user, {
          items: [{ variantId: parsed.variantId, quantity: parsed.qty }],
        });
        const [methods, rates] = await Promise.all([
          this.settings.getEnabledMethods(),
          this.settings.getPublicRates(),
        ]);
        await answer();
        const phut = minutesLeft(created.order.expiresAt);
        const soDu = Number(user.balance);
        // Đủ số dư thì LUÔN qua bảng chọn để nút "trả bằng số dư" xuất hiện,
        // kể cả khi cửa hàng chỉ bật một cổng.
        if (methods.length > 1 || soDu >= created.order.totalAmount) {
          await edit(
            renderMethodChooser(created.order, methods, lang, rates, phut, soDu),
          );
          return;
        }
        // Chỉ một phương thức — create() đã áp nó sẵn, vào thẳng hướng dẫn.
        await this.showInstructions(token, created.order, lang, rates, methods, ctx);
        return;
      }
      case 'method': {
        const user = await this.requireUser(chatId);
        const [order, rates, methods] = await Promise.all([
          this.orders.selectPayment(user.id, parsed.orderCode, parsed.method),
          this.settings.getPublicRates(),
          this.settings.getEnabledMethods(),
        ]);
        await answer();
        await this.showInstructions(token, order, lang, rates, methods, ctx);
        return;
      }
      case 'check': {
        const user = await this.requireUser(chatId);
        const result = await this.orders.checkPayment(user.id, parsed.orderCode);
        if (result.delivered) {
          const detail = await this.orders.getOwnDetail(user.id, parsed.orderCode);
          await answer();
          await edit(renderOrderDelivered(detail, lang));
          // Khách đã thấy key qua nút kiểm tra — đánh dấu để vòng đẩy không
          // gửi lại lần nữa.
          await this.markNotified(detail.id);
          return;
        }
        if (result.status === 'PAID') {
          await answer({ text: dict.checkPaidWaitDelivery, show_alert: true });
          return;
        }
        if (result.status === 'PENDING') {
          await answer({ text: dict.checkStillPending, show_alert: true });
          return;
        }
        // EXPIRED/CANCELLED — vẽ lại trạng thái cuối để nút thanh toán biến mất.
        const detail = await this.orders.getOwnDetail(user.id, parsed.orderCode);
        const rates = await this.settings.getPublicRates();
        await answer();
        await edit(renderOrderView(detail, lang, rates, null));
        return;
      }
      case 'mockConfirm': {
        const user = await this.requireUser(chatId);
        const result = await this.payments.confirmMock(user.id, parsed.orderCode);
        if (result.status === 'DELIVERED') {
          const detail = await this.orders.getOwnDetail(user.id, parsed.orderCode);
          await answer();
          await edit(renderOrderDelivered(detail, lang));
          await this.markNotified(detail.id);
          return;
        }
        await answer({ text: dict.checkPaidWaitDelivery, show_alert: true });
        return;
      }
      case 'cancelOrder': {
        const user = await this.requireUser(chatId);
        await this.orders.cancel(user.id, parsed.orderCode);
        await answer();
        await edit({
          text: escapeText(dict.orderCancelled(parsed.orderCode)),
          keyboard: [
            [
              {
                text: dict.btnBackToShop,
                callback_data: 'c:1',
              },
            ],
          ],
        });
        return;
      }
      case 'orders': {
        const user = await this.users.findByChat(chatId);
        const [list, rates] = await Promise.all([
          user ? this.orders.listOwn(user.id) : Promise.resolve([]),
          this.settings.getPublicRates(),
        ]);
        await answer();
        await edit(renderOrderList(list, lang, rates));
        return;
      }
      case 'order': {
        const user = await this.requireUser(chatId);
        const [detail, rates, methods] = await Promise.all([
          this.orders.getOwnDetail(user.id, parsed.orderCode),
          this.settings.getPublicRates(),
          this.settings.getEnabledMethods(),
        ]);
        await answer();
        if (detail.status === 'DELIVERED') await this.markNotified(detail.id);
        // Xem lại đơn PENDING thì KHÔNG gửi lại ảnh QR — dội ảnh mỗi lần mở là spam.
        const view = renderOrderView(
          detail, lang, rates, minutesLeft(detail.expiresAt), sepayHolder(methods),
        );
        await edit({ text: view.text, keyboard: view.keyboard });
        return;
      }
      case 'account': {
        const user = await this.users.findOrCreate(chatId, tgDisplayName(ctx.from), lang);
        const [stats, rates] = await Promise.all([
          this.accountStats(user.id),
          this.settings.getPublicRates(),
        ]);
        await answer();
        await edit(
          renderAccount(
            {
              name: ctx.from.first_name ?? user.telegramName,
              code: user.code,
              balance: Number(user.balance),
              ...stats,
            },
            lang,
            rates,
          ),
        );
        return;
      }
      case 'depositMenu': {
        const cfg = await this.settings.getSepayConfig();
        if (!cfg.ready || cfg.vndPerUsdt <= 0) {
          await answer({ text: dict.depositUnavailable, show_alert: true });
          return;
        }
        const [user, rates] = await Promise.all([
          this.users.findByChat(chatId),
          this.settings.getPublicRates(),
        ]);
        await answer();
        await edit(renderDepositMenu(lang, user ? Number(user.balance) : null, rates));
        return;
      }
      case 'depositAmount': {
        const user = await this.users.findOrCreate(chatId, tgDisplayName(ctx.from), lang);
        const kq = await this.balance.createDeposit(user, parsed.vnd);
        await answer();
        const view = renderDepositInstructions(
          {
            code: kq.deposit.code,
            vndAmount: Number(kq.deposit.vndAmount),
            amountUsdt: Number(kq.deposit.amountUsdt),
          },
          kq,
          lang,
          minutesLeft(kq.deposit.expiresAt.toISOString()),
        );
        await edit({ text: view.text, keyboard: view.keyboard });
        if (view.photo) {
          await this.sendQrPhoto(
            token,
            chatId,
            view.photo,
            escapeText(dict.payMemo(kq.deposit.code)),
            stop,
          );
        }
        return;
      }
      case 'depositCheck': {
        const user = await this.requireUser(chatId);
        const deposit = await this.balance.getOwnDeposit(user.id, parsed.code);
        if (!deposit) {
          await answer({ text: dict.tryAgain, show_alert: true });
          return;
        }
        if (deposit.status === 'SUCCESS') {
          const [rates, soDu] = await Promise.all([
            this.settings.getPublicRates(),
            this.balance.getBalance(user.id),
          ]);
          await answer();
          await edit(
            renderDepositCredited(Number(deposit.amountUsdt), soDu, lang, rates),
          );
          await this.balance.markDepositNotified(deposit.id);
          return;
        }
        if (deposit.status === 'PENDING') {
          await answer({ text: dict.depositStillPending, show_alert: true });
          return;
        }
        await answer();
        await edit({
          text: escapeText(
            deposit.status === 'CANCELLED'
              ? dict.depositCancelled(deposit.code)
              : dict.depositExpired,
          ),
          keyboard: [
            [
              {
                text: dict.menuDeposit,
                callback_data: 'd',
              },
            ],
          ],
        });
        return;
      }
      case 'depositCancel': {
        const user = await this.requireUser(chatId);
        await this.balance.cancelDeposit(user.id, parsed.code);
        await answer();
        await edit({
          text: escapeText(dict.depositCancelled(parsed.code)),
          keyboard: [[{ text: dict.btnBackToShop, callback_data: 'c:1' }]],
        });
        return;
      }
      case 'payBalance': {
        const user = await this.requireUser(chatId);
        const kq = await this.balance.payOrderWithBalance(user.id, parsed.orderCode);
        if (kq.delivered) {
          const detail = await this.orders.getOwnDetail(user.id, parsed.orderCode);
          await answer();
          await edit(renderOrderDelivered(detail, lang));
          await this.markNotified(detail.id);
          return;
        }
        // Trả xong nhưng kho thiếu lúc giao — sweeper sẽ cứu, khách tự kiểm lại.
        await answer({ text: dict.checkPaidWaitDelivery, show_alert: true });
        return;
      }
    }
  }

  /**
   * Vòng ĐẨY key — nửa còn lại của lời hứa "tiền vào là hàng ra": webhook/bộ
   * đối soát chốt đơn xong, vòng này nhắn key vào chat mà khách KHÔNG phải bấm
   * "Tôi đã chuyển".
   *
   * Chạy NGOÀI transaction giao hàng (ràng buộc trong docs/BOT-TELEGRAM.md):
   * đọc outbox `telegramNotifiedAt`, gửi rồi mới đánh dấu — tiến trình chết
   * giữa hai bước thì lượt sau gửi TRÙNG một tin, thà trùng còn hơn mất key.
   */
  private async notifySweep(): Promise<void> {
    const token = this.activeToken;
    if (!token || this.notifying) return;
    this.notifying = true;
    try {
      const cho = await this.prisma.order.findMany({
        where: {
          status: 'DELIVERED',
          telegramNotifiedAt: null,
          user: { telegramChatId: { not: null } },
        },
        select: {
          id: true,
          code: true,
          userId: true,
          user: { select: { telegramChatId: true, telegramLang: true } },
        },
        orderBy: { paidAt: 'asc' },
        take: NOTIFY_BATCH,
      });

      for (const order of cho) {
        if (this.activeToken !== token) return; // bot vừa bị tắt/đổi token
        const chatId = Number(order.user.telegramChatId);
        // Khách trước cột telegramLang chưa có ngôn ngữ lưu lại — cửa hàng VN
        // nên lùi về tiếng Việt (khác mặc định "en" của lượt chat trực tiếp,
        // nơi còn language_code để đoán).
        const lang: BotLang = (['vi', 'en', 'zh'] as readonly string[]).includes(
          order.user.telegramLang,
        )
          ? (order.user.telegramLang as BotLang)
          : 'vi';
        try {
          const detail = await this.orders.getOwnDetail(order.userId, order.code);
          const view = renderOrderDelivered(detail, lang);
          await this.sendHtml(
            token,
            chatId,
            view.text,
            view.keyboard,
            this.stopController.signal,
          );
          await this.markNotified(order.id);
          this.logger.log(`Đã đẩy key đơn ${order.code} vào chat ${chatId}`);
        } catch (err) {
          if (err instanceof TelegramApiError) {
            // Lỗi CỦA CHAT (khách chặn bot, chat biến mất…) — không bao giờ
            // gửi được nữa, đánh dấu luôn kẻo lượt nào cũng thử lại và rác log.
            // Key vẫn nằm ở "🧾 Đơn của tôi" và trang quản trị.
            this.logger.warn(
              `Đẩy key đơn ${order.code} bị Telegram từ chối (${errText(err)}) — thôi không thử lại.`,
            );
            await this.markNotified(order.id);
          } else {
            // Lỗi mạng/CSDL thoáng qua — để nguyên, lượt sau thử lại.
            this.logger.warn(`Đẩy key đơn ${order.code} trượt: ${errText(err)}`);
          }
        }
      }
      // Tin nạp đã cộng — cùng cơ chế outbox với key.
      const napCho = await this.balance.listUnnotifiedDeposits(NOTIFY_BATCH);
      for (const nap of napCho) {
        if (this.activeToken !== token) return;
        const lang: BotLang = (['vi', 'en', 'zh'] as readonly string[]).includes(nap.lang)
          ? (nap.lang as BotLang)
          : 'vi';
        try {
          const rates = await this.settings.getPublicRates();
          const view = renderDepositCredited(nap.amountUsdt, nap.balance, lang, rates);
          await this.sendHtml(
            token,
            Number(nap.chatId),
            view.text,
            view.keyboard,
            this.stopController.signal,
          );
          await this.balance.markDepositNotified(nap.id);
          this.logger.log(`Đã báo cộng ví mã nạp ${nap.code}`);
        } catch (err) {
          if (err instanceof TelegramApiError) {
            this.logger.warn(
              `Báo cộng ví ${nap.code} bị Telegram từ chối (${errText(err)}) — thôi không thử lại.`,
            );
            await this.balance.markDepositNotified(nap.id);
          } else {
            this.logger.warn(`Báo cộng ví ${nap.code} trượt: ${errText(err)}`);
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Vòng đẩy key trượt: ${errText(err)}`);
    } finally {
      this.notifying = false;
    }
  }

  /** Đánh dấu "đã báo khách" — updateMany điều kiện null nên gọi trùng vô hại. */
  private async markNotified(orderId: string): Promise<void> {
    try {
      await this.prisma.order.updateMany({
        where: { id: orderId, telegramNotifiedAt: null },
        data: { telegramNotifiedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`Đánh dấu đã báo đơn ${orderId} trượt: ${errText(err)}`);
    }
  }

  /**
   * Hướng dẫn thanh toán sau khi tạo đơn/đổi phương thức: sửa tin hiện tại
   * thành hướng dẫn; SePay thì gửi THÊM ảnh QR thành tin mới (editMessageText
   * không đổi được tin chữ thành tin ảnh).
   */
  private async showInstructions(
    token: string,
    order: Parameters<typeof renderPaymentInstructions>[0],
    lang: BotLang,
    rates: Parameters<typeof renderPaymentInstructions>[2],
    methods: { method: string; accountHolder?: string }[],
    ctx: {
      chatId: number;
      edit: (view: { text: string; keyboard: TgInlineKeyboard }) => Promise<void>;
      stop: AbortSignal;
    },
  ): Promise<void> {
    const view = renderPaymentInstructions(
      order, lang, rates, minutesLeft(order.expiresAt), sepayHolder(methods),
    );
    await ctx.edit({ text: view.text, keyboard: view.keyboard });
    if (view.photo) {
      await this.sendQrPhoto(
        token,
        ctx.chatId,
        view.photo,
        escapeText(botDict(lang).payMemo(order.code)),
        ctx.stop,
      );
    }
  }

  /** Chat chưa từng mua mà bấm nút thao tác đơn — chỉ có thể là callback tự chế. */
  private async requireUser(chatId: number) {
    const user = await this.users.findByChat(chatId);
    if (!user) throw new Error('K_NO_USER');
    return user;
  }

  /**
   * Lỗi từ service mang KHOÁ i18n (K.xxx) → dịch theo ngôn ngữ khách; còn lại
   * trả câu chung — đừng lộ chi tiết nội bộ vào chat.
   */
  private botErrorText(err: unknown, lang: BotLang): string {
    const raw = err instanceof Error ? err.message : '';
    if (isMessageKey(raw)) {
      const { key, params } = parseMessage(raw);
      return translate(key, lang, params);
    }
    if (raw !== 'K_NO_USER') {
      this.logger.warn(`Lỗi callback không nhận diện được: ${raw}`);
    }
    return botDict(lang).tryAgain;
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

/** Escape tối thiểu cho chuỗi TỪ ĐIỂN chèn thẳng làm text HTML của một tin. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Số phút còn lại tới hạn — 0 khi đã quá, null khi đơn không có hạn. */
function minutesLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

/** Tên chủ tài khoản SePay từ danh sách phương thức đang bật (rỗng nếu không có). */
function sepayHolder(methods: readonly { method: string; accountHolder?: string }[]): string {
  return methods.find((m) => m.method === 'sepay')?.accountHolder ?? '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
