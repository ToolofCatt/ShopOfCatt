/**
 * Dựng tin nhắn cho LUỒNG MUA của bot — thuần như catalog-view (không
 * Nest/fetch/Date; thời gian còn lại do service tính rồi truyền vào).
 *
 * Tách khỏi catalog-view vì khác vòng đời dữ liệu: bên kia vẽ từ ProductDto,
 * bên này vẽ từ OrderDetailDto — tiền của một đơn CỤ THỂ, số phải đúng tuyệt
 * đối vì khách sẽ chuyển đúng con số bot nói.
 */

import {
  convertFromUsdt,
  formatMoney,
  formatUsdt,
  type OrderDetailDto,
  type OrderSummaryDto,
  type PaymentMethodDto,
  type ProductDto,
  type ProductVariantDto,
  type StoreRatesDto,
} from '@webcatt/shared';
import {
  CURRENCY_BY_LANG,
  compactMoney,
  displayVariantPrice,
  encodeCallback,
  escapeHtml,
  truncateLabel,
} from './catalog-view';
import { botDict, type BotLang } from './messages';
import type { TgInlineKeyboard, TgInlineKeyboardButton } from './telegram-api';

/** Các mức số lượng chào trên nút — đơn to hơn thì khách bấm mua nhiều lần. */
const QTY_OPTIONS = [1, 2, 3, 5, 10] as const;

export interface BotView {
  text: string;
  keyboard: TgInlineKeyboard;
  /** Ảnh gửi KÈM (sendPhoto riêng, không nút) — hiện chỉ QR SePay dùng. */
  photo?: string | null;
}

/**
 * Tiền tổng của đơn (gốc USDT) hiện theo ngôn ngữ khách — KHÔNG phải giá neo:
 * tổng đơn là số dẫn xuất, quy đổi như web vẫn làm ở trang thanh toán.
 */
export function orderMoney(
  usdt: number,
  lang: BotLang,
  rates: StoreRatesDto | null,
): string {
  const doi = convertFromUsdt(usdt, CURRENCY_BY_LANG[lang], rates);
  return doi === null ? formatUsdt(usdt) : formatMoney(doi, CURRENCY_BY_LANG[lang]);
}

// ---------------------------------------------------------------- chọn số lượng

export function renderQuantityPicker(
  product: ProductDto,
  variant: ProductVariantDto,
  lang: BotLang,
  rates: StoreRatesDto | null,
  backPage: number,
): BotView {
  const dict = botDict(lang);
  const gia = displayVariantPrice(variant, lang, rates);
  const text = [
    `<b>${escapeHtml(product.name)}</b>`,
    escapeHtml(dict.qtyTitle(variant.name)),
    `${escapeHtml(gia)} × 1`,
    escapeHtml(dict.inStock(variant.availableStock)),
  ].join('\n');

  const qtyRow: TgInlineKeyboardButton[] = QTY_OPTIONS.filter(
    (qty) => qty <= variant.availableStock,
  ).map((qty) => ({
    text: `${qty}`,
    callback_data: encodeCallback({ kind: 'qty', variantId: variant.id, qty }),
  }));

  return {
    text,
    keyboard: [
      qtyRow,
      [
        {
          text: dict.detailBack,
          callback_data: encodeCallback({
            kind: 'product',
            productId: product.id,
            backPage,
          }),
        },
      ],
    ],
  };
}

// ---------------------------------------------------------------- chọn phương thức

export function renderMethodChooser(
  order: OrderDetailDto,
  methods: readonly PaymentMethodDto[],
  lang: BotLang,
  rates: StoreRatesDto | null,
  minutesLeft: number | null,
  /** Số dư ví của khách (USDT); đủ trả thì chào nút "trả bằng số dư" TRÊN CÙNG. */
  balanceUsdt = 0,
): BotView {
  const dict = botDict(lang);
  const lines = [
    `<b>${escapeHtml(dict.orderCreated(order.code))}</b>`,
    escapeHtml(dict.orderTotalLine(orderMoney(order.totalAmount, lang, rates))),
  ];
  if (minutesLeft !== null) lines.push(escapeHtml(dict.payDeadline(minutesLeft)));
  lines.push('', escapeHtml(dict.chooseMethod));

  const keyboard: TgInlineKeyboard = [];
  // Chỉ chào khi ĐỦ trả — nút "trả bằng số dư" mà bấm ra lỗi thiếu tiền thì
  // thà đừng chào; service vẫn kiểm lại lần cuối trong transaction.
  if (balanceUsdt >= order.totalAmount) {
    keyboard.push([
      {
        text: dict.payWithBalance(orderMoney(balanceUsdt, lang, rates)),
        callback_data: encodeCallback({ kind: 'payBalance', orderCode: order.code }),
      },
    ]);
  }
  for (const entry of methods) {
    keyboard.push([
      {
        text: dict.methodNames[entry.method] ?? entry.method,
        callback_data: encodeCallback({
          kind: 'method',
          orderCode: order.code,
          method: entry.method,
        }),
      },
    ]);
  }
  keyboard.push([
    {
      text: dict.btnCancelOrder,
      callback_data: encodeCallback({ kind: 'cancelOrder', orderCode: order.code }),
    },
  ]);

  return { text: lines.join('\n'), keyboard };
}

