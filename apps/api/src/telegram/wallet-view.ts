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

export function renderAccount(
  info: { code: number; balance: number; ordersCount: number },
  lang: BotLang,
  rates: StoreRatesDto | null,
): BotView {
  const dict = botDict(lang);
  const text = [
    `<b>${escapeHtml(dict.accountTitle)}</b>`,
    escapeHtml(dict.accountCode(info.code)),
    escapeHtml(dict.accountBalance(orderMoney(info.balance, lang, rates))),
    escapeHtml(dict.accountOrders(info.ordersCount)),
  ].join('\n');
  return {
    text,
    keyboard: [
      [
        { text: dict.menuDeposit, callback_data: encodeCallback({ kind: 'depositMenu' }) },
        { text: dict.menuOrders, callback_data: encodeCallback({ kind: 'orders' }) },
      ],
      [{ text: dict.btnBackToShop, callback_data: encodeCallback({ kind: 'catalog', page: 1 }) }],
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
  lines.push('', escapeHtml(dict.depositChooseAmount));

  const keyboard: TgInlineKeyboard = DEPOSIT_VND_OPTIONS.map((row) =>
    row.map((vnd) => ({
      text: vndShort(vnd),
      callback_data: encodeCallback({ kind: 'depositAmount', vnd }),
    })),
  );
  keyboard.push([
    { text: dict.btnBackToShop, callback_data: encodeCallback({ kind: 'catalog', page: 1 }) },
  ]);
  return { text: lines.join('\n'), keyboard };
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
