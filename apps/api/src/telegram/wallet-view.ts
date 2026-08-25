/**
 * Dựng tin nhắn cho VÍ SỐ DƯ + menu cố định — thuần như catalog-view/order-view.
 *
 * Tách file vì vòng đời dữ liệu khác: bên này vẽ từ Deposit và số dư — tiền
 * nạp của khách, con số phải đúng tuyệt đối vì khách chuyển đúng số bot nói.
 */

import {
  formatMoney,
  formatUsdt,
  type PaymentMethod,
  type StoreRatesDto,
} from '@webcatt/shared';
import { sepayQrUrl } from '../payments/sepay-qr';
import { encodeCallback, escapeHtml } from './catalog-view';
import { orderMoney, type BotView } from './order-view';
import { botDict, type BotLang } from './messages';
import type { TgInlineKeyboard, TgReplyKeyboard } from './telegram-api';

/** Kênh của một mã nạp — trùng tên enum DepositMode bên Prisma, khai lại để
 *  module này giữ được tính THUẦN (không import @prisma/client). */
export type DepositPayMode = 'SEPAY' | 'CRYPTO' | 'BINANCE_ID';

/** Các mức nạp chào trên nút (VND) — cần số khác thì bấm hai lần. */
export const DEPOSIT_VND_OPTIONS = [
  [50_000, 100_000, 200_000],
  [500_000, 1_000_000, 2_000_000],
] as const;

/** "50k" / "1000k" — cùng lối viết gọn với nhãn giá sản phẩm. */
function vndShort(vnd: number): string {
  return `${vnd / 1_000}k`;
}

/**
 * Menu CỐ ĐỊNH dưới ô nhập. Nút reply keyboard gửi text của nó thành tin nhắn
 * — bot nhận diện bằng cách so text với nhãn của CẢ BA ngôn ngữ (khách đổi
 * ngôn ngữ app giữa chừng thì nhãn cũ vẫn phải hiểu được).
 */