// ---------------------------------------------------------------- hướng dẫn trả tiền

/**
 * Hướng dẫn thanh toán theo phương thức ĐÃ CHỌN của đơn. Mọi con số ở đây lấy
 * từ Payment đã CHỐT lúc chọn (vndAmount, cryptoAmount…) — không tự tính lại,
 * vì tự tính là mở cửa cho lệch số giữa cái bot nói và cái bộ đối soát chờ.
 */
export function renderPaymentInstructions(
  order: OrderDetailDto,
  lang: BotLang,
  rates: StoreRatesDto | null,
  minutesLeft: number | null,
  accountHolder = '',
): BotView {
  const dict = botDict(lang);
  const payment = order.payment;
  const lines = [`<b>${escapeHtml(dict.payTitle(order.code))}</b>`];
  const keyboard: TgInlineKeyboard = [];
  let photo: string | null = null;

  const nutDaChuyen: TgInlineKeyboardButton = {
    text: dict.btnPaid,
    callback_data: encodeCallback({ kind: 'check', orderCode: order.code }),
  };
  const nutHuy: TgInlineKeyboardButton = {
    text: dict.btnCancelOrder,
    callback_data: encodeCallback({ kind: 'cancelOrder', orderCode: order.code }),
  };

  switch (payment?.mode) {
    case 'MOCK': {
      lines.push(escapeHtml(dict.payMockHint));
      keyboard.push([
        {
          text: dict.btnMockConfirm,
          callback_data: encodeCallback({ kind: 'mockConfirm', orderCode: order.code }),
        },
      ]);
      break;
    }
    case 'BINANCE': {
      lines.push(
        escapeHtml(dict.payAmount(formatUsdt(order.totalAmount))),
        escapeHtml(dict.payOpenCheckout),
      );
      if (payment.checkoutUrl) {
        // Chỉ escape phần hiển thị; href là URL do Binance trả về, đặt trong
        // nháy kép và escape để không thoát được ra ngoài thuộc tính.
        lines.push(
          `<a href="${escapeHtml(payment.checkoutUrl)}">${escapeHtml(payment.checkoutUrl)}</a>`,
        );
      }
      keyboard.push([nutDaChuyen]);
      break;
    }
    case 'BINANCE_ID': {
      lines.push(
        escapeHtml(dict.payBinanceIdLabel),
        `<code>${escapeHtml(payment.binanceId ?? '')}</code>`,
        escapeHtml(dict.payAmount(formatUsdt(payment.cryptoAmount ?? order.totalAmount))),
        '',
        `<b>${escapeHtml(dict.payMemoBinance(order.code))}</b>`,
      );
      keyboard.push([nutDaChuyen]);
      break;
    }
    case 'CRYPTO': {
      lines.push(
        escapeHtml(dict.payCryptoNetwork(payment.cryptoNetwork ?? '')),
        escapeHtml(dict.payAddressLabel),
        `<code>${escapeHtml(payment.cryptoAddress ?? '')}</code>`,
        escapeHtml(dict.payAmount(formatUsdt(payment.cryptoAmount ?? order.totalAmount))),
        '',
        `<b>${escapeHtml(dict.payExactAmount)}</b>`,
      );
      keyboard.push([nutDaChuyen]);
      break;
    }
    case 'SEPAY': {
      lines.push(
        escapeHtml(dict.payBankLine(payment.sepayBank ?? '', payment.sepayAccountNumber ?? '')),
      );
      if (accountHolder.trim() !== '') lines.push(escapeHtml(accountHolder.trim()));
      lines.push(
        escapeHtml(
          dict.payAmount(formatMoney(payment.vndAmount ?? 0, 'VND')),
        ),
        '',
        `<b>${escapeHtml(dict.payMemo(order.code))}</b>`,
      );
      photo = payment.sepayQrUrl ?? null;
      keyboard.push([nutDaChuyen]);
      break;
    }
    default: {
      // Chưa/không có phiên thanh toán — chỉ còn nước huỷ hoặc kiểm tra.
      lines.push(escapeHtml(dict.orderTotalLine(orderMoney(order.totalAmount, lang, rates))));
      keyboard.push([nutDaChuyen]);
    }
  }

  // MOCK không có đối soát tự động — đừng hứa "bot tự gửi" ở cổng giả lập.
  if (payment?.mode !== 'MOCK') {
    lines.push('', escapeHtml(dict.payAutoNote));
  }
  if (minutesLeft !== null) {
    lines.push('', escapeHtml(dict.payDeadline(minutesLeft)));
  }
  keyboard.push([nutHuy]);
  return { text: lines.join('\n'), keyboard, photo };
}

