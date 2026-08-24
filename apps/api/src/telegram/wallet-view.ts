/**
 * Dựng tin nhắn cho VÍ SỐ DƯ + menu cố định — thuần như catalog-view/order-view.
 *
 * Tách file vì vòng đời dữ liệu khác: bên này vẽ từ Deposit và số dư — tiền
 * nạp của khách, con số phải đúng tuyệt đối vì khách chuyển đúng số bot nói.
 */

import { formatMoney, formatUsdt, type StoreRatesDto } from '@webcatt/shared';
import { sepayQrUrl } from '../payments/sepay-qr';
import { encodeCallback, escapeHtml } from './catalog-view';
import { orderMoney, type BotView } from './order-view';
import { botDict, type BotLang } from './messages';
import type { TgInlineKeyboard, TgReplyKeyboard } from './telegram-api';

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
      [{ text: dict.menuShop }, { text: dict.menuDeposit }],
      [{ text: dict.menuOrders }, { text: dict.menuAccount }, { text: dict.menuSupport }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Nút menu nào ứng với hành động gì — so trên cả ba ngôn ngữ. */
export type MenuAction = 'shop' | 'deposit' | 'orders' | 'account' | 'support';

export function matchMenuAction(text: string): MenuAction | null {
  const gon = text.trim();
  for (const lang of ['vi', 'en', 'zh'] as const) {
    const dict = botDict(lang);
    if (gon === dict.menuShop) return 'shop';
    if (gon === dict.menuDeposit) return 'deposit';
    if (gon === dict.menuOrders) return 'orders';
    if (gon === dict.menuAccount) return 'account';
    if (gon === dict.menuSupport) return 'support';
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
 * Hướng dẫn chuyển khoản cho một mã nạp — mọi con số lấy từ Deposit đã CHỐT
 * lúc tạo, cùng nguyên tắc với hướng dẫn trả đơn.
 */
export function renderDepositInstructions(
  deposit: { code: string; vndAmount: number; amountUsdt: number },
  bank: { accountNumber: string; bank: string; accountHolder: string },
  lang: BotLang,
  minutesLeft: number | null,
): BotView {
  const dict = botDict(lang);
  const lines = [
    `<b>${escapeHtml(dict.depositTitle)}</b>`,
    escapeHtml(dict.payBankLine(bank.bank, bank.accountNumber)),
  ];
  if (bank.accountHolder.trim() !== '') lines.push(escapeHtml(bank.accountHolder.trim()));
  lines.push(
    escapeHtml(dict.payAmount(formatMoney(deposit.vndAmount, 'VND'))),
    escapeHtml(dict.depositWillCredit(formatUsdt(deposit.amountUsdt))),
    '',
    `<b>${escapeHtml(dict.payMemo(deposit.code))}</b>`,
    '',
    escapeHtml(dict.payAutoNote),
  );
  if (minutesLeft !== null) lines.push('', escapeHtml(dict.payDeadline(minutesLeft)));

  return {
    text: lines.join('\n'),
    keyboard: [
      [
        {
          text: dict.btnPaid,
          callback_data: encodeCallback({ kind: 'depositCheck', code: deposit.code }),
        },
      ],
      [
        {
          text: dict.btnCancelOrder,
          callback_data: encodeCallback({ kind: 'depositCancel', code: deposit.code }),
        },
      ],
    ],
    photo: sepayQrUrl({
      accountNumber: bank.accountNumber,
      bank: bank.bank,
      amountVnd: deposit.vndAmount,
      description: deposit.code,
      accountHolder: bank.accountHolder,
    }),
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
