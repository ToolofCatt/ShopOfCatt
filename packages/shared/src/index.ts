// ===== Shared types & constants between @webcatt/api and @webcatt/web =====

export type Role = 'USER' | 'ADMIN' | 'SUPERADMIN';

/** ADMIN và SUPERADMIN đều vào được trang quản trị. */
export function isAdminRole(role: Role): boolean {
  return role === 'ADMIN' || role === 'SUPERADMIN';
}
export type OrderStatus = 'PENDING' | 'PAID' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
export type StockStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'WITHDRAWN';
/**
 * `BINANCE` = cổng Binance Pay MERCHANT (cần tài khoản merchant riêng).
 * `BINANCE_ID` = khách chuyển USDT thẳng tới Binance ID cá nhân của chủ shop —
 * chỉ cần khoá đọc là đối soát được, khác hẳn merchant.
 */
/** BALANCE = trả bằng số dư ví (bot Telegram) — không có phiên cổng ngoài nào. */
export type PaymentMode = 'MOCK' | 'BINANCE' | 'BINANCE_ID' | 'CRYPTO' | 'SEPAY' | 'BALANCE';

/** Phương thức thanh toán khách chọn ở trang thanh toán. */
export type PaymentMethod =
  | 'mock'
  | 'binance_pay'
  | 'binance_id'
  | 'crypto_bep20'
  | 'crypto_trc20'
  /** Chuyển khoản ngân hàng VND, SePay báo về bằng webhook. */
  | 'sepay';

/** Mạng blockchain cho USDT on-chain. */
export type CryptoNetwork = 'BEP20' | 'TRC20';

/** Kiểu giảm giá: theo phần trăm hoặc số tiền cố định. */
export type DiscountType = 'PERCENT' | 'FIXED';


export interface PaymentMethodDto {
  method: PaymentMethod;
  /**
   * Nơi nhận tiền: địa chỉ ví với crypto_bep20 / crypto_trc20, Binance ID với
   * binance_id. Không có với binance_pay (merchant) và mock.
   */
  address?: string;
  /**
   * Ảnh QR nhận tiền (data URI) — hiện chỉ có với binance_id.
   *
   * Trả kèm ở đây chứ KHÔNG chụp vào từng đơn: ảnh cỡ trăm KB, nhân theo số đơn
   * là phình cả CSDL lẫn 14 bản sao lưu, mà nội dung thì giống nhau mọi đơn.
   */
  qr?: string;
  /** sepay: ngân hàng và tên chủ tài khoản, để hiện ở trang sản phẩm. */
  bank?: string;
  accountHolder?: string;
}

// ---------- Auth ----------
export interface PublicUser {
  id: string;
  /** Mã khách hàng dạng số (bắt đầu từ 100000) — dùng để tra cứu/hỗ trợ */
  code: number;
  /** null = khách Telegram — không có mật khẩu nên không bao giờ đăng nhập web,
   *  giá trị null thực tế không chảy tới đây; kiểu null hoá theo cột CSDL. */
  email: string | null;
  role: Role;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}

// ---------- Ngôn ngữ dịch được ----------
/** Ngôn ngữ nội dung được dịch tự động từ tiếng Việt. */
export const TRANSLATABLE_LOCALES = ['en', 'zh'] as const;
export type TranslatableLocale = (typeof TRANSLATABLE_LOCALES)[number];

export interface ProductTranslationFields {
  name: string;
  shortDescription: string;
  description: string;
  category: string;
}

export type ProductTranslations = Partial<
  Record<TranslatableLocale, ProductTranslationFields>
>;

export type VariantTranslations = Partial<
  Record<TranslatableLocale, { name: string }>
>;

// ---------- Products ----------

/**
 * Độ dài tối đa của chuỗi data URI ảnh sản phẩm (~300 KB ảnh sau khi nén).
 *
 * Ảnh nằm trong cột `Product.image` nên nó đi theo MỌI bản sao lưu pg_dump —
 * 14 bản được giữ lại, nên mỗi KB ở đây tốn 14 KB dung lượng lưu trữ.
 * Trình duyệt nén trước khi gửi; đây là mức chặn cuối ở máy chủ.
 */
export const PRODUCT_IMAGE_MAX_LENGTH = 500_000;

/**
 * Ảnh nhỏ (~400px) dùng cho thẻ ngoài trang chủ và các danh sách quản trị.
 *
 * Truy vấn danh sách sản phẩm KHÔNG kéo cột ảnh lớn về (xem `publicListSelect`
 * trong `products.service.ts`). Trước khi có cột này, trang chủ 20 sản phẩm là
 * 20 tấm ảnh 1200px nhúng thẳng vào JSON — vài MB cho một trang mà ô hiển thị
 * chỉ rộng ~250px.
 */
export const PRODUCT_THUMBNAIL_MAX_LENGTH = 120_000;

/**
 * Số ảnh tối đa một sản phẩm: 1 ảnh bìa + 5 ảnh phụ.
 *
 * Chặn cứng vì ảnh lưu base64 trong CSDL và `backup.sh` giữ 14 bản dump: 50 sản
 * phẩm × 6 ảnh × ~120 KB ≈ 36 MB mỗi bản, ≈ 500 MB cho cả 14 bản. Nới số này là
 * nới luôn dung lượng sao lưu theo cấp số nhân.
 */
export const PRODUCT_IMAGE_MAX_COUNT = 6;