// ---------------------------------------------------------------- đã giao: key về chat

export function renderOrderDelivered(order: OrderDetailDto, lang: BotLang): BotView {
  const dict = botDict(lang);
  const lines = [
    `<b>${escapeHtml(dict.deliveredTitle(order.code))}</b>`,
    escapeHtml(dict.deliveredKeysIntro),
  ];
  for (const item of order.items) {
    const ten = item.variantName
      ? `${item.productName} – ${item.variantName}`
      : item.productName;
    lines.push('', `<b>${escapeHtml(ten)}</b> ×${item.quantity}`);
    for (const line of item.deliveredLines ?? []) {
      // Spoiler + monospace: che key khỏi người nhìn trộm màn hình, bấm vào
      // mới hiện, và bấm giữ là sao chép nguyên văn.
      lines.push(`<tg-spoiler><code>${escapeHtml(line)}</code></tg-spoiler>`);
    }
  }
  lines.push('', escapeHtml(dict.deliveredKeepSafe));

  return {
    text: lines.join('\n'),
    keyboard: [
      [
        { text: dict.btnMyOrders, callback_data: encodeCallback({ kind: 'orders' }) },
        {
          text: dict.btnBackToShop,
          callback_data: encodeCallback({ kind: 'catalog', page: 1 }),
        },
      ],
    ],
  };
}

// ---------------------------------------------------------------- xem một đơn

export function renderOrderView(
  order: OrderDetailDto,
  lang: BotLang,
  rates: StoreRatesDto | null,
  minutesLeft: number | null,
  accountHolder = '',
): BotView {
  const dict = botDict(lang);
  if (order.status === 'PENDING') {
    return renderPaymentInstructions(order, lang, rates, minutesLeft, accountHolder);
  }
  if (order.status === 'DELIVERED') {
    return renderOrderDelivered(order, lang);
  }

  const lines = [
    `<b>${escapeHtml(order.code)}</b> — ${escapeHtml(dict.orderStatusNames[order.status] ?? order.status)}`,
    escapeHtml(dict.orderTotalLine(orderMoney(order.totalAmount, lang, rates))),
  ];
  const keyboard: TgInlineKeyboard = [];
  if (order.status === 'PAID') {
    // Tiền đã vào, hàng chưa ra (kho thiếu lúc giao) — cho khách nút tự kiểm.
    lines.push(escapeHtml(dict.checkPaidWaitDelivery));
    keyboard.push([
      {
        text: dict.btnPaid,
        callback_data: encodeCallback({ kind: 'check', orderCode: order.code }),
      },
    ]);
  } else {
    lines.push(escapeHtml(dict.orderClosed));
  }
  keyboard.push([
    { text: dict.btnMyOrders, callback_data: encodeCallback({ kind: 'orders' }) },
    { text: dict.btnBackToShop, callback_data: encodeCallback({ kind: 'catalog', page: 1 }) },
  ]);
  return { text: lines.join('\n'), keyboard };
}

// ---------------------------------------------------------------- danh sách đơn

/** Tối đa bấy nhiêu đơn gần nhất — đủ cho tra cứu, không biến chat thành sổ cái. */
export const ORDER_LIST_MAX = 8;

export function renderOrderList(
  orders: readonly OrderSummaryDto[],
  lang: BotLang,
  rates: StoreRatesDto | null,
): BotView {
  const dict = botDict(lang);
  const keyboard: TgInlineKeyboard = [];
  const text =
    orders.length === 0
      ? escapeHtml(dict.ordersEmpty)
      : `<b>${escapeHtml(dict.ordersTitle)}</b>`;

  for (const order of orders.slice(0, ORDER_LIST_MAX)) {
    const status = dict.orderStatusNames[order.status] ?? order.status;
    const money = compactMoney(
      convertFromUsdt(order.totalAmount, CURRENCY_BY_LANG[lang], rates) ?? order.totalAmount,
      convertFromUsdt(order.totalAmount, CURRENCY_BY_LANG[lang], rates) === null
        ? 'USDT'
        : CURRENCY_BY_LANG[lang],
    );
    keyboard.push([
      {
        text: truncateLabel(`${order.code} | ${status} | ${money}`, 60),
        callback_data: encodeCallback({ kind: 'order', orderCode: order.code }),
      },
    ]);
  }
  keyboard.push([
    {
      text: dict.btnBackToShop,
      callback_data: encodeCallback({ kind: 'catalog', page: 1 }),
    },
  ]);
  return { text, keyboard };
}
