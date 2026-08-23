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
  detailBuyHint: 'Bấm nút 🛒 bên dưới để mua ngay tại đây.',
  productGone: 'Sản phẩm này không còn bán nữa.',
  pagePrev: '« Trang trước',
  pageNext: 'Trang sau »',
  pageLabel: (page: number, total: number) => `Trang ${page}/${total}`,
  tryAgain: 'Có lỗi khi tải danh sách hàng, vui lòng thử lại sau.',

  /** ---- Giai đoạn 3: đặt đơn + thanh toán ---- */
  qtyTitle: (variant: string) => `Mua ${variant} — chọn số lượng:`,
  variantSoldOut: 'Loại này vừa hết hàng.',
  tooManyPending: (n: number) =>
    `Bạn đang có ${n} đơn chờ thanh toán — thanh toán hoặc huỷ bớt rồi hãy đặt tiếp.`,
  orderCreated: (code: string) => `Đã tạo đơn ${code}.`,
  orderTotalLine: (total: string) => `Tổng: ${total}`,
  chooseMethod: 'Chọn cách thanh toán:',
  methodNames: {
    mock: '🧪 Giả lập (chỉ để thử)',
    binance_pay: '🟡 Binance Pay',
    binance_id: '🟡 Chuyển tới Binance ID',
    crypto_bep20: '🪙 USDT — BEP20',
    crypto_trc20: '🪙 USDT — TRC20',
    sepay: '🏦 Chuyển khoản ngân hàng',
  } as Record<string, string>,
  payTitle: (code: string) => `Thanh toán đơn ${code}`,
  payAmount: (amount: string) => `Số tiền: ${amount}`,
  payMemo: (code: string) => `Nội dung chuyển khoản (BẮT BUỘC): ${code}`,
  payMemoBinance: (code: string) => `Ghi vào lời nhắn khi chuyển (BẮT BUỘC): ${code}`,
  payDeadline: (minutes: number) => `Hạn thanh toán: ${minutes} phút nữa.`,
  payExactAmount:
    'Chuyển ĐÚNG số tiền tới từng chữ số lẻ — hệ thống nhận diện đơn của bạn theo số tiền.',
  payCryptoNetwork: (network: string) => `Mạng: ${network}`,
  payAddressLabel: 'Địa chỉ ví (bấm để sao chép):',
  payBinanceIdLabel: 'Binance ID nhận tiền (bấm để sao chép):',
  payBankLine: (bank: string, account: string) => `${bank} — STK: ${account}`,
  payOpenCheckout: 'Bấm liên kết để mở trang thanh toán Binance Pay:',
  payMockHint: 'Cổng GIẢ LẬP — không có tiền thật, chỉ dùng để thử hệ thống.',
  btnPaid: '✅ Tôi đã chuyển',
  btnCancelOrder: '❌ Huỷ đơn',
  btnMockConfirm: '✅ Xác nhận đã trả (giả lập)',
  btnMyOrders: '🧾 Đơn của tôi',
  btnBackToShop: '« Về bảng hàng',
  checkStillPending: 'Chưa thấy tiền vào. Sau khi chuyển, đợi khoảng 1 phút rồi bấm lại.',
  checkPaidWaitDelivery: 'Đã nhận tiền! Đang giao hàng — bấm kiểm tra lại sau ít giây.',
  deliveredTitle: (code: string) => `🎉 Đơn ${code} đã giao xong!`,
  deliveredKeysIntro: 'Sản phẩm của bạn (bấm vào vùng mờ để hiện):',
  deliveredKeepSafe: 'Hãy lưu lại ngay — đừng chia sẻ với ai.',
  orderCancelled: (code: string) => `Đã huỷ đơn ${code}. Hàng giữ chỗ đã được trả về kho.`,
  ordersTitle: 'Đơn của bạn (bấm để xem):',
  ordersEmpty: 'Bạn chưa có đơn nào. Chọn một sản phẩm ở bảng hàng để bắt đầu.',
  orderStatusNames: {
    PENDING: '⏳ Chờ thanh toán',
    PAID: '💰 Đã trả — chờ giao',
    DELIVERED: '✅ Đã giao',
    CANCELLED: '✖️ Đã huỷ',
    EXPIRED: '⌛ Hết hạn',
  } as Record<string, string>,
  orderClosed: 'Đơn này đã đóng. Bạn có thể đặt đơn mới từ bảng hàng.',
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
  detailBuyHint: 'Tap a 🛒 button below to buy right here.',
  productGone: 'This product is no longer available.',
  pagePrev: '« Prev',
  pageNext: 'Next »',
  pageLabel: (page: number, total: number) => `Page ${page}/${total}`,
  tryAgain: 'Something went wrong loading the catalog, please try again later.',

  qtyTitle: (variant: string) => `Buy ${variant} — choose a quantity:`,
  variantSoldOut: 'This option just sold out.',
  tooManyPending: (n: number) =>
    `You already have ${n} orders awaiting payment — pay or cancel one before ordering again.`,
  orderCreated: (code: string) => `Order ${code} created.`,
  orderTotalLine: (total: string) => `Total: ${total}`,
  chooseMethod: 'Choose a payment method:',
  methodNames: {
    mock: '🧪 Mock gateway (testing only)',
    binance_pay: '🟡 Binance Pay',
    binance_id: '🟡 Transfer to Binance ID',
    crypto_bep20: '🪙 USDT — BEP20',
    crypto_trc20: '🪙 USDT — TRC20',
    sepay: '🏦 Bank transfer (Vietnam)',
  } as Record<string, string>,
  payTitle: (code: string) => `Pay order ${code}`,
  payAmount: (amount: string) => `Amount: ${amount}`,
  payMemo: (code: string) => `Transfer note (REQUIRED): ${code}`,
  payMemoBinance: (code: string) => `Put this in the transfer note (REQUIRED): ${code}`,
  payDeadline: (minutes: number) => `Payment deadline: ${minutes} minutes from now.`,
  payExactAmount:
    'Send the EXACT amount down to the last digit — the system matches your order by amount.',
  payCryptoNetwork: (network: string) => `Network: ${network}`,
  payAddressLabel: 'Wallet address (tap to copy):',
  payBinanceIdLabel: 'Receiving Binance ID (tap to copy):',
  payBankLine: (bank: string, account: string) => `${bank} — account: ${account}`,
  payOpenCheckout: 'Open the Binance Pay checkout link:',
  payMockHint: 'MOCK gateway — no real money, for testing the system only.',
  btnPaid: '✅ I have paid',
  btnCancelOrder: '❌ Cancel order',
  btnMockConfirm: '✅ Confirm payment (mock)',
  btnMyOrders: '🧾 My orders',
  btnBackToShop: '« Back to shop',
  checkStillPending: 'No payment detected yet. After sending, wait about a minute and press again.',
  checkPaidWaitDelivery: 'Payment received! Delivering — check again in a few seconds.',
  deliveredTitle: (code: string) => `🎉 Order ${code} delivered!`,
  deliveredKeysIntro: 'Your items (tap the blurred area to reveal):',
  deliveredKeepSafe: 'Save them now — do not share with anyone.',
  orderCancelled: (code: string) => `Order ${code} cancelled. Reserved stock was returned.`,
  ordersTitle: 'Your orders (tap to view):',
  ordersEmpty: 'You have no orders yet. Pick a product from the list to get started.',
  orderStatusNames: {
    PENDING: '⏳ Awaiting payment',
    PAID: '💰 Paid — delivering',
    DELIVERED: '✅ Delivered',
    CANCELLED: '✖️ Cancelled',
    EXPIRED: '⌛ Expired',
  } as Record<string, string>,
  orderClosed: 'This order is closed. You can place a new one from the product list.',
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
  detailBuyHint: '点击下方 🛒 按钮即可在此直接购买。',
  productGone: '该商品已下架。',
  pagePrev: '« 上一页',
  pageNext: '下一页 »',
  pageLabel: (page: number, total: number) => `第 ${page}/${total} 页`,
  tryAgain: '加载商品列表出错，请稍后重试。',

  qtyTitle: (variant: string) => `购买 ${variant} — 请选择数量：`,
  variantSoldOut: '该规格刚刚售罄。',
  tooManyPending: (n: number) => `您已有 ${n} 个待付款订单——请先付款或取消，再下新单。`,
  orderCreated: (code: string) => `订单 ${code} 已创建。`,
  orderTotalLine: (total: string) => `合计：${total}`,
  chooseMethod: '请选择付款方式：',
  methodNames: {
    mock: '🧪 模拟网关（仅供测试）',
    binance_pay: '🟡 Binance Pay',
    binance_id: '🟡 转账至 Binance ID',
    crypto_bep20: '🪙 USDT — BEP20',
    crypto_trc20: '🪙 USDT — TRC20',
    sepay: '🏦 银行转账（越南）',
  } as Record<string, string>,
  payTitle: (code: string) => `支付订单 ${code}`,
  payAmount: (amount: string) => `金额：${amount}`,
  payMemo: (code: string) => `转账备注（必填）：${code}`,
  payMemoBinance: (code: string) => `转账留言中务必填写：${code}`,
  payDeadline: (minutes: number) => `付款期限：${minutes} 分钟内。`,
  payExactAmount: '请转账精确到最后一位的金额——系统按金额识别您的订单。',
  payCryptoNetwork: (network: string) => `网络：${network}`,
  payAddressLabel: '钱包地址（点按复制）：',
  payBinanceIdLabel: '收款 Binance ID（点按复制）：',
  payBankLine: (bank: string, account: string) => `${bank} — 账号：${account}`,
  payOpenCheckout: '点击链接打开 Binance Pay 收银台：',
  payMockHint: '模拟网关——没有真实资金，仅用于测试系统。',
  btnPaid: '✅ 我已付款',
  btnCancelOrder: '❌ 取消订单',
  btnMockConfirm: '✅ 确认付款（模拟）',
  btnMyOrders: '🧾 我的订单',
  btnBackToShop: '« 返回商店',
  checkStillPending: '尚未检测到付款。转账后请等待约 1 分钟再点击。',
  checkPaidWaitDelivery: '已收到付款！正在发货——几秒后再查一次。',
  deliveredTitle: (code: string) => `🎉 订单 ${code} 已发货！`,
  deliveredKeysIntro: '您的商品（点按模糊区域显示）：',
  deliveredKeepSafe: '请立即保存——不要分享给任何人。',
  orderCancelled: (code: string) => `订单 ${code} 已取消，预留库存已退回。`,
  ordersTitle: '您的订单（点按查看）：',
  ordersEmpty: '您还没有订单。从商品列表选择一件开始购买吧。',
  orderStatusNames: {
    PENDING: '⏳ 待付款',
    PAID: '💰 已付款 — 发货中',
    DELIVERED: '✅ 已发货',
    CANCELLED: '✖️ 已取消',
    EXPIRED: '⌛ 已过期',
  } as Record<string, string>,
  orderClosed: '该订单已关闭。您可以从商品列表下新单。',
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