/** Một ảnh phụ trong bộ sưu tập của sản phẩm (không gồm ảnh bìa). */
export interface ProductImageDto {
  id: string;
  /**
   * Địa chỉ tuyệt đối tới endpoint phục vụ ảnh, dùng thẳng làm `src`.
   *
   * Trước đây trường này là data URI nhúng thẳng. Ảnh base64 xuất hiện HAI lần
   * trong HTML (một ở markup, một trong gói dữ liệu Next dùng để hydrate) nên
   * một trang chi tiết ba ảnh thật nặng gần 1 MB — và không cache được vì trang
   * render động. Qua endpoint riêng thì HTML chỉ còn vài chục byte địa chỉ, còn
   * ảnh được trình duyệt cache lại.
   */
  url: string;
  /** Cỡ ảnh sau giải mã (byte) — trang quản trị hiện cho chủ shop biết. */
  bytes: number;
  sortOrder: number;
}

/** Một "loại" của sản phẩm — có giá và kho riêng. */
export interface ProductVariantDto {
  id: string;
  /**
   * Giá quy ra USDT — con số DẪN XUẤT, dùng cho mọi phép tính tiền (tổng đơn,
   * mã giảm giá, thống kê). Khi neo theo ₫ hoặc ¥ thì nó được tính lại mỗi lần
   * tỉ giá đổi, nên đừng coi nó là con số chủ shop đã gõ.
   */
  price: number;
  name: string;
  /** Đơn vị chủ shop đã gõ giá bằng — cái NEO. */
  priceCurrency: DisplayCurrency;
  /** Số tiền đúng như chủ shop đã gõ, theo `priceCurrency`. */
  priceAmount: number;
  sortOrder: number;
  active: boolean;
  availableStock: number;
  sold: number;
  /** Chỉ trả về ở trang quản trị. */
  translations?: VariantTranslations;
}

/**
 * Cách rút kho khi giữ chỗ cho đơn.
 *
 * `SEQUENTIAL` — cũ trước, đúng thứ tự nạp vào kho.
 * `RANDOM` — ngẫu nhiên; dùng khi mỗi key một khác (tài khoản còn số ngày ngẫu
 * nhiên), để khách mua sớm không vét hết phần đầu kho.
 */
export const STOCK_DRAW_MODES = ['SEQUENTIAL', 'RANDOM'] as const;
export type StockDrawMode = (typeof STOCK_DRAW_MODES)[number];

export interface ProductDto {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  description: string | null;
  currency: string;
  /** Giá thấp nhất / cao nhất trong các loại đang bán. */
  minPrice: number;
  maxPrice: number;
  /**
   * Địa chỉ ảnh bìa (bản lớn), hoặc `null` khi chưa có ảnh. Dùng thẳng làm `src`.
   * KHÔNG còn là data URI — xem chú thích ở `ProductImageDto.url`.
   */
  image: string | null;
  /** Địa chỉ bản thu nhỏ, cho thẻ sản phẩm và danh sách quản trị. */
  thumbnail: string | null;
  /** Cỡ ảnh bìa / ảnh nhỏ (byte). `null` = chưa có. */
  imageBytes: number | null;
  thumbnailBytes: number | null;
  /** Ảnh phụ, KHÔNG gồm ảnh bìa. Rỗng ở endpoint danh sách. */
  images: ProductImageDto[];
  category: string | null;
  sortOrder: number;
  active: boolean;
  /** Cách rút kho khi giữ chỗ — áp dụng cho mọi loại của sản phẩm. */
  stockDrawMode: StockDrawMode;
  /** Tổng tồn kho / đã bán của mọi loại. */
  availableStock: number;
  sold: number;
  variants: ProductVariantDto[];
  /** Chỉ trả về ở trang quản trị. */
  translations?: ProductTranslations;
  createdAt: string;
}

// ---------- Thông báo trang chủ ----------
export interface AnnouncementDto {
  active: boolean;
  title: string;
  body: string;
}

export interface AdminAnnouncementDto {
  active: boolean;
  /** Bản gốc tiếng Việt. */
  title: string;
  body: string;
  /** Bản dịch (khoá theo ngôn ngữ). */
  translations: Partial<Record<TranslatableLocale, { title: string; body: string }>>;
  updatedAt: string;
}

// ---------- Dịch tự động ----------
/**
 * Chuẩn giao thức của dịch vụ AI dùng để dịch.
 *
 * `openai` không có nghĩa là phải dùng OpenAI — gần như mọi nhà cung cấp khác
 * (OpenRouter, DeepSeek, Groq, Together, BytePlus Ark, Ollama chạy nội bộ…) đều
 * nói cùng giao thức `POST /chat/completions` này, nên chỉ cần đổi địa chỉ gốc.
 */
