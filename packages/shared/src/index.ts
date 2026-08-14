// ===== Shared types & constants between @webcatt/api and @webcatt/web =====

export type Role = 'USER' | 'ADMIN' | 'SUPERADMIN';

/** ADMIN và SUPERADMIN đều vào được trang quản trị. */
export function isAdminRole(role: Role): boolean {
  return role === 'ADMIN' || role === 'SUPERADMIN';
}
export type OrderStatus = 'PENDING' | 'PAID' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
export type StockStatus = 'AVAILABLE' | 'RESERVED' | 'SOLD';
export type PaymentMode = 'MOCK' | 'BINANCE' | 'CRYPTO';

/** Phương thức thanh toán khách chọn ở trang thanh toán. */
export type PaymentMethod =
  | 'mock'
  | 'binance_pay'
  | 'crypto_bep20'
  | 'crypto_trc20';

/** Mạng blockchain cho USDT on-chain. */
export type CryptoNetwork = 'BEP20' | 'TRC20';

/** Kiểu giảm giá: theo phần trăm hoặc số tiền cố định. */
export type DiscountType = 'PERCENT' | 'FIXED';


export interface PaymentMethodDto {
  method: PaymentMethod;
  /** Địa chỉ ví nhận — chỉ có với crypto_bep20 / crypto_trc20. */
  address?: string;
}

// ---------- Auth ----------
export interface PublicUser {
  id: string;
  /** Mã khách hàng dạng số (bắt đầu từ 100000) — dùng để tra cứu/hỗ trợ */
  code: number;
  email: string;
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
/** Một "loại" của sản phẩm — có giá và kho riêng. */
export interface ProductVariantDto {
  id: string;
  name: string;
  price: number;
  sortOrder: number;
  active: boolean;
  availableStock: number;
  sold: number;
  /** Chỉ trả về ở trang quản trị. */
  translations?: VariantTranslations;
}

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
  image: string | null;
  icon: string | null;
  category: string | null;
  sortOrder: number;
  active: boolean;
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
export interface TranslationStatusDto {
  /** Máy chủ đã cấu hình ANTHROPIC_API_KEY hay chưa. */
  configured: boolean;
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
  binancePayEnabled: boolean;
  cryptoEnabled: boolean;
  bep20Address: string;
  trc20Address: string;
  /** Các kênh liên hệ hiển thị ở khối "Quên mật khẩu". */
  supportChannels: SupportChannelDto[];
  /** Lời nhắn tùy chỉnh; rỗng = dùng câu mặc định theo ngôn ngữ. */
  supportNote: string;
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
  cryptoAmount?: number;
  /** TxID đã khớp (khi đã thanh toán). */
  cryptoTxId?: string;
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
  /** Only present in admin listing */
  userEmail?: string;
  /** Only present in admin listing */
  userCode?: number;
}

/** Chi tiết đơn hàng ở trang quản trị — kèm thông tin khách hàng. */
export interface AdminOrderDetailDto extends OrderDetailDto {
  userId: string;
  userEmail: string;
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
  /** Bật Binance Pay trong cài đặt nhưng máy chủ thiếu BINANCE_PAY_API_KEY. */
  binancePayKeyMissing: boolean;
  /** Đang chạy cổng thanh toán giả lập — tuyệt đối không để bật khi bán thật. */
  mockActive: boolean;
  /** Tổng số key/tài khoản còn trong kho của các loại đang bán. */
  stockAvailable: number;
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
  email: string;
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
  'variant.create',
  'variant.update',
  'variant.delete',
  'stock.add',
  'stock.delete',
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
  orderCode: string | null;
  variantId: string;
  variantName: string;
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
};

// ---------- Helpers ----------
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
