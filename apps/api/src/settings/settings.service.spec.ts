import { describe, expect, it } from 'vitest';
import { shouldRearmOwnerLowStockAlerts } from './settings.service';

const BASE = {
  telegramOwnerChatId: '111',
  telegramOwnerLowStockAlertsEnabled: true,
  telegramOwnerLowStockThreshold: 3,
};

describe('shouldRearmOwnerLowStockAlerts', () => {
  it('đánh giá lại khi đổi chat nhận cảnh báo', () => {
    expect(
      shouldRearmOwnerLowStockAlerts(BASE, {
        ...BASE,
        telegramOwnerChatId: '222',
      }),
    ).toBe(true);
  });

  it('đánh giá lại khi đổi ngưỡng hoặc bật lại cảnh báo', () => {
    expect(
      shouldRearmOwnerLowStockAlerts(BASE, {
        ...BASE,
        telegramOwnerLowStockThreshold: 5,
      }),
    ).toBe(true);
    expect(
      shouldRearmOwnerLowStockAlerts(
        { ...BASE, telegramOwnerLowStockAlertsEnabled: false },
        BASE,
      ),
    ).toBe(true);
  });

  it('không phát lại do khoảng trắng hoặc cấu hình không liên quan', () => {
    expect(
      shouldRearmOwnerLowStockAlerts(
        { ...BASE, telegramOwnerChatId: ' 111 ' },
        BASE,
      ),
    ).toBe(false);
  });
});