export const AI_PROVIDERS = ['anthropic', 'openai'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Model dùng khi chủ shop để trống ô model (chỉ có nghĩa với Anthropic). */
export const AI_DEFAULT_MODEL = 'claude-opus-5';

export interface TranslationStatusDto {
  /** Có khoá API dùng được hay không (trong cài đặt hoặc biến môi trường). */
  configured: boolean;
  /**
   * Khoá đang dùng lấy từ đâu — `null` khi chưa có.
   *
   * Cần thiết vì có HAI nguồn: ô trong trang cài đặt và biến môi trường
   * ANTHROPIC_API_KEY. Không nói rõ thì chủ shop thấy ô cài đặt trống mà chức
   * năng vẫn chạy (hoặc ngược lại) và không hiểu vì sao.
   */
  source: 'settings' | 'env' | null;
  provider: AiProvider;
  model: string;
}

// ---------- Cấu hình thanh toán ----------
/** Cấu hình cửa hàng ở trang quản trị. */
/** Một kênh liên hệ hỗ trợ, ví dụ { label: "Telegram", value: "@cattshop" }. */
export interface SupportChannelDto {
  /** Tên kênh hiển thị: Telegram, Zalo, Email, Facebook… */
  label: string;
  /** Nội dung liên hệ: tên tài khoản, số điện thoại, địa chỉ email… */
  value: string;
  /** Liên kết bấm được (tùy chọn) — http/https/mailto. */
  url?: string;
}

/** Số kênh hỗ trợ tối đa và độ dài từng ô — dùng chung cho web và API. */
export const SUPPORT_CHANNELS_MAX = 6;
export const SUPPORT_FIELD_MAX_LENGTH = 120;
export const SUPPORT_NOTE_MAX_LENGTH = 300;

export interface AdminStoreSettingDto {
  mockEnabled: boolean;
  /** Binance Pay MERCHANT — cần khoá BINANCE_PAY_* ở máy chủ. */
  binancePayEnabled: boolean;
  /** Binance Pay cá nhân: khách chuyển tới Binance ID bên dưới. */
  binanceIdEnabled: boolean;
  binanceId: string;
  /** Ảnh QR Binance Pay do chủ shop tải lên (data URI), rỗng = chưa có. */
  binanceQr: string;
  cryptoEnabled: boolean;
  bep20Address: string;
  trc20Address: string;
  /** SePay — nhận chuyển khoản ngân hàng VND. */
  sepayEnabled: boolean;
  sepayAccountNumber: string;
  sepayBank: string;
  sepayAccountHolder: string;
  /** Bao nhiêu VND cho 1 USDT; 0 = chưa cấu hình. */
  vndPerUsdt: number;
  /** Bao nhiêu CNY cho 1 USDT; 0 = không quy đổi. */
  cnyPerUsdt: number;
  /** Tự lấy tỉ giá mỗi ngày. */
  rateAuto: boolean;
  /** Phần trăm cộng thêm lên tỉ giá thị trường. */
  rateMarkupPercent: number;
  /** Giờ lấy tỉ giá mỗi ngày, theo giờ Việt Nam (0–23). */
  rateHour: number;
  /** Lần lấy tỉ giá thành công gần nhất (ISO), `null` = chưa lần nào. */
  rateUpdatedAt: string | null;
  /** Nguồn + giá trị thô lần gần nhất — để chủ shop soi lại. */
  rateSource: string;
  /**
   * Đã lưu khoá API webhook của SePay hay chưa — KHÔNG BAO GIỜ trả về chính khoá.
   */
  sepayApiKeySet: boolean;
  sepayApiKeyHint: string;
  /** Đã lưu khoá bí mật HMAC (tuỳ chọn) hay chưa. */
  sepayWebhookSecretSet: boolean;
  /** Chuẩn giao thức của dịch vụ AI dùng để dịch. */
  aiProvider: AiProvider;
  /** Địa chỉ gốc API; rỗng = dùng địa chỉ mặc định của nhà cung cấp. */
  aiBaseUrl: string;
  /** Tên model; rỗng = dùng AI_DEFAULT_MODEL. */
  aiModel: string;
  /**
   * Đã lưu khoá API trong cài đặt hay chưa.
   *
   * KHÔNG BAO GIỜ trả về chính khoá đó: trang quản trị chỉ cần biết có hay
   * không. Gửi khoá xuống trình duyệt là bất kỳ lỗi XSS nào cũng đọc được nó.
   */
  aiKeySet: boolean;
  /** Bốn ký tự cuối của khoá đã lưu, để chủ shop nhận ra mình dán khoá nào. */
  aiKeyHint: string;
  /** Bật kênh bán hàng qua bot Telegram. */
  telegramBotEnabled: boolean;
  /**
   * Đã lưu token bot hay chưa — KHÔNG BAO GIỜ trả về chính token: ai cầm token
   * là điều khiển được bot, đọc được mọi tin khách nhắn (kể cả key đã giao).
   */
  telegramBotTokenSet: boolean;
  /** Bốn ký tự cuối của token đã lưu, để chủ shop nhận ra mình dán token nào. */
  telegramBotTokenHint: string;
  /** Gửi kèm tin "Thông báo từ Admin" (hộp thông báo trang chủ) khi khách /start. */
  telegramSendAnnouncement: boolean;
  /** Lời chào tuỳ chỉnh của bot; rỗng = câu mặc định theo ngôn ngữ khách. */
  telegramGreeting: string;
  /** Các kênh liên hệ hiển thị ở khối "Quên mật khẩu". */
  supportChannels: SupportChannelDto[];
  /** Lời nhắn tùy chỉnh; rỗng = dùng câu mặc định theo ngôn ngữ. */
  supportNote: string;
}

/** Độ dài tối đa của lời chào bot tuỳ chỉnh. */
export const TELEGRAM_GREETING_MAX_LENGTH = 500;

// ---------- Bot Telegram: xem trước & trạng thái ----------

/** Một nút inline trong bản xem trước — text + callback y như bot gửi thật. */
export interface TelegramPreviewButton {
  text: string;
  callbackData: string;
}

/** Một tin nhắn bot đã dựng sẵn: text là HTML kiểu Telegram (chỉ b/i, entity đã escape). */
export interface TelegramMessagePreview {
  text: string;
  keyboard: TelegramPreviewButton[][];
}

/**
 * Bản xem trước cho trang /admin/telegram — dựng bằng CHÍNH module render của
 * bot, nên cái admin thấy là cái khách sẽ thấy, không phải bản chép tay.
 *
 * `screens` là BẢN ĐỒ MÀN HÌNH khoá theo callback_data: giả lập bấm nút nào
 * thì tra đúng khoá đó — không phải chép lại logic điều hướng của bot.
 */
export interface TelegramPreviewDto {
  /** Tin "Thông báo từ Admin"; null = tắt gửi kèm, hoặc hộp thông báo tắt/rỗng. */
  announcement: string | null;
  /** Khoá màn hình đầu tiên (hub). */
  entry: string;
  screens: Record<string, TelegramMessagePreview>;
}

export interface TelegramStatusDto {
  enabled: boolean;
  tokenSet: boolean;
  /** Vòng long-poll có đang chạy không (đã qua getMe). */
  running: boolean;
  /** @username của bot khi đã nối được; null = chưa/không chạy. */
  botUsername: string | null;
  /** Lỗi gần nhất đáng cho chủ shop biết (token bị từ chối/thu hồi); null = không có. */
  lastError: string | null;
}

/**
 * Quyền THẬT của khóa API — đọc từ `/sapi/v1/account/apiRestrictions`.
 * KHÔNG dùng `canWithdraw` của `/api/v3/account`: đó là trạng thái TÀI KHOẢN
 * (tài khoản được phép rút hay không), không phải quyền của khóa.
 */
export interface BinanceKeyPermissions {
  read: boolean;
  withdraw: boolean;
  trade: boolean;
  /** Khóa đã giới hạn theo IP hay chưa. */
  ipRestricted: boolean;
}

/** Trạng thái kết nối Binance (đọc số dư / lịch sử nạp). */
export interface BinanceStatusDto {
  /** Đã cấu hình BINANCE_API_KEY + BINANCE_SECRET_KEY chưa. */
  configured: boolean;
  /** Gọi thử API thành công chưa (null = chưa cấu hình). */
  connected: boolean | null;
  /** Số dư USDT khả dụng trong ví (null nếu không đọc được). */
  usdtBalance: number | null;
  /** Quyền của khóa; null nếu chưa cấu hình hoặc không đọc được. */
  permissions: BinanceKeyPermissions | null;
  /** Thông báo lỗi ngắn nếu gọi API thất bại. */
  error: string | null;
}

// ---------- Mã giảm giá ----------
/** Kết quả kiểm tra mã giảm giá trước khi đặt hàng. */
export interface CouponPreviewDto {
  code: string;
  type: DiscountType;
  value: number;
  /** Tiền hàng trước giảm. */
  subtotal: number;
  discountAmount: number;
  /** Số tiền phải trả sau khi giảm. */
  totalAmount: number;
}

export interface AdminCouponDto {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  minAmount: number;
  /** null = không giới hạn số lần dùng. */
  maxUses: number | null;
  usedCount: number;
  /** null = một khách dùng bao nhiêu lần cũng được. */
  perUserLimit: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  note: string | null;
  createdAt: string;
}

// ---------- Chống spam đăng ký ----------
/** Câu hỏi xác minh đơn giản khi đăng ký. */
export interface CaptchaDto {
  id: string;
  /** Ví dụ: "7 + 5 = ?" */
  question: string;
}

// ---------- Trang chính sách ----------
/**
 * Ba trang chính sách cố định. Bán hàng số thì tranh chấp "key không dùng
 * được" là chuyện thường ngày — có sẵn điều khoản và chính sách hoàn tiền thì
 * mọi tranh chấp đều quy về một văn bản, thay vì cãi nhau theo cảm tính.
 * Đường dẫn công khai: /legal/{slug}
 */
export const LEGAL_PAGE_SLUGS = ['terms', 'refund', 'privacy'] as const;
export type LegalPageSlug = (typeof LEGAL_PAGE_SLUGS)[number];

export function isLegalPageSlug(value: string): value is LegalPageSlug {
  return (LEGAL_PAGE_SLUGS as readonly string[]).includes(value);
}

export interface LegalPageDto {
  slug: LegalPageSlug;
  title: string;
  /** HTML đã lọc ở máy chủ. Rỗng = chủ shop chưa soạn nội dung. */
  body: string;
  updatedAt: string;
}

// ---------- Thông tin cửa hàng công khai ----------
export interface PublicStoreInfoDto {
  /** Kênh liên hệ hỗ trợ — hiện ở khối "Quên mật khẩu". Rỗng = chưa đặt. */
  supportChannels: SupportChannelDto[];
  /** Lời nhắn tùy chỉnh; rỗng = web dùng câu mặc định theo ngôn ngữ. */
  supportNote: string;
}

// ---------- Orders ----------
export interface OrderItemDto {
  id: string;
  productId: string;
  /** Slug để dẫn về trang sản phẩm ("Mua lại"). */
  productSlug: string;
  productName: string;
  /** Tên loại đã chọn (ảnh chụp lúc đặt hàng). Rỗng với đơn cũ. */
  variantName: string;
  unitPrice: number;
  quantity: number;
  /** Delivered stock lines — only present when the order is DELIVERED (or for admin views). */
  deliveredLines?: string[];
}

export interface PaymentInfoDto {
  mode: PaymentMode;
  status: PaymentStatus;
  /** Mã giao dịch phía cổng thanh toán — admin dùng đối soát trên Binance Merchant. */
  merchantTradeNo?: string;
  /** CRYPTO mode: mạng, địa chỉ ví nhận, và số USDT DUY NHẤT phải gửi. */
  cryptoNetwork?: CryptoNetwork;
  cryptoAddress?: string;
  /** BINANCE_ID mode: Binance ID nhận tiền, chụp lại lúc tạo đơn. */
  binanceId?: string;
  cryptoAmount?: number;
  /**
   * Mã QR của ĐỊA CHỈ VÍ, dạng data URI SVG (~1 KB).
   *
   * Chỉ chứa địa chỉ, KHÔNG chứa số tiền — chuẩn URI cho token được hỗ trợ rất
   * chắp vá nên quét xong khách vẫn phải tự nhập số tiền. Giao diện phải nói rõ.
   */
  cryptoQr?: string;
  /** TxID đã khớp (khi đã thanh toán). */
  cryptoTxId?: string;
  /**
   * SEPAY mode: nơi nhận tiền, CHỤP LẠI lúc tạo đơn.
   *
   * Không có tên chủ tài khoản ở đây: nó chỉ để hiển thị nên đọc từ
   * `PaymentMethodDto.accountHolder` (cấu hình hiện tại), khỏi chụp thêm một cột.
   */
  sepayAccountNumber?: string;
  sepayBank?: string;
  /** Số VND phải chuyển, đã chốt lúc tạo đơn. */
  vndAmount?: number;
  /** Địa chỉ ảnh VietQR do SePay dựng — đã kèm số tiền và nội dung chuyển. */
  sepayQrUrl?: string;
  /** Id giao dịch SePay đã khớp (khi đã thanh toán). */
  sepayRef?: string;
  /** MOCK mode: relative web path to the fake gateway, e.g. /mock-pay/DH-XXXXXX */
  mockPayUrl?: string;
  /** BINANCE mode fields */
  checkoutUrl?: string;
  qrcodeLink?: string;
  deeplink?: string;
  universalUrl?: string;
  prepayId?: string;
}

export interface OrderDetailDto {
  id: string;
  code: string;
  status: OrderStatus;
  /** Tiền hàng trước giảm giá. */
  subtotalAmount: number;
  /** Số tiền đã giảm (0 nếu không dùng mã). */
  discountAmount: number;
  /** Mã giảm giá đã dùng, null nếu không có. */
  couponCode: string | null;
  /** Số tiền phải trả = subtotalAmount - discountAmount. */
  totalAmount: number;
  currency: string;
  createdAt: string;
  expiresAt: string | null;
  paidAt: string | null;
  items: OrderItemDto[];
  payment: PaymentInfoDto | null;
}

export interface OrderSummaryDto {
  code: string;
  status: OrderStatus;
  totalAmount: number;
  currency: string;
  createdAt: string;
  itemsCount: number;
  firstProductName: string;
  /** Only present in admin listing. null = khách Telegram (không có email). */
  userEmail?: string | null;
  /** Only present in admin listing */
  userCode?: number;
}

/** Chi tiết đơn hàng ở trang quản trị — kèm thông tin khách hàng. */
export interface AdminOrderDetailDto extends OrderDetailDto {
  userId: string;
  /** null = khách Telegram (không có email). */
  userEmail: string | null;
  userCode: number;
}

export interface CreateOrderResponse {
  order: OrderDetailDto;
  payment: PaymentInfoDto;
}

export interface CheckPaymentDto {
  status: OrderStatus;
  delivered: boolean;
}

// ---------- Admin ----------
export interface AdminStatsDto {
  revenue: number;
  ordersTotal: number;
  ordersPending: number;
  ordersToday: number;
  productsActive: number;
  /** Tổng số khách (role USER) và khách mới trong 30 ngày. */
  customersTotal: number;
  customersNew30d: number;
  /** Top sản phẩm theo doanh thu 30 ngày gần nhất (đơn PAID/DELIVERED). */
  topProducts: {
    productId: string;
    name: string;
    sold: number;
    revenue: number;
  }[];
  lowStock: {
    productId: string;
    variantId: string;
    name: string;
    variantName: string;
    availableStock: number;
  }[];
  /** Những thứ đang CHẶN việc bán hàng — hiện cảnh báo ngay ở trang tổng quan. */
  readiness: StoreReadinessDto;
}

/**
 * Vì sao cần: cửa hàng cài mới chưa bật phương thức thanh toán nào, giao diện
 * trông vẫn bình thường nhưng mọi lần khách bấm đặt hàng đều lỗi 503. Chủ shop
 * chỉ phát hiện khi khách phàn nàn — hoặc không bao giờ, vì khách bỏ đi luôn.
 */
export interface StoreReadinessDto {
  /** Phương thức thanh toán THỰC SỰ dùng được (đã bật + đủ cấu hình). */
  activePaymentMethods: PaymentMethod[];
  /** Bật Binance Pay merchant trong cài đặt nhưng máy chủ thiếu BINANCE_PAY_API_KEY. */
  binancePayKeyMissing: boolean;
  /** Bật chuyển tới Binance ID nhưng chưa điền ID. */
  binanceIdMissing: boolean;
  /**
   * Bật SePay nhưng thiếu một trong: số tài khoản, ngân hàng, tỉ giá, khoá API.
   *
   * Thiếu khoá API là nặng nhất: khách chuyển tiền xong, webhook tới nhưng bị
   * từ chối vì không có gì để đối chiếu, và đơn treo tới lúc hết hạn.
   */
  sepayIncomplete: boolean;
  /**
   * Đã bật chuyển tới Binance ID nhưng máy chủ thiếu BINANCE_API_KEY.
   *
   * Khách vẫn chuyển được tiền, nhưng KHÔNG có gì đối soát: đơn treo mãi ở
   * PENDING và chủ shop phải tự đánh dấu đã thanh toán từng đơn.
   */
  binanceIdNoReconcile: boolean;
  /** Đang chạy cổng thanh toán giả lập — tuyệt đối không để bật khi bán thật. */
  mockActive: boolean;
  /** Tổng số key/tài khoản còn trong kho của các loại đang bán. */
  stockAvailable: number;
  /**
   * Bật bot Telegram nhưng chưa lưu token — bot không chạy được (fail-closed),
   * và không có dòng này thì chủ shop tưởng đã bật xong.
   */
  telegramIncomplete: boolean;
  /**
   * Chưa cấu hình kênh liên hệ nào.
   *
   * Cửa hàng KHÔNG gửi email tự động, nên "quên mật khẩu" chỉ giải quyết được
   * bằng cách khách nhắn cho chủ shop. Không có kênh liên hệ thì trang đăng nhập
   * bảo khách "liên hệ quản trị viên" mà không nói liên hệ ở đâu — khách mất mật
   * khẩu là mất luôn tài khoản và mọi key đã mua.
   */
  supportChannelsMissing: boolean;
}

// ---------- Thống kê hành vi khách ----------

/**
 * Một sản phẩm trong bảng "xem so với mua".
 *
 * `conversion` mới là con số hành động được: xem nhiều mà mua ít thường là giá
 * sai hoặc mô tả chưa thuyết phục. Lượt xem trơ trọi gần như không dùng để
 * quyết định gì.
 */
export interface ProductInsightDto {
  productId: string;
  name: string;
  slug: string;
  views: number;
  sold: number;
  /** sold / views, 0..1. Bằng null khi chưa có lượt xem nào (chia cho 0). */
  conversion: number | null;
}

/** Một từ khoá khách đã gõ ở ô tìm kiếm. */
export interface SearchInsightDto {
  term: string;
  count: number;
  /** Số lần từ khoá này không ra kết quả nào — khách đang tìm thứ shop chưa có. */
  zeroResults: number;
}

export interface StoreInsightsDto {
  /** Số ngày dữ liệu được gộp lại. */
  days: number;
  products: ProductInsightDto[];
  /** Từ khoá được tìm nhiều nhất. */
  topSearches: SearchInsightDto[];
  /** Từ khoá KHÔNG ra kết quả — gợi ý nên nhập hàng gì tiếp. */
  zeroResultSearches: SearchInsightDto[];
}

/** Một ngày trong biểu đồ doanh thu. `date` dạng YYYY-MM-DD (múi giờ máy chủ). */
export interface RevenuePointDto {
  date: string;
  revenue: number;
  orders: number;
}

// ---------- Quản lý khách hàng ----------
export interface AdminCustomerDto {
  id: string;
  code: number;
  /** null = khách đến từ bot Telegram — hiển thị bằng telegramName + mã số. */
  email: string | null;
  /** Tên hiển thị Telegram lúc gặp gần nhất; rỗng với khách web. */
  telegramName: string;
  /** Số dư ví (USDT) — nạp/tiêu qua bot Telegram. */
  balance: number;
  role: Role;
  /** Khác null = đang bị khóa. */
  lockedAt: string | null;
  createdAt: string;
  ordersCount: number;
  /** Tổng chi tiêu (đơn PAID + DELIVERED), đơn vị USDT. */
  totalSpent: number;
}

/** Kết quả đặt lại mật khẩu — mật khẩu mới chỉ hiện MỘT lần cho admin chép lại. */
export interface AdminResetPasswordDto {
  password: string;
}

// ---------- Nhật ký thao tác ----------
/** Khoá hành động ghi trong nhật ký — web dịch nhãn theo ngôn ngữ. */
export const AUDIT_ACTIONS = [
  'product.create',
  'product.update',
  'product.delete',
  'product.translate',
  'product.image.add',
  'product.image.delete',
  'product.image.reorder',
  'variant.create',
  'variant.update',
  'variant.delete',
  'stock.add',
  'stock.delete',
  'stock.withdraw',
  'stock.restore',
  'order.redeliver',
  'order.cancel',
  'order.mark_paid',
  'announcement.update',
  'announcement.translate',
  'customer.lock',
  'customer.unlock',
  'admin.grant',
  'admin.revoke',
  'settings.update',
  'legal.update',
  'customer.reset_password',
  'coupon.create',
  'coupon.update',
  'coupon.delete',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditLogDto {
  id: string;
  actorEmail: string;
  actorCode: number;
  action: AuditAction;
  entityType: string | null;
  entityId: string | null;
  /** Chi tiết ngắn (name, from/to...) — web hiển thị phần phù hợp. */
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface StockItemDto {
  id: string;
  content: string;
  status: StockStatus;
  createdAt: string;
  soldAt: string | null;
  /** Lúc chủ shop rút dòng này ra khỏi kho; `null` nếu chưa rút. */
  withdrawnAt: string | null;
  orderCode: string | null;
  variantId: string;
  variantName: string;
}

/** Một dòng vừa được rút ra khỏi kho — đủ để chủ shop sao chép lại. */
export interface WithdrawnStockLineDto {
  id: string;
  content: string;
}

export interface WithdrawStockResponse {
  /** Nội dung các dòng vừa rút, theo đúng thứ tự rút. */
  lines: WithdrawnStockLineDto[];
  /** Số dòng thực sự rút được — có thể ÍT HƠN yêu cầu nếu kho không đủ. */
  withdrawn: number;
  /** Số dòng còn bán được sau khi rút. */
  remaining: number;
}

export interface AddStockResponse {
  added: number;
  skipped: number;
  total: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

// ---------- UI labels (Vietnamese) ----------
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Chờ thanh toán',
  PAID: 'Đã thanh toán',
  DELIVERED: 'Đã giao hàng',
  CANCELLED: 'Đã hủy',
  EXPIRED: 'Hết hạn',
};

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  AVAILABLE: 'Còn hàng',
  RESERVED: 'Đang giữ',
  SOLD: 'Đã bán',
  WITHDRAWN: 'Đã rút',
};

// ---------- Helpers ----------
/* ---------- Tiền hiển thị theo ngôn ngữ ---------- */

/**
 * Đơn vị tiền hiện cho khách, chọn theo ngôn ngữ đang xem.
 *
 * Giá gốc LUÔN là USDT — đây chỉ là lớp quy đổi để hiển thị. Số tiền thật sự
 * thu vẫn là USDT (crypto/Binance) hoặc VND (chuyển khoản qua SePay).
 */
export const DISPLAY_CURRENCIES = ['USDT', 'VND', 'CNY', 'USD'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];


/** Tỉ giá cửa hàng đang dùng, trả về cho trang khách. */
export interface StoreRatesDto {
  /** VND cho 1 USDT; 0 = chưa có, giao diện hiện USDT như cũ. */
  vndPerUsdt: number;
  /** CNY cho 1 USDT; 0 = chưa có. */
  cnyPerUsdt: number;
  updatedAt: string | null;
}

/**
 * Đổi USDT sang đơn vị hiển thị. `null` = không đổi được, hãy hiện USDT.
 *
 * USD coi như 1:1 với USDT: USDT là stablecoin neo vào đô, và cửa hàng cũng
 * niêm yết theo đô. Thêm một tỉ giá USD riêng chỉ tạo ra hai con số lệch nhau
 * vài phần nghìn mà chẳng ai cần.
 */
export function convertFromUsdt(
  usdt: number,
  currency: DisplayCurrency,
  rates: StoreRatesDto | null,
): number | null {
  if (currency === 'USDT' || currency === 'USD') return usdt;
  if (!rates) return null;
  const rate = currency === 'VND' ? rates.vndPerUsdt : rates.cnyPerUsdt;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return usdt * rate;
}

/**
 * Đổi một số tiền ở đơn vị bất kỳ NGƯỢC về USDT. `null` = không đổi được.
 *
 * Là nghịch đảo của `convertFromUsdt`, dùng khi chủ shop gõ giá bằng ₫ / ¥ và
 * hệ thống phải suy ra con số USDT để tính tiền.
 */
export function toUsdtFromCurrency(
  amount: number,
  currency: DisplayCurrency,
  rates: StoreRatesDto | null,
): number | null {
  if (currency === 'USDT' || currency === 'USD') return amount;
  if (!rates) return null;
  const rate = currency === 'VND' ? rates.vndPerUsdt : rates.cnyPerUsdt;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return amount / rate;
}

/**
 * Số chữ số thập phân của cột giá USDT trong CSDL.
 *
 * SÁU, không phải hai. Với hai chữ số thì hai mức giá kề nhau cách nhau 0,01
 * USDT ≈ 260 ₫, nên phần lớn số tròn bằng đồng (100.000) không nằm trên lưới đó
 * và khách luôn thấy một con số lệch vài chục đồng. Sáu chữ số thu khoảng cách
 * đó về ~0,026 ₫ — nhỏ hơn một đồng, nên số ₫ quy ngược lại về đúng số đã gõ.
 */
export const USDT_DECIMALS = 6;

/**
 * Làm tròn XUỐNG số USDT về đúng độ chính xác của cột giá.
 *
 * Phải là làm tròn xuống: số ₫ hiển thị được tính bằng `Math.ceil` (xem
 * `formatMoney`), nên nếu USDT bị làm tròn LÊN thì quy ngược lại vượt quá số đã
 * gõ và khách thấy 100.001 ₫ thay vì 100.000.
 */
export function floorUsdt(usdt: number): number {
  const f = 10 ** USDT_DECIMALS;
  return Math.floor(usdt * f) / f;
}

/**
 * Làm tròn số USDT về đúng độ chính xác của cột giá, chỉ để dập rác nhị phân.
 *
 * Khác `sumMoney` (hai chữ số): hai chữ số phá giá neo theo ₫ — 3.852198 thành
 * 3.85 rồi quy sang ₫ ra 99.943 thay vì 100.000. `sumMoney` vẫn đúng cho thống
 * kê doanh thu, nhưng KHÔNG dùng được cho tổng của một đơn.
 */
export function roundUsdt(usdt: number): number {
  const f = 10 ** USDT_DECIMALS;
  return Math.round(usdt * f) / f;
}

/** Giá của một loại hàng, đủ thông tin để hiện đúng con số chủ shop đã gõ. */
export interface AnchoredPrice {
  price: number;
  priceCurrency: DisplayCurrency;
  priceAmount: number;
}

/**
 * Số tiền hiện cho khách đang xem bằng `viewer`.
 *
 * Khách xem đúng đơn vị đã neo ⇒ trả về NGUYÊN số chủ shop đã gõ, không quy đổi
 * gì. Đó là toàn bộ điểm của việc neo: gõ 100.000 ₫ thì khách Việt thấy đúng
 * 100.000 ₫ hôm nay và cả tháng sau, dù tỉ giá đã trôi.
 *
 * Khách xem đơn vị khác ⇒ quy đổi từ USDT như trước, và con số đó tất nhiên
 * không tròn — không có cách nào một con số tròn ở hai đơn vị cùng lúc.
 */
export function displayPriceAmount(
  p: AnchoredPrice,
  viewer: DisplayCurrency,
  rates: StoreRatesDto | null,
): { amount: number; currency: DisplayCurrency } {
  if (viewer === p.priceCurrency) {
    return { amount: p.priceAmount, currency: viewer };
  }
  const doi = convertFromUsdt(p.price, viewer, rates);
  if (doi === null) {
    // Không có tỉ giá cho đơn vị khách xem ⇒ lùi về USDT, không bịa số.
    return { amount: p.price, currency: 'USDT' };
  }
  return { amount: doi, currency: viewer };
}

/**
 * Neo của loại hàng RẺ NHẤT đang bán — giá hiện trên thẻ sản phẩm.
 *
 * Chọn theo USDT vì đó là đơn vị tính tiền chung; nếu các loại neo khác đơn vị
 * nhau thì "rẻ nhất theo USDT" có thể không phải "rẻ nhất theo ₫", nhưng lệch đó
 * chỉ xảy ra khi hai loại gần bằng giá và vẫn hiện đúng giá của một loại thật.
 *
 * `null` = sản phẩm không có loại nào đang bán ⇒ gọi phải tự lùi về `minPrice`.
 */
export function cheapestAnchored(
  variants: readonly AnchoredPrice[] & readonly { active: boolean }[],
): AnchoredPrice | null {
  let re: (AnchoredPrice & { active: boolean }) | null = null;
  for (const v of variants) {
    if (!v.active) continue;
    if (re === null || v.price < re.price) re = v;
  }
  return re;
}

/**
 * Định dạng một số tiền theo đơn vị của nó.
 *
 * VND không có phần lẻ (ngân hàng không chuyển được nhỏ hơn đồng) và làm tròn
 * LÊN, khớp với cách tính số tiền chuyển khoản ở `usdtToVnd` — hai chỗ lệch nhau
 * là khách thấy một số trên thẻ sản phẩm và bị đòi số khác ở trang thanh toán.
 */
export function formatMoney(amount: number, currency: DisplayCurrency): string {
  if (currency === 'VND') {
    return `${Math.ceil(amount).toLocaleString('vi-VN')} ₫`;
  }
  if (currency === 'CNY') {
    return `¥${amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (currency === 'USD') {
    return `$${amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return formatUsdt(amount);
}

export function formatUsdt(amount: number): string {
  return `${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDT`;
}

/**
 * Cộng dồn tiền rồi làm tròn về 2 chữ số.
 *
 * Cộng số thực trong JavaScript sinh rác nhị phân: bảy giá trị doanh thu đã
 * làm tròn cộng lại từng ra `94.46000000000001`. Con số đó rò ra phần trăm
 * tăng trưởng và các phép so sánh, nên mọi chỗ cộng tiền ở giao diện đều đi
 * qua hàm này.
 */
export function sumMoney(values: readonly number[]): number {
  const total = values.reduce((acc, value) => acc + value, 0);
  return Math.round(total * 100) / 100;
}

/** Hiển thị mã khách hàng thống nhất toàn hệ thống: 100001 → "#100001". */
export function formatUserCode(code: number): string {
  return `#${code}`;
}

export const LOW_STOCK_THRESHOLD = 5;

/** Số ký tự tối thiểu của mật khẩu — dùng chung cho cả kiểm tra ở web và API. */
export const PASSWORD_MIN_LENGTH = 8;

/** Độ dài mã giảm giá tối đa (chữ HOA, số, gạch ngang). */
export const COUPON_CODE_MAX_LENGTH = 32;

/**
 * Tính số tiền được giảm — dùng chung để web xem trước và API tính thật,
 * đảm bảo hai bên luôn ra cùng một con số. Làm tròn xuống 2 chữ số thập phân
 * và không bao giờ vượt quá tiền hàng.
 */
export function calcDiscount(
  subtotal: number,
  type: DiscountType,
  value: number,
): number {
  const raw = type === 'PERCENT' ? (subtotal * value) / 100 : value;
  const capped = Math.min(Math.max(raw, 0), subtotal);
  return Math.floor(capped * 100) / 100;
}