export function mainMenuKeyboard(lang: BotLang): TgReplyKeyboard {
  const dict = botDict(lang);
  return {
    keyboard: [
      [{ text: dict.menuShop }, { text: dict.menuDeposit }, { text: dict.searchBtn }],
      [{ text: dict.menuOrders }, { text: dict.menuAccount }, { text: dict.menuSupport }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Nút menu nào ứng với hành động gì — so trên cả ba ngôn ngữ. */
export type MenuAction = 'shop' | 'deposit' | 'orders' | 'account' | 'support' | 'search';

export function matchMenuAction(text: string): MenuAction | null {
  const gon = text.trim();
  for (const lang of ['vi', 'en', 'zh'] as const) {
    const dict = botDict(lang);
    if (gon === dict.menuShop) return 'shop';
    if (gon === dict.menuDeposit) return 'deposit';
    if (gon === dict.menuOrders) return 'orders';
    if (gon === dict.menuAccount) return 'account';
    if (gon === dict.menuSupport) return 'support';
    if (gon === dict.searchBtn) return 'search';
  }
  return null;
}

// ---------------------------------------------------------------- tài khoản

/** Màn 👤 kiểu bảng thống kê của Lâm Shop — chỉ những con số CÓ THẬT ở shop này. */
export function renderAccount(
  info: {
    name: string;
    code: number;
    balance: number;
    spentUsdt: number;
    doneCount: number;
  },
  lang: BotLang,
  rates: StoreRatesDto | null,
): BotView {
  const dict = botDict(lang);
  const text = [
    `<b>${escapeHtml(dict.accStatsTitle)}</b>`,
    '━━━━━━━━━━━━━━━━━━',
    '',
    `<b>${escapeHtml(dict.accSectionUser)}</b>`,
    escapeHtml(dict.accNameLine(info.name.trim() || '...')),
    escapeHtml(dict.accBalanceLine(orderMoney(info.balance, lang, rates))),
    escapeHtml(dict.accIdLine(info.code)),
    '',
    `<b>${escapeHtml(dict.accSectionShopping)}</b>`,
    escapeHtml(dict.accSpentLine(orderMoney(info.spentUsdt, lang, rates))),
    escapeHtml(dict.accDoneLine(info.doneCount)),
  ].join('\n');
  return {
    text,
    keyboard: [
      [
        { text: dict.menuDeposit, callback_data: encodeCallback({ kind: 'depositMenu' }) },
        { text: dict.menuOrders, callback_data: encodeCallback({ kind: 'orders' }) },
      ],
      [{ text: botDict(lang).hubBackBtn, callback_data: encodeCallback({ kind: 'hub' }) }],
    ],
  };
}

// ---------------------------------------------------------------- nạp tiền

export function renderDepositMenu(lang: BotLang, balanceUsdt: number | null, rates: StoreRatesDto | null): BotView {
  const dict = botDict(lang);
  const lines = [`<b>${escapeHtml(dict.depositTitle)}</b>`];
  if (balanceUsdt !== null) {
    lines.push(escapeHtml(dict.accountBalance(orderMoney(balanceUsdt, lang, rates))));
  }
  // Kiểu Lâm Shop: cho GÕ số tiền tự do — nút nhanh vẫn giữ cho khách lười gõ.
  lines.push(
    '',
    escapeHtml(dict.depositFreeText),
    escapeHtml(dict.depositRange),
  );

  const keyboard: TgInlineKeyboard = DEPOSIT_VND_OPTIONS.map((row) =>
    row.map((vnd) => ({
      text: vndShort(vnd),
      callback_data: encodeCallback({ kind: 'depositAmount', vnd }),
    })),
  );
  keyboard.push([
    { text: dict.hubBackBtn, callback_data: encodeCallback({ kind: 'hub' }) },
  ]);
  return { text: lines.join('\n'), keyboard };
}

/**
 * Khách GÕ số tiền → hỏi xác nhận bằng nút thay vì tạo mã ngay: bot không có
 * "trạng thái hội thoại", một con số trôi nổi trong chat mà tạo luôn mã nạp
 * thì gõ nhầm cũng thành mã — bắt bấm xác nhận là chặn được.
 */
export function renderDepositConfirm(
  vnd: number,
  lang: BotLang,
): BotView {
  const dict = botDict(lang);
  const tien = formatMoney(vnd, 'VND');
  return {
    text: escapeHtml(dict.depositConfirmAsk(tien)),
    keyboard: [
      [
        {
          text: dict.depositConfirmBtn(tien),
          callback_data: encodeCallback({ kind: 'depositAmount', vnd }),
        },
      ],
      [{ text: dict.menuDeposit, callback_data: encodeCallback({ kind: 'depositMenu' }) }],
    ],
  };
}

/**
 * Bảng chọn CÁCH NẠP sau khi khách chốt số tiền — mỗi phương thức đang mở một
 * nút, nhãn dùng chung methodNames với luồng trả đơn.
 */
export function renderDepositMethodChooser(
  vnd: number,
  methods: readonly PaymentMethod[],
  lang: BotLang,
): BotView {
  const dict = botDict(lang);
  const keyboard: TgInlineKeyboard = methods.map((method) => [
    {
      text: dict.methodNames[method] ?? method,
      callback_data: encodeCallback({ kind: 'depositMethod', vnd, method }),
    },
  ]);
  keyboard.push([
    { text: dict.hubBackBtn, callback_data: encodeCallback({ kind: 'depositMenu' }) },
  ]);
  return {
    text: escapeHtml(dict.depositChooseMethod(formatMoney(vnd, 'VND'))),
    keyboard,
  };
}

/**
 * Hướng dẫn nạp cho một mã — mọi con số lấy từ Deposit đã CHỐT lúc tạo, cùng
 * nguyên tắc với hướng dẫn trả đơn. Ba kênh ba bài:
 * - SEPAY: chuyển đúng VND, nội dung là mã NAP- (webhook khớp mã + số tiền).
 * - CRYPTO: on-chain không có chỗ ghi mã — chuyển ĐÚNG số USDT duy nhất.
 * - BINANCE_ID: ghi mã NAP- vào lời nhắn + đúng số USDT.
 */
export function renderDepositInstructions(
  deposit: {
    code: string;
    vndAmount: number;
    amountUsdt: number;
    mode: DepositPayMode;
    cryptoNetwork: string | null;
    cryptoAddress: string | null;
  },
  bank: { accountNumber: string; bank: string; accountHolder: string } | null,
  lang: BotLang,
  minutesLeft: number | null,
): BotView {
  const dict = botDict(lang);
  const lines = [`<b>${escapeHtml(dict.depositTitle)}</b>`];
  let photo: string | undefined;

  if (deposit.mode === 'SEPAY' && bank !== null) {
    lines.push(escapeHtml(dict.payBankLine(bank.bank, bank.accountNumber)));
    if (bank.accountHolder.trim() !== '') {
      lines.push(escapeHtml(bank.accountHolder.trim()));
    }
    lines.push(
      escapeHtml(dict.payAmount(formatMoney(deposit.vndAmount, 'VND'))),
      escapeHtml(dict.depositWillCredit(formatUsdt(deposit.amountUsdt))),
      '',
      `<b>${escapeHtml(dict.payMemo(deposit.code))}</b>`,
    );
    photo = sepayQrUrl({
      accountNumber: bank.accountNumber,
      bank: bank.bank,
      amountVnd: deposit.vndAmount,
      description: deposit.code,
      accountHolder: bank.accountHolder,
    });
  } else {
    // Kênh crypto/Binance ID — số USDT hiện đủ 6 chữ số lẻ trong <code>:
    // phần lẻ 0.0001 chính là "chữ ký" nhận diện mã nạp, cắt là mất dấu.
    const soUsdt = deposit.amountUsdt.toFixed(6);
    if (deposit.mode === 'CRYPTO') {
      if (deposit.cryptoNetwork) {
        lines.push(escapeHtml(dict.payCryptoNetwork(deposit.cryptoNetwork)));
      }
      lines.push(
        escapeHtml(dict.payAddressLabel),
        `<code>${escapeHtml(deposit.cryptoAddress ?? '')}</code>`,
      );
    } else {
      lines.push(
        escapeHtml(dict.payBinanceIdLabel),
        `<code>${escapeHtml(deposit.cryptoAddress ?? '')}</code>`,
      );
    }
    lines.push(
      '',
      escapeHtml(dict.depositUsdtExact),
      `<code>${soUsdt}</code> USDT`,
      escapeHtml(dict.payAmount(formatMoney(deposit.vndAmount, 'VND'))),
    );
    if (deposit.mode === 'BINANCE_ID') {
      // Lời nhắn là đường khớp CHẮC nhất bên Binance Pay — nhấn mạnh.
      lines.push('', `<b>${escapeHtml(dict.payMemoBinance(deposit.code))}</b>`);
    }
  }
  if (minutesLeft !== null) lines.push('', escapeHtml(dict.payDeadline(minutesLeft)));

  return {
    text: lines.join('\n'),
    // Không nút "Tôi đã chuyển": tiền vào là vòng đẩy tự báo cộng ví.
    keyboard: [
      [
        {
          text: dict.btnCancelOrder,
          callback_data: encodeCallback({ kind: 'depositCancel', code: deposit.code }),
        },
      ],
    ],
    photo,
  };
}

/** Tin "đã cộng tiền" — dùng cho cả nút kiểm tra lẫn vòng đẩy. */
export function renderDepositCredited(
  amountUsdt: number,
  balanceUsdt: number,
  lang: BotLang,
  rates: StoreRatesDto | null,
): BotView {
  const dict = botDict(lang);
  return {
    text: escapeHtml(
      dict.depositCredited(
        orderMoney(amountUsdt, lang, rates),
        orderMoney(balanceUsdt, lang, rates),
      ),
    ),
    keyboard: [
      [
        { text: dict.menuShop, callback_data: encodeCallback({ kind: 'catalog', page: 1 }) },
        { text: dict.menuAccount, callback_data: encodeCallback({ kind: 'account' }) },
      ],
    ],
  };
}
