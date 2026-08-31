import { DEFAULT_LOCALE, type Locale } from './locale';

export type MessageParams = Record<string, string | number>;
type Template = string | ((params: MessageParams) => string);

/**
 * Khoá thông báo. Service/DTO ném ra KHOÁ, bộ lọc ngoại lệ dịch sang ngôn ngữ
 * người dùng (theo header Accept-Language) trước khi trả về.
 */
export const K = {
  // --- auth ---
  emailInvalid: 'auth.email_invalid',
  passwordInvalid: 'auth.password_invalid',
  passwordMin: 'auth.password_min',
  passwordRequired: 'auth.password_required',
  confirmRequired: 'auth.confirm_required',
  confirmMismatch: 'auth.confirm_mismatch',
  emailTaken: 'auth.email_taken',
  invalidCredentials: 'auth.invalid_credentials',
  loginRequired: 'auth.login_required',
  sessionInvalid: 'auth.session_invalid',
  forbidden: 'auth.forbidden',
  accountLocked: 'auth.account_locked',
  currentPasswordWrong: 'auth.current_password_wrong',

  // --- chống spam đăng ký ---
  captchaRequired: 'auth.captcha_required',
  captchaInvalid: 'auth.captcha_invalid',
  tooManyRegisters: 'auth.too_many_registers',
  tooManyLogins: 'auth.too_many_logins',
  tooManyRequests: 'auth.too_many_requests',

  // --- thống kê hành vi khách ---
  analyticsPayloadInvalid: 'analytics.payload_invalid',

  // --- mã giảm giá ---
  couponCodeRequired: 'coupon.code_required',
  couponCodeInvalid: 'coupon.code_invalid',
  couponNotFound: 'coupon.not_found',
  couponInactive: 'coupon.inactive',
  couponNotStarted: 'coupon.not_started',
  couponExpired: 'coupon.expired',
  couponExhausted: 'coupon.exhausted',
  couponUserLimit: 'coupon.user_limit',
  couponMinAmount: 'coupon.min_amount',
  couponCodeTaken: 'coupon.code_taken',
  couponTypeInvalid: 'coupon.type_invalid',
  couponValueInvalid: 'coupon.value_invalid',
  couponPercentRange: 'coupon.percent_range',
  couponNumberInvalid: 'coupon.number_invalid',
  couponDateInvalid: 'coupon.date_invalid',
  couponNoteInvalid: 'coupon.note_invalid',
  couponNotFoundAdmin: 'coupon.admin_not_found',

  // --- products ---
  productNotFound: 'product.not_found',
  variantNotFound: 'product.variant_not_found',

  // --- orders ---
  orderVariantIdInvalid: 'order.variant_id_invalid',
  orderVariantIdRequired: 'order.variant_id_required',
  orderQuantityInt: 'order.quantity_int',
  orderQuantityMin: 'order.quantity_min',
  orderItemsInvalid: 'order.items_invalid',
  orderItemsMin: 'order.items_min',
  orderNotFound: 'order.not_found',
  orderCannotCancel: 'order.cannot_cancel',
  orderInsufficientStock: 'order.insufficient_stock',
  orderCodeFailed: 'order.code_generate_failed',

  // --- payments ---
  paymentSessionFailed: 'payment.session_failed',
  paymentSessionMissing: 'payment.session_missing',
  paymentMockDisabled: 'payment.mock_disabled',
  paymentWebhookDisabled: 'payment.webhook_disabled',
  paymentInvalidSignature: 'payment.invalid_signature',
  paymentCodeInvalid: 'payment.code_invalid',
  paymentCodeRequired: 'payment.code_required',
  binanceNotConfigured: 'payment.binance_not_configured',
  binanceHttpError: 'payment.binance_http_error',
  binanceRejected: 'payment.binance_rejected',
  binanceCertFailed: 'payment.binance_cert_failed',

  // --- payments: chọn phương thức & crypto on-chain ---
  paymentMethodInvalid: 'payment.method_invalid',
  paymentMethodUnavailable: 'payment.method_unavailable',
  paymentSepayNotReady: 'payment.sepay_not_ready',
  paymentNoMethodConfigured: 'payment.no_method_configured',
  paymentCryptoAmountUnavailable: 'payment.crypto_amount_unavailable',
  paymentTxIdInvalid: 'payment.txid_invalid',
  paymentTxIdRequired: 'payment.txid_required',
  paymentTxNotFound: 'payment.tx_not_found',
  paymentTxNetworkMismatch: 'payment.tx_network_mismatch',
  paymentTxAmountMismatch: 'payment.tx_amount_mismatch',
  paymentTxAlreadyUsed: 'payment.tx_already_used',

  // --- admin: product form ---
  adminNameInvalid: 'admin.name_invalid',
  adminNameRequired: 'admin.name_required',
  adminPriceNumber: 'admin.price_number',
  adminPriceCurrencyInvalid: 'admin.price_currency_invalid',
  adminPriceAnchorNoRate: 'admin.price_anchor_no_rate',
  adminPriceMin: 'admin.price_min',
  adminSlugInvalid: 'admin.slug_invalid',
  adminShortDescriptionInvalid: 'admin.short_description_invalid',
  adminDescriptionInvalid: 'admin.description_invalid',
  adminImageInvalid: 'admin.image_invalid',
  adminImageTooLarge: 'admin.image_too_large',
  adminThumbnailInvalid: 'admin.thumbnail_invalid',
  adminThumbnailTooLarge: 'admin.thumbnail_too_large',
  adminImageDataRequired: 'admin.image_data_required',
  adminImageTooMany: 'admin.image_too_many',
  adminImageNotFound: 'admin.image_not_found',
  adminImageOrderMismatch: 'admin.image_order_mismatch',
  adminCategoryInvalid: 'admin.category_invalid',
  adminSortOrderInt: 'admin.sort_order_int',
  adminActiveInvalid: 'admin.active_invalid',
  adminStockDrawModeInvalid: 'admin.stock_draw_mode_invalid',
  adminWithdrawQuantityInvalid: 'admin.withdraw_quantity_invalid',
  adminWithdrawTooMany: 'admin.withdraw_too_many',
  adminWithdrawNoStock: 'admin.withdraw_no_stock',
  adminStockNotWithdrawn: 'admin.stock_not_withdrawn',
  adminSlugFailed: 'admin.slug_generate_failed',
  adminSlugExists: 'admin.slug_exists',
  adminProductHasOrders: 'admin.product_has_orders',

  // --- admin: loại sản phẩm (variant) ---
  adminVariantNameInvalid: 'admin.variant_name_invalid',
  adminVariantNameRequired: 'admin.variant_name_required',
  adminVariantHasOrders: 'admin.variant_has_orders',
  adminVariantLast: 'admin.variant_last',

  // --- admin: thông báo trang chủ ---
  adminAnnouncementActiveInvalid: 'admin.announcement_active_invalid',
  adminAnnouncementTitleInvalid: 'admin.announcement_title_invalid',
  adminAnnouncementBodyInvalid: 'admin.announcement_body_invalid',
  adminAnnouncementTranslationsInvalid: 'admin.announcement_translations_invalid',
  adminAnnouncementEmpty: 'admin.announcement_empty',

  // --- admin: dịch tự động ---
  adminTranslationNotConfigured: 'admin.translation_not_configured',
  adminTranslationFailed: 'admin.translation_failed',
  adminTranslationRefused: 'admin.translation_refused',

  // --- admin: stock ---
  adminStockContentInvalid: 'admin.stock_content_invalid',
  adminStockContentRequired: 'admin.stock_content_required',
  adminStockDedupeInvalid: 'admin.stock_dedupe_invalid',
  adminStockMinOneLine: 'admin.stock_min_one_line',
  adminStockStatusInvalid: 'admin.stock_status_invalid',
  adminStockLineNotFound: 'admin.stock_line_not_found',
  adminStockOnlyAvailableDeletable: 'admin.stock_only_available_deletable',

  // --- admin: queries / orders ---
  adminPageInvalid: 'admin.page_invalid',
  adminLimitInvalid: 'admin.limit_invalid',
  adminOrderStatusInvalid: 'admin.order_status_invalid',
  adminSearchInvalid: 'admin.search_invalid',
  adminOnlyPaidRedeliver: 'admin.order_only_paid_redeliver',
  adminUserIdInvalid: 'admin.user_id_invalid',

  // --- admin: khách hàng & phân quyền ---
  superadminRequired: 'admin.superadmin_required',
  customerNotFound: 'admin.customer_not_found',
  cannotLockSelf: 'admin.cannot_lock_self',
  cannotLockAdmin: 'admin.cannot_lock_admin',
  cannotModifySuperadmin: 'admin.cannot_modify_superadmin',
  alreadyAdmin: 'admin.already_admin',
  notAdmin: 'admin.not_admin',
  cannotGrantLocked: 'admin.cannot_grant_locked',

  // --- admin: nhật ký & thống kê ---
  auditActionInvalid: 'admin.audit_action_invalid',
  seriesDaysInvalid: 'admin.series_days_invalid',

  // --- admin: cấu hình cửa hàng ---
  adminSettingsFlagInvalid: 'admin.settings_flag_invalid',
  adminBinanceIdInvalid: 'admin.binance_id_invalid',
  adminBinanceIdRequired: 'admin.binance_id_required',
  adminSepayAccountInvalid: 'admin.sepay_account_invalid',
  adminSepayBankInvalid: 'admin.sepay_bank_invalid',
  adminSepayHolderInvalid: 'admin.sepay_holder_invalid',
  adminSepayApiKeyInvalid: 'admin.sepay_api_key_invalid',
  adminSepayIncomplete: 'admin.sepay_incomplete',
  adminTelegramTokenRequired: 'admin.telegram_token_required',
  adminTelegramTokenInvalid: 'admin.telegram_token_invalid',
  adminTelegramGreetingTooLong: 'admin.telegram_greeting_too_long',
  depositAmountInvalid: 'deposit.amount_invalid',
  depositPendingLimit: 'deposit.pending_limit',
  balanceInsufficient: 'balance.insufficient',
  balanceOrderNotPending: 'balance.order_not_pending',
  adminVndRateInvalid: 'admin.vnd_rate_invalid',
  adminCnyRateInvalid: 'admin.cny_rate_invalid',
  adminRateMarkupInvalid: 'admin.rate_markup_invalid',
  adminRateHourInvalid: 'admin.rate_hour_invalid',
  adminRateFetchFailed: 'admin.rate_fetch_failed',
  adminAiKeyInvalid: 'admin.ai_key_invalid',
  adminAiProviderInvalid: 'admin.ai_provider_invalid',
  adminAiBaseUrlInvalid: 'admin.ai_base_url_invalid',
  adminAiModelInvalid: 'admin.ai_model_invalid',
  adminAiModelRequired: 'admin.ai_model_required',
  adminSettingsAddressInvalid: 'admin.settings_address_invalid',
  adminCryptoAddressRequired: 'admin.crypto_address_required',
  adminBep20AddressInvalid: 'admin.bep20_address_invalid',
  adminTrc20AddressInvalid: 'admin.trc20_address_invalid',
  adminCannotMarkPaid: 'admin.cannot_mark_paid',
  adminMarkPaidNoteInvalid: 'admin.mark_paid_note_invalid',
  adminSupportContactInvalid: 'admin.support_contact_invalid',
  adminSupportUrlInvalid: 'admin.support_url_invalid',
  adminSupportNoteInvalid: 'admin.support_note_invalid',
  adminSupportTooMany: 'admin.support_too_many',
  cannotResetSelf: 'admin.cannot_reset_self',

  // --- trang chính sách ---
  legalSlugInvalid: 'legal.slug_invalid',
  legalTitleInvalid: 'legal.title_invalid',
  legalBodyInvalid: 'legal.body_invalid',

  // --- misc ---
  databaseDown: 'health.database_down',
  internalError: 'common.internal_error',
} as const;

const MESSAGES: Record<string, Record<Locale, Template>> = {
  // --- auth ---
  [K.emailInvalid]: {
    vi: 'Email không hợp lệ',
    en: 'Invalid email address',
    zh: '邮箱格式不正确',
  },
  [K.passwordInvalid]: {
    vi: 'Mật khẩu không hợp lệ',
    en: 'Invalid password',
    zh: '密码无效',
  },
  [K.passwordMin]: {
    vi: (p) => `Mật khẩu phải có ít nhất ${p.min} ký tự`,
    en: (p) => `Password must be at least ${p.min} characters`,
    zh: (p) => `密码至少需要 ${p.min} 个字符`,
  },
  [K.passwordRequired]: {
    vi: 'Vui lòng nhập mật khẩu',
    en: 'Please enter your password',
    zh: '请输入密码',
  },
  [K.confirmRequired]: {
    vi: 'Vui lòng xác nhận mật khẩu',
    en: 'Please confirm your password',
    zh: '请确认密码',
  },
  [K.confirmMismatch]: {
    vi: 'Mật khẩu xác nhận không khớp',
    en: 'Passwords do not match',
    zh: '两次输入的密码不一致',
  },
  [K.emailTaken]: {
    vi: 'Email đã được đăng ký',
    en: 'This email is already registered',
    zh: '该邮箱已被注册',
  },
  [K.invalidCredentials]: {
    vi: 'Email hoặc mật khẩu không đúng',
    en: 'Incorrect email or password',
    zh: '邮箱或密码不正确',
  },
  [K.loginRequired]: {
    vi: 'Vui lòng đăng nhập để tiếp tục',
    en: 'Please sign in to continue',
    zh: '请先登录',
  },
  [K.sessionInvalid]: {
    vi: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn',
    en: 'Your session is invalid or has expired',
    zh: '登录状态无效或已过期',
  },
  [K.forbidden]: {
    vi: 'Bạn không có quyền truy cập khu vực này',
    en: 'You do not have permission to access this area',
    zh: '您没有访问该区域的权限',
  },
  [K.accountLocked]: {
    vi: 'Tài khoản của bạn đã bị khóa',
    en: 'Your account has been locked',
    zh: '您的账户已被锁定',
  },
  [K.currentPasswordWrong]: {
    vi: 'Mật khẩu hiện tại không đúng',
    en: 'The current password is incorrect',
    zh: '当前密码不正确',
  },

  // --- products ---
  [K.productNotFound]: {
    vi: 'Sản phẩm không tồn tại',
    en: 'Product not found',
    zh: '商品不存在',
  },
  [K.variantNotFound]: {
    vi: 'Loại sản phẩm không tồn tại',
    en: 'Product option not found',
    zh: '商品类型不存在',
  },

  // --- orders ---
  [K.orderVariantIdInvalid]: {
    vi: 'Mã loại sản phẩm không hợp lệ',
    en: 'Invalid product option id',
    zh: '商品类型 ID 无效',
  },
  [K.orderVariantIdRequired]: {
    vi: 'Vui lòng chọn loại sản phẩm',
    en: 'Please choose a product option',
    zh: '请选择商品类型',
  },
  [K.orderQuantityInt]: {
    vi: 'Số lượng phải là số nguyên',
    en: 'Quantity must be an integer',
    zh: '数量必须是整数',
  },
  [K.orderQuantityMin]: {
    vi: 'Số lượng tối thiểu là 1',
    en: 'Minimum quantity is 1',
    zh: '数量最少为 1',
  },
  [K.orderItemsInvalid]: {
    vi: 'Danh sách sản phẩm không hợp lệ',
    en: 'Invalid item list',
    zh: '商品列表无效',
  },
  [K.orderItemsMin]: {
    vi: 'Đơn hàng phải có ít nhất 1 sản phẩm',
    en: 'An order must contain at least 1 item',
    zh: '订单至少需要 1 件商品',
  },
  [K.orderNotFound]: {
    vi: 'Đơn hàng không tồn tại',
    en: 'Order not found',
    zh: '订单不存在',
  },
  [K.orderCannotCancel]: {
    vi: 'Đơn hàng không thể hủy',
    en: 'This order cannot be cancelled',
    zh: '该订单无法取消',
  },
  [K.orderInsufficientStock]: {
    vi: (p) => `Sản phẩm "${p.name}" không đủ hàng (còn ${p.remaining})`,
    en: (p) => `"${p.name}" does not have enough stock (${p.remaining} left)`,
    zh: (p) => `商品“${p.name}”库存不足（仅剩 ${p.remaining}）`,
  },
  [K.orderCodeFailed]: {
    vi: 'Không tạo được mã đơn hàng, vui lòng thử lại',
    en: 'Could not generate an order code, please try again',
    zh: '无法生成订单号，请重试',
  },

  // --- payments ---
  [K.paymentSessionFailed]: {
    vi: 'Không tạo được phiên thanh toán Binance',
    en: 'Could not create the Binance payment session',
    zh: '无法创建 Binance 付款会话',
  },
  [K.paymentSessionMissing]: {
    vi: 'Không tạo được phiên thanh toán',
    en: 'Could not create a payment session',
    zh: '无法创建付款会话',
  },
  [K.paymentMockDisabled]: {
    vi: 'Chế độ thanh toán thử nghiệm đang tắt',
    en: 'Sandbox payment mode is disabled',
    zh: '测试付款模式已关闭',
  },
  [K.paymentWebhookDisabled]: {
    vi: 'Webhook Binance không khả dụng ở chế độ thanh toán thử nghiệm',
    en: 'The Binance webhook is unavailable in sandbox payment mode',
    zh: '测试付款模式下 Binance Webhook 不可用',
  },
  [K.paymentInvalidSignature]: {
    vi: 'Chữ ký không hợp lệ',
    en: 'Invalid signature',
    zh: '签名无效',
  },
  [K.paymentCodeInvalid]: {
    vi: 'Mã đơn hàng không hợp lệ',
    en: 'Invalid order code',
    zh: '订单号无效',
  },
  [K.paymentCodeRequired]: {
    vi: 'Vui lòng cung cấp mã đơn hàng',
    en: 'An order code is required',
    zh: '请提供订单号',
  },
  [K.binanceNotConfigured]: {
    vi: 'Chưa cấu hình BINANCE_PAY_API_KEY / BINANCE_PAY_API_SECRET',
    en: 'BINANCE_PAY_API_KEY / BINANCE_PAY_API_SECRET are not configured',
    zh: '尚未配置 BINANCE_PAY_API_KEY / BINANCE_PAY_API_SECRET',
  },
  [K.binanceHttpError]: {
    vi: (p) => `Binance Pay trả về mã lỗi HTTP ${p.status}`,
    en: (p) => `Binance Pay returned HTTP error ${p.status}`,
    zh: (p) => `Binance Pay 返回 HTTP 错误 ${p.status}`,
  },
  [K.binanceRejected]: {
    vi: 'Binance Pay từ chối yêu cầu',
    en: 'Binance Pay rejected the request',
    zh: 'Binance Pay 拒绝了该请求',
  },
  [K.binanceCertFailed]: {
    vi: 'Không lấy được chứng chỉ công khai từ Binance Pay',
    en: 'Could not fetch the public certificate from Binance Pay',
    zh: '无法从 Binance Pay 获取公钥证书',
  },

  // --- payments: chọn phương thức & crypto on-chain ---
  [K.paymentMethodInvalid]: {
    vi: 'Phương thức thanh toán không hợp lệ',
    en: 'Invalid payment method',
    zh: '付款方式无效',
  },
  [K.paymentNoMethodConfigured]: {
    vi: 'Cửa hàng chưa bật phương thức thanh toán nào — vui lòng liên hệ quản trị viên',
    en: 'The store has no payment method enabled — please contact the administrator',
    zh: '店铺尚未启用任何付款方式 — 请联系管理员',
  },
  [K.paymentSepayNotReady]: {
    vi: 'Chuyển khoản ngân hàng đang tạm không dùng được. Vui lòng chọn phương thức khác.',
    en: 'Bank transfer is temporarily unavailable. Please choose another method.',
    zh: '银行转账暂时不可用，请选择其他方式。',
  },
  [K.paymentMethodUnavailable]: {
    vi: 'Phương thức thanh toán này hiện không khả dụng',
    en: 'This payment method is currently unavailable',
    zh: '该付款方式当前不可用',
  },
  [K.paymentCryptoAmountUnavailable]: {
    vi: 'Không tạo được số tiền thanh toán riêng cho đơn hàng — vui lòng thử lại sau ít phút',
    en: 'Could not allocate a unique payment amount for this order — please try again in a few minutes',
    zh: '暂时无法为该订单生成唯一付款金额，请几分钟后重试',
  },
  [K.paymentTxIdInvalid]: {
    vi: 'Mã giao dịch (TxID) không hợp lệ',
    en: 'Invalid transaction id (TxID)',
    zh: '交易哈希（TxID）无效',
  },
  [K.paymentTxIdRequired]: {
    vi: 'Vui lòng nhập mã giao dịch (TxID)',
    en: 'Please enter the transaction id (TxID)',
    zh: '请输入交易哈希（TxID）',
  },
  [K.paymentTxNotFound]: {
    vi: 'Chưa tìm thấy giao dịch nạp với TxID này — vui lòng chờ vài phút rồi thử lại',
    en: 'No confirmed deposit was found for this TxID yet — please wait a few minutes and try again',
    zh: '尚未找到该 TxID 对应的入账记录，请稍等几分钟后重试',
  },
  [K.paymentTxNetworkMismatch]: {
    vi: 'Giao dịch này không đúng mạng thanh toán của đơn hàng',
    en: 'This transaction is on a different network than the order',
    zh: '该交易所在网络与订单的付款网络不符',
  },
  [K.paymentTxAmountMismatch]: {
    vi: 'Số tiền của giao dịch không khớp với đơn hàng',
    en: 'The transaction amount does not match this order',
    zh: '该交易金额与订单不符',
  },
  [K.paymentTxAlreadyUsed]: {
    vi: 'TxID này đã được dùng cho một đơn hàng khác',
    en: 'This TxID has already been used for another order',
    zh: '该 TxID 已被其他订单使用',
  },

  // --- admin: product form ---
  [K.adminNameInvalid]: {
    vi: 'Tên sản phẩm không hợp lệ',
    en: 'Invalid product name',
    zh: '商品名称无效',
  },
  [K.adminNameRequired]: {
    vi: 'Tên sản phẩm không được để trống',
    en: 'Product name is required',
    zh: '商品名称不能为空',
  },
  [K.adminPriceCurrencyInvalid]: {
    vi: 'Đơn vị giá không hợp lệ.',
    en: 'Invalid price currency.',
    zh: '价格单位无效。',
  },
  [K.adminPriceAnchorNoRate]: {
    vi: 'Chưa có tỉ giá nên không đặt được giá bằng đơn vị này. Vào Cài đặt bấm cập nhật tỉ giá, hoặc nhập giá bằng USDT.',
    en: 'No exchange rate yet, so a price in this currency cannot be set. Refresh the rate in Settings, or enter the price in USDT.',
    zh: '尚无汇率，无法用该单位设置价格。请在设置中刷新汇率，或改用 USDT 输入价格。',
  },
  [K.adminPriceNumber]: {
    vi: 'Giá phải là số (tối đa 2 chữ số thập phân)',
    en: 'Price must be a number with at most 2 decimals',
    zh: '价格必须是数字（最多 2 位小数）',
  },
  [K.adminPriceMin]: {
    vi: 'Giá không được âm',
    en: 'Price cannot be negative',
    zh: '价格不能为负数',
  },
  [K.adminSlugInvalid]: {
    vi: 'Slug không hợp lệ',
    en: 'Invalid slug',
    zh: 'Slug 无效',
  },
  [K.adminShortDescriptionInvalid]: {
    vi: 'Mô tả ngắn không hợp lệ',
    en: 'Invalid short description',
    zh: '简短描述无效',
  },
  [K.adminDescriptionInvalid]: {
    vi: 'Mô tả không hợp lệ',
    en: 'Invalid description',
    zh: '详细描述无效',
  },
  [K.adminImageInvalid]: {
    vi: 'Đường dẫn ảnh không hợp lệ',
    en: 'Invalid image URL',
    zh: '图片地址无效',
  },
  [K.adminImageTooLarge]: {
    vi: 'Ảnh quá lớn — hãy chọn ảnh nhỏ hơn',
    en: 'Image is too large — please pick a smaller one',
    zh: '图片过大 — 请选择更小的图片',
  },
  [K.adminThumbnailInvalid]: {
    vi: 'Ảnh thu nhỏ không hợp lệ',
    en: 'Invalid thumbnail',
    zh: '缩略图无效',
  },
  [K.adminThumbnailTooLarge]: {
    vi: 'Ảnh thu nhỏ quá lớn',
    en: 'Thumbnail is too large',
    zh: '缩略图过大',
  },
  [K.adminImageDataRequired]: {
    vi: 'Thiếu dữ liệu ảnh',
    en: 'Image data is required',
    zh: '缺少图片数据',
  },
  [K.adminImageTooMany]: {
    vi: ({ max }: MessageParams) =>
      `Mỗi sản phẩm chỉ được tối đa ${max} ảnh (tính cả ảnh bìa)`,
    en: ({ max }: MessageParams) =>
      `A product can have at most ${max} images, cover included`,
    zh: ({ max }: MessageParams) => `每个商品最多 ${max} 张图片（含封面）`,
  },
  [K.adminImageNotFound]: {
    vi: 'Không tìm thấy ảnh',
    en: 'Image not found',
    zh: '未找到图片',
  },
  [K.adminImageOrderMismatch]: {
    vi: 'Danh sách sắp xếp không khớp với ảnh hiện có',
    en: 'The ordering list does not match the current images',
    zh: '排序列表与现有图片不匹配',
  },
  [K.adminCategoryInvalid]: {
    vi: 'Danh mục không hợp lệ',
    en: 'Invalid category',
    zh: '分类无效',
  },
  [K.adminSortOrderInt]: {
    vi: 'Thứ tự sắp xếp phải là số nguyên',
    en: 'Sort order must be an integer',
    zh: '排序必须是整数',
  },
  [K.adminWithdrawQuantityInvalid]: {
    vi: 'Số lượng rút phải là số nguyên từ 1 trở lên',
    en: 'The withdraw quantity must be a whole number of at least 1',
    zh: '抽取数量必须是不小于 1 的整数',
  },
  [K.adminWithdrawTooMany]: {
    vi: 'Mỗi lần chỉ rút được tối đa 500 dòng',
    en: 'At most 500 lines can be withdrawn at once',
    zh: '每次最多抽取 500 条',
  },
  [K.adminWithdrawNoStock]: {
    vi: 'Loại này không còn dòng nào bán được để rút',
    en: 'This variant has no sellable lines left to withdraw',
    zh: '该规格已无可售卡密可抽取',
  },
  [K.adminStockNotWithdrawn]: {
    vi: 'Chỉ trả lại kho được những dòng đã rút',
    en: 'Only withdrawn lines can be returned to stock',
    zh: '只有已抽取的卡密才能退回库存',
  },
  [K.adminStockDrawModeInvalid]: {
    vi: 'Cách rút kho không hợp lệ',
    en: 'Invalid stock draw mode',
    zh: '库存抽取方式无效',
  },
  [K.adminActiveInvalid]: {
    vi: 'Trạng thái hiển thị không hợp lệ',
    en: 'Invalid visibility flag',
    zh: '显示状态无效',
  },
  [K.adminSlugFailed]: {
    vi: 'Không tạo được slug từ tên sản phẩm',
    en: 'Could not generate a slug from the product name',
    zh: '无法根据商品名称生成 slug',
  },
  [K.adminSlugExists]: {
    vi: 'Slug đã tồn tại',
    en: 'This slug already exists',
    zh: '该 slug 已存在',
  },
  [K.adminProductHasOrders]: {
    vi: 'Sản phẩm đã có đơn hàng, hãy ẩn thay vì xóa',
    en: 'This product has orders — hide it instead of deleting',
    zh: '该商品已有订单，请隐藏而不是删除',
  },

  // --- admin: loại sản phẩm (variant) ---
  [K.adminVariantNameInvalid]: {
    vi: 'Tên loại sản phẩm không hợp lệ',
    en: 'Invalid product option name',
    zh: '商品类型名称无效',
  },
  [K.adminVariantNameRequired]: {
    vi: 'Tên loại sản phẩm không được để trống',
    en: 'Product option name is required',
    zh: '商品类型名称不能为空',
  },
  [K.adminVariantHasOrders]: {
    vi: 'Loại sản phẩm đã có đơn hàng, hãy ẩn thay vì xóa',
    en: 'This option has orders — hide it instead of deleting',
    zh: '该商品类型已有订单，请隐藏而不是删除',
  },
  [K.adminVariantLast]: {
    vi: 'Mỗi sản phẩm phải có ít nhất một loại',
    en: 'Every product must keep at least one option',
    zh: '每个商品至少要保留一个类型',
  },

  // --- admin: thông báo trang chủ ---
  [K.adminAnnouncementActiveInvalid]: {
    vi: 'Trạng thái hiển thị thông báo không hợp lệ',
    en: 'Invalid announcement visibility flag',
    zh: '公告显示状态无效',
  },
  [K.adminAnnouncementTitleInvalid]: {
    vi: 'Tiêu đề thông báo không hợp lệ',
    en: 'Invalid announcement title',
    zh: '公告标题无效',
  },
  [K.adminAnnouncementBodyInvalid]: {
    vi: 'Nội dung thông báo không hợp lệ',
    en: 'Invalid announcement body',
    zh: '公告内容无效',
  },
  [K.adminAnnouncementTranslationsInvalid]: {
    vi: 'Bản dịch thông báo không hợp lệ',
    en: 'Invalid announcement translations',
    zh: '公告译文无效',
  },
  [K.adminAnnouncementEmpty]: {
    vi: 'Vui lòng nhập nội dung thông báo trước khi dịch',
    en: 'Please write the announcement before translating it',
    zh: '请先填写公告内容再翻译',
  },

  // --- admin: dịch tự động ---
  [K.adminTranslationNotConfigured]: {
    vi: 'Chưa cấu hình ANTHROPIC_API_KEY nên không dùng được dịch tự động',
    en: 'ANTHROPIC_API_KEY is not configured, automatic translation is unavailable',
    zh: '尚未配置 ANTHROPIC_API_KEY，无法使用自动翻译',
  },
  [K.adminTranslationFailed]: {
    vi: 'Dịch tự động thất bại, vui lòng thử lại',
    en: 'Automatic translation failed, please try again',
    zh: '自动翻译失败，请重试',
  },
  [K.adminTranslationRefused]: {
    vi: 'Trợ lý dịch đã từ chối nội dung này',
    en: 'The translation assistant declined this content',
    zh: '翻译助手拒绝处理该内容',
  },

  // --- admin: stock ---
  [K.adminStockContentInvalid]: {
    vi: 'Nội dung kho không hợp lệ',
    en: 'Invalid stock content',
    zh: '库存内容无效',
  },
  [K.adminStockContentRequired]: {
    vi: 'Vui lòng nhập ít nhất một dòng',
    en: 'Please enter at least one line',
    zh: '请至少输入一行',
  },
  [K.adminStockDedupeInvalid]: {
    vi: 'Tùy chọn bỏ qua dòng trùng không hợp lệ',
    en: 'Invalid duplicate-skipping option',
    zh: '跳过重复行的选项无效',
  },
  [K.adminStockMinOneLine]: {
    vi: 'Vui lòng nhập ít nhất một dòng hợp lệ',
    en: 'Please enter at least one valid line',
    zh: '请至少输入一行有效内容',
  },
  [K.adminStockStatusInvalid]: {
    vi: 'Trạng thái kho không hợp lệ',
    en: 'Invalid stock status',
    zh: '库存状态无效',
  },
  [K.adminStockLineNotFound]: {
    vi: 'Dòng kho không tồn tại',
    en: 'Stock line not found',
    zh: '库存行不存在',
  },
  [K.adminStockOnlyAvailableDeletable]: {
    vi: 'Chỉ xóa được dòng chưa bán',
    en: 'Only unsold lines can be deleted',
    zh: '只能删除未售出的行',
  },

  // --- admin: queries / orders ---
  [K.adminPageInvalid]: {
    vi: 'Số trang không hợp lệ',
    en: 'Invalid page number',
    zh: '页码无效',
  },
  [K.adminLimitInvalid]: {
    vi: 'Kích thước trang không hợp lệ',
    en: 'Invalid page size',
    zh: '每页数量无效',
  },
  [K.adminOrderStatusInvalid]: {
    vi: 'Trạng thái đơn hàng không hợp lệ',
    en: 'Invalid order status',
    zh: '订单状态无效',
  },
  [K.adminSearchInvalid]: {
    vi: 'Từ khóa tìm kiếm không hợp lệ',
    en: 'Invalid search keyword',
    zh: '搜索关键词无效',
  },
  [K.adminOnlyPaidRedeliver]: {
    vi: 'Chỉ giao lại được đơn đã thanh toán',
    en: 'Only paid orders can be re-delivered',
    zh: '只有已付款的订单才能补发',
  },
  [K.adminUserIdInvalid]: {
    vi: 'Mã khách hàng không hợp lệ',
    en: 'Invalid customer id',
    zh: '客户 ID 无效',
  },

  // --- admin: khách hàng & phân quyền ---
  [K.superadminRequired]: {
    vi: 'Chỉ chủ cửa hàng mới thực hiện được thao tác này',
    en: 'Only the shop owner can perform this action',
    zh: '只有店主才能执行此操作',
  },
  [K.customerNotFound]: {
    vi: 'Khách hàng không tồn tại',
    en: 'Customer not found',
    zh: '客户不存在',
  },
  [K.cannotLockSelf]: {
    vi: 'Bạn không thể tự khóa tài khoản của mình',
    en: 'You cannot lock your own account',
    zh: '您不能锁定自己的账户',
  },
  [K.cannotLockAdmin]: {
    vi: 'Không thể khóa tài khoản quản trị viên',
    en: 'Administrator accounts cannot be locked',
    zh: '无法锁定管理员账户',
  },
  [K.cannotModifySuperadmin]: {
    vi: 'Không thể thay đổi tài khoản chủ cửa hàng',
    en: 'The shop owner account cannot be modified',
    zh: '无法更改店主账户',
  },
  [K.alreadyAdmin]: {
    vi: 'Tài khoản này đã là quản trị viên',
    en: 'This account is already an administrator',
    zh: '该账户已是管理员',
  },
  [K.notAdmin]: {
    vi: 'Tài khoản này không phải quản trị viên',
    en: 'This account is not an administrator',
    zh: '该账户不是管理员',
  },
  [K.cannotGrantLocked]: {
    vi: 'Không thể cấp quyền cho tài khoản đang bị khóa',
    en: 'A locked account cannot be granted admin rights',
    zh: '无法为已锁定的账户授予管理员权限',
  },

  // --- admin: nhật ký & thống kê ---
  [K.auditActionInvalid]: {
    vi: 'Hành động lọc không hợp lệ',
    en: 'Invalid audit action filter',
    zh: '操作筛选无效',
  },
  [K.seriesDaysInvalid]: {
    vi: 'Khoảng thời gian không hợp lệ (chỉ nhận 7, 14, 30 hoặc 60 ngày)',
    en: 'Invalid time range (only 7, 14, 30 or 60 days are supported)',
    zh: '时间范围无效（仅支持 7、14、30 或 60 天）',
  },

  // --- admin: cấu hình cửa hàng ---
  [K.adminSettingsFlagInvalid]: {
    vi: 'Giá trị bật/tắt không hợp lệ',
    en: 'Invalid on/off value',
    zh: '开关取值无效',
  },
  [K.adminBinanceIdInvalid]: {
    vi: 'Binance ID chỉ gồm chữ số',
    en: 'Binance ID must contain digits only',
    zh: 'Binance ID 只能包含数字',
  },
  [K.adminAiKeyInvalid]: {
    vi: 'Khoá API không hợp lệ',
    en: 'Invalid API key',
    zh: 'API 密钥无效',
  },
  [K.adminAiProviderInvalid]: {
    vi: 'Nhà cung cấp AI không hợp lệ',
    en: 'Invalid AI provider',
    zh: 'AI 服务商无效',
  },
  [K.adminAiBaseUrlInvalid]: {
    vi: 'Địa chỉ API phải bắt đầu bằng http:// hoặc https://',
    en: 'The API base URL must start with http:// or https://',
    zh: 'API 地址必须以 http:// 或 https:// 开头',
  },
  [K.adminAiModelInvalid]: {
    vi: 'Tên model không hợp lệ',
    en: 'Invalid model name',
    zh: '模型名称无效',
  },
  [K.adminAiModelRequired]: {
    vi: 'Dùng nhà cung cấp theo chuẩn OpenAI thì phải điền tên model',
    en: 'A model name is required when using an OpenAI-compatible provider',
    zh: '使用 OpenAI 兼容服务商时必须填写模型名称',
  },
  [K.adminSepayAccountInvalid]: {
    vi: 'Số tài khoản chỉ gồm chữ số',
    en: 'The account number must contain digits only',
    zh: '账号只能包含数字',
  },
  [K.adminSepayBankInvalid]: {
    vi: 'Tên ngân hàng không hợp lệ',
    en: 'Invalid bank name',
    zh: '银行名称无效',
  },
  [K.adminSepayHolderInvalid]: {
    vi: 'Tên chủ tài khoản không hợp lệ',
    en: 'Invalid account holder name',
    zh: '账户持有人姓名无效',
  },
  [K.adminSepayApiKeyInvalid]: {
    vi: 'Khoá SePay không hợp lệ',
    en: 'Invalid SePay key',
    zh: 'SePay 密钥无效',
  },
  [K.adminSepayIncomplete]: {
    vi: 'Bật SePay thì phải có số tài khoản, ngân hàng, tỉ giá VND và khoá API',
    en: 'Enabling SePay requires an account number, bank, VND rate and API key',
    zh: '启用 SePay 需要填写账号、银行、VND 汇率和 API 密钥',
  },
  [K.adminTelegramTokenRequired]: {
    vi: 'Bật bot Telegram thì phải dán token bot (lấy từ @BotFather)',
    en: 'Enabling the Telegram bot requires a bot token (from @BotFather)',
    zh: '启用 Telegram 机器人前请先粘贴机器人令牌（从 @BotFather 获取）',
  },
  [K.adminTelegramTokenInvalid]: {
    vi: 'Token bot Telegram không đúng dạng — token của @BotFather trông như "123456789:AA…"',
    en: 'The Telegram bot token is malformed — a @BotFather token looks like "123456789:AA…"',
    zh: 'Telegram 机器人令牌格式不正确 —— @BotFather 的令牌形如 "123456789:AA…"',
  },
  [K.adminTelegramGreetingTooLong]: {
    vi: 'Lời chào của bot quá dài (tối đa 500 ký tự)',
    en: 'The bot greeting is too long (500 characters max)',
    zh: '机器人问候语过长（最多 500 个字符）',
  },
  [K.depositAmountInvalid]: {
    vi: 'Số tiền nạp không hợp lệ (tối thiểu 10.000 ₫, tối đa 100.000.000 ₫)',
    en: 'Invalid top-up amount (min 10,000 ₫, max 100,000,000 ₫)',
    zh: '充值金额无效（最低 10,000 ₫，最高 100,000,000 ₫）',
  },
  [K.depositPendingLimit]: {
    vi: 'Bạn đang có 3 mã nạp chờ thanh toán — hãy hoàn tất hoặc huỷ một mã cũ trước',
    en: 'You already have 3 pending top-ups — complete or cancel an older one first',
    zh: '您已有 3 个待付款充值单——请先完成或取消一个旧充值单',
  },
  [K.balanceInsufficient]: {
    vi: 'Số dư không đủ để thanh toán đơn này — hãy nạp thêm hoặc chọn cách trả khác',
    en: 'Your balance is not enough for this order — top up or choose another payment method',
    zh: '余额不足以支付该订单——请充值或选择其他付款方式',
  },
  [K.balanceOrderNotPending]: {
    vi: 'Đơn này không còn chờ thanh toán',
    en: 'This order is no longer awaiting payment',
    zh: '该订单已不在待付款状态',
  },
  [K.adminCnyRateInvalid]: {
    vi: 'Tỉ giá CNY phải là số dương, tối đa 4 chữ số thập phân',
    en: 'The CNY rate must be a positive number with at most 4 decimals',
    zh: 'CNY 汇率必须为正数，最多四位小数',
  },
  [K.adminRateHourInvalid]: {
    vi: 'Giờ lấy tỉ giá phải là số nguyên từ 0 đến 23',
    en: 'The fetch hour must be a whole number between 0 and 23',
    zh: '获取时间必须是 0 到 23 之间的整数',
  },
  [K.adminRateMarkupInvalid]: {
    vi: 'Biên cộng thêm phải từ 0 đến 50 phần trăm',
    en: 'The markup must be between 0 and 50 percent',
    zh: '加价幅度必须在 0 到 50% 之间',
  },
  [K.adminRateFetchFailed]: {
    vi: 'Không lấy được tỉ giá — tỉ giá đang dùng được giữ nguyên',
    en: 'Could not fetch the rate — the current rate was kept',
    zh: '未能获取汇率 —— 已保留当前汇率',
  },
  [K.adminVndRateInvalid]: {
    vi: 'Tỉ giá VND phải là số dương, tối đa 2 chữ số thập phân',
    en: 'The VND rate must be a positive number with at most 2 decimals',
    zh: 'VND 汇率必须为正数，最多两位小数',
  },
  [K.adminBinanceIdRequired]: {
    vi: 'Bật nhận tiền qua Binance ID thì phải điền Binance ID',
    en: 'Enter a Binance ID before enabling Binance ID transfers',
    zh: '启用 Binance ID 收款前请先填写 Binance ID',
  },
  [K.adminSettingsAddressInvalid]: {
    vi: 'Địa chỉ ví không hợp lệ',
    en: 'Invalid wallet address',
    zh: '钱包地址无效',
  },
  [K.adminCryptoAddressRequired]: {
    vi: 'Bật thanh toán crypto cần ít nhất một địa chỉ ví (BEP20 hoặc TRC20)',
    en: 'Enabling crypto payments requires at least one wallet address (BEP20 or TRC20)',
    zh: '开启加密货币付款需要至少填写一个钱包地址（BEP20 或 TRC20）',
  },
  [K.adminBep20AddressInvalid]: {
    vi: 'Địa chỉ BEP20 không hợp lệ (dạng 0x + 40 ký tự hex)',
    en: 'Invalid BEP20 address (expected 0x followed by 40 hex characters)',
    zh: 'BEP20 地址无效（应为 0x 加 40 位十六进制字符）',
  },
  [K.adminTrc20AddressInvalid]: {
    vi: 'Địa chỉ TRC20 không hợp lệ (bắt đầu bằng T, dài 34 ký tự)',
    en: 'Invalid TRC20 address (starts with T, 34 characters long)',
    zh: 'TRC20 地址无效（以 T 开头，共 34 个字符）',
  },

  [K.adminCannotMarkPaid]: {
    vi: 'Chỉ đánh dấu đã thanh toán được cho đơn đang chờ hoặc đã hết hạn',
    en: 'Only pending or expired orders can be marked as paid',
    zh: '只有待付款或已过期的订单才能标记为已付款',
  },
  [K.adminMarkPaidNoteInvalid]: {
    vi: 'Ghi chú xác nhận thanh toán không hợp lệ (tối đa 300 ký tự)',
    en: 'Invalid payment confirmation note (max 300 characters)',
    zh: '付款确认备注无效（最多 300 个字符）',
  },
  [K.adminSupportContactInvalid]: {
    vi: 'Kênh liên hệ hỗ trợ không hợp lệ',
    en: 'Invalid support contact',
    zh: '客服联系方式无效',
  },
  [K.adminSupportUrlInvalid]: {
    vi: 'Liên kết hỗ trợ không hợp lệ (chỉ nhận http, https hoặc mailto)',
    en: 'Invalid support link (only http, https or mailto are allowed)',
    zh: '客服链接无效（仅支持 http、https 或 mailto）',
  },
  [K.adminSupportNoteInvalid]: {
    vi: 'Lời nhắn hỗ trợ không hợp lệ',
    en: 'Invalid support message',
    zh: '客服提示语无效',
  },
  [K.adminSupportTooMany]: {
    vi: 'Chỉ thêm được tối đa 6 kênh liên hệ',
    en: 'You can add at most 6 support channels',
    zh: '最多只能添加 6 个联系方式',
  },
  [K.cannotResetSelf]: {
    vi: 'Không thể tự đặt lại mật khẩu của chính mình — hãy dùng chức năng đổi mật khẩu',
    en: 'You cannot reset your own password — use the change-password feature instead',
    zh: '无法重置自己的密码 — 请使用修改密码功能',
  },

  // --- chống spam đăng ký ---
  [K.captchaRequired]: {
    vi: 'Vui lòng trả lời câu hỏi xác minh',
    en: 'Please answer the verification question',
    zh: '请回答验证问题',
  },
  [K.captchaInvalid]: {
    vi: 'Câu trả lời xác minh không đúng hoặc đã hết hạn — vui lòng thử lại',
    en: 'The verification answer is wrong or has expired — please try again',
    zh: '验证答案错误或已过期 — 请重试',
  },
  [K.tooManyRegisters]: {
    vi: 'Bạn đã tạo quá nhiều tài khoản — vui lòng thử lại sau',
    en: 'Too many accounts created from this address — please try again later',
    zh: '该地址创建的账号过多 — 请稍后再试',
  },
  [K.tooManyLogins]: {
    vi: 'Đăng nhập sai quá nhiều lần — vui lòng thử lại sau vài phút',
    en: 'Too many failed sign-in attempts — please try again in a few minutes',
    zh: '登录尝试次数过多 — 请几分钟后再试',
  },
  [K.analyticsPayloadInvalid]: {
    vi: 'Dữ liệu thống kê không hợp lệ',
    en: 'Invalid analytics payload',
    zh: '统计数据无效',
  },
  [K.tooManyRequests]: {
    vi: 'Bạn thao tác quá nhanh — vui lòng thử lại sau',
    en: 'Too many requests — please slow down and try again',
    zh: '请求过于频繁 — 请稍后再试',
  },

  // --- mã giảm giá ---
  [K.couponCodeRequired]: {
    vi: 'Vui lòng nhập mã giảm giá',
    en: 'Please enter a discount code',
    zh: '请输入优惠码',
  },
  [K.couponCodeInvalid]: {
    vi: 'Mã giảm giá chỉ gồm chữ, số và dấu gạch ngang',
    en: 'A discount code may only contain letters, digits and hyphens',
    zh: '优惠码只能包含字母、数字和连字符',
  },
  [K.couponNotFound]: {
    vi: 'Mã giảm giá không tồn tại',
    en: 'This discount code does not exist',
    zh: '优惠码不存在',
  },
  [K.couponInactive]: {
    vi: 'Mã giảm giá đã ngừng áp dụng',
    en: 'This discount code is no longer active',
    zh: '该优惠码已停用',
  },
  [K.couponNotStarted]: {
    vi: 'Mã giảm giá chưa đến ngày áp dụng',
    en: 'This discount code is not active yet',
    zh: '该优惠码尚未开始生效',
  },
  [K.couponExpired]: {
    vi: 'Mã giảm giá đã hết hạn',
    en: 'This discount code has expired',
    zh: '该优惠码已过期',
  },
  [K.couponExhausted]: {
    vi: 'Mã giảm giá đã hết lượt sử dụng',
    en: 'This discount code has reached its usage limit',
    zh: '该优惠码的使用次数已用完',
  },
  [K.couponUserLimit]: {
    vi: 'Bạn đã dùng hết số lần cho phép của mã này',
    en: 'You have already used this code the maximum number of times',
    zh: '您使用该优惠码的次数已达上限',
  },
  [K.couponMinAmount]: {
    vi: (p) => `Đơn hàng phải từ ${p.min} USDT mới dùng được mã này`,
    en: (p) => `This code requires an order of at least ${p.min} USDT`,
    zh: (p) => `订单需满 ${p.min} USDT 才能使用该优惠码`,
  },
  [K.couponCodeTaken]: {
    vi: 'Mã giảm giá này đã tồn tại',
    en: 'This discount code already exists',
    zh: '该优惠码已存在',
  },
  [K.couponTypeInvalid]: {
    vi: 'Kiểu giảm giá không hợp lệ',
    en: 'Invalid discount type',
    zh: '折扣类型无效',
  },
  [K.couponValueInvalid]: {
    vi: 'Giá trị giảm phải lớn hơn 0',
    en: 'The discount value must be greater than 0',
    zh: '折扣值必须大于 0',
  },
  [K.couponPercentRange]: {
    vi: 'Giảm theo phần trăm chỉ nhận giá trị từ 1 đến 100',
    en: 'A percentage discount must be between 1 and 100',
    zh: '百分比折扣必须在 1 到 100 之间',
  },
  [K.couponNumberInvalid]: {
    vi: 'Giá trị số không hợp lệ',
    en: 'Invalid numeric value',
    zh: '数值无效',
  },
  [K.couponDateInvalid]: {
    vi: 'Ngày không hợp lệ',
    en: 'Invalid date',
    zh: '日期无效',
  },
  [K.couponNoteInvalid]: {
    vi: 'Ghi chú không hợp lệ',
    en: 'Invalid note',
    zh: '备注无效',
  },
  [K.couponNotFoundAdmin]: {
    vi: 'Không tìm thấy mã giảm giá',
    en: 'Discount code not found',
    zh: '未找到该优惠码',
  },

  [K.legalSlugInvalid]: {
    vi: 'Trang chính sách không tồn tại',
    en: 'This policy page does not exist',
    zh: '该政策页面不存在',
  },
  [K.legalTitleInvalid]: {
    vi: 'Tiêu đề trang chính sách không hợp lệ',
    en: 'Invalid policy page title',
    zh: '政策页面标题无效',
  },
  [K.legalBodyInvalid]: {
    vi: 'Nội dung trang chính sách không hợp lệ',
    en: 'Invalid policy page content',
    zh: '政策页面内容无效',
  },

  // --- misc ---
  [K.databaseDown]: {
    vi: 'Không kết nối được cơ sở dữ liệu',
    en: 'Cannot reach the database',
    zh: '无法连接数据库',
  },
  [K.internalError]: {
    vi: 'Đã xảy ra lỗi, vui lòng thử lại',
    en: 'Something went wrong, please try again',
    zh: '发生错误，请稍后重试',
  },
};

/**
 * Gói khoá + tham số vào MỘT chuỗi, dùng cho `message` của class-validator
 * (decorator chỉ nhận chuỗi). Ví dụ: "auth.password_min#{"min":8}"
 */
export function withParams(key: string, params: MessageParams): string {
  return `${key}#${JSON.stringify(params)}`;
}

/** Tách chuỗi dạng "key#{json}" thành khoá và tham số. */
export function parseMessage(value: string): { key: string; params: MessageParams } {
  const index = value.indexOf('#');
  if (index === -1) return { key: value, params: {} };
  const key = value.slice(0, index);
  try {
    return { key, params: JSON.parse(value.slice(index + 1)) as MessageParams };
  } catch {
    return { key, params: {} };
  }
}

export function isMessageKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const { key } = parseMessage(value);
  return Object.prototype.hasOwnProperty.call(MESSAGES, key);
}

/** Dịch một khoá; nếu không phải khoá đã biết thì trả về nguyên văn. */
export function translate(
  key: string,
  locale: Locale,
  params: MessageParams = {},
): string {
  const entry = MESSAGES[key];
  if (!entry) return key;
  const template = entry[locale] ?? entry[DEFAULT_LOCALE];
  return typeof template === 'function' ? template(params) : template;
}
