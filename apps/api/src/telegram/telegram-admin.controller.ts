import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type {
  AdminStoreSettingDto,
  OrderDetailDto,
  PaymentInfoDto,
  PaymentMethod,
  PaymentMethodDto,
  ProductDto,
  ProductVariantDto,
  TelegramMessagePreview,
  TelegramPreviewDto,
  TelegramStatusDto,
} from '@webcatt/shared';
import { floorUsdt } from '@webcatt/shared';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnnouncementService } from '../announcement/announcement.service';
import { AuditService } from '../audit/audit.service';
import { DEPOSIT_MAX_VND, DEPOSIT_MIN_VND } from '../balance/balance.service';
import { LOCALES, type Locale } from '../i18n/locale';
import { ProductsService } from '../products/products.service';
import { sepayQrUrl } from '../payments/sepay-qr';
import { SettingsService } from '../settings/settings.service';
import { RateLimit } from '../security/rate-limit.guard';
import { UpdateTelegramSettingsDto } from '../settings/dto/update-telegram-settings.dto';
import {
  encodeCallback,
  groupCategories,
  parseCallback,
  renderAnnouncement,
  renderCategoryProducts,
  renderHub,
  renderLanguageMenu,
  renderProductDescription,
  renderProductDetail,
  renderSearchResults,
  renderStorefront,
  renderSupport,
  searchProducts,
} from './catalog-view';
import {
  renderMethodChooser,
  renderOrderDelivered,
  renderOrderList,
  renderOrderView,
  renderPaymentInstructions,
  renderQuantityPicker,
  type BotView,
} from './order-view';
import { botDict } from './messages';
import { TelegramService } from './telegram.service';
import { renderStockAlert } from './stock-alert-view';
import { renderOwnerNewOrderAlert } from './owner-alert-view';
import type { TgInlineKeyboard } from './telegram-api';
import {
  DEPOSIT_VND_OPTIONS,
  renderAccount,
  renderDepositCancelled,
  renderDepositConfirm,
  renderDepositInstructions,
  renderDepositMenu,
  renderDepositMethodChooser,
  matchMenuAction,
  type DepositPayMode,
} from './wallet-view';

class TelegramPreviewQueryDto {
  @IsOptional()
  @IsIn(LOCALES)
  lang?: Locale;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  text?: string;
}

/** Đổi bàn phím kiểu Bot API (snake_case) sang DTO camelCase cho web. */
function toPreviewKeyboard(keyboard: TgInlineKeyboard) {
  return keyboard.map((row) =>
    row.map((button) => ({
      text: button.text,
      callbackData: button.callback_data,
    })),
  );
}

function previewOrder(
  product: ProductDto,
  variant: ProductVariantDto,
  quantity: number,
  code: string,
  payment: PaymentInfoDto | null = null,
): OrderDetailDto {
  const total = Number((variant.price * quantity).toFixed(6));
  return {
    id: `preview-${code}`,
    code,
    status: 'PENDING',
    subtotalAmount: total,
    discountAmount: 0,
    couponCode: null,
    totalAmount: total,
    currency: 'USDT',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:10:00.000Z',
    paidAt: null,
    items: [
      {
        id: `item-${code}`,
        productId: product.id,
        productSlug: product.slug,
        productName: product.name,
        variantName: variant.name,
        unitPrice: variant.price,
        quantity,
      },
    ],
    payment,
  };
}

function previewPayment(
  order: OrderDetailDto,
  method: PaymentMethodDto,
  vndPerUsdt: number,
): PaymentInfoDto {
  const common = { status: 'PENDING' as const };
  switch (method.method) {
    case 'sepay':
      const vndAmount = Math.round(order.totalAmount * vndPerUsdt);
      return {
        ...common,
        mode: 'SEPAY',
        sepayBank: method.bank ?? '',
        sepayAccountNumber: method.address ?? '',
        vndAmount,
        sepayQrUrl: sepayQrUrl({
          accountNumber: method.address ?? '',
          bank: method.bank ?? '',
          amountVnd: vndAmount,
          description: order.code,
          accountHolder: method.accountHolder ?? '',
        }),
      };
    case 'crypto_bep20':
    case 'crypto_trc20':
      return {
        ...common,
        mode: 'CRYPTO',
        cryptoNetwork: method.method === 'crypto_bep20' ? 'BEP20' : 'TRC20',
        cryptoAddress: method.address ?? '',
        cryptoAmount: Number((order.totalAmount + 0.0001).toFixed(6)),
      };
    case 'binance_id':
      return {
        ...common,
        mode: 'BINANCE_ID',
        binanceId: method.address ?? '',
        cryptoAmount: Number((order.totalAmount + 0.0001).toFixed(6)),
      };
    case 'binance_pay':
      return {
        ...common,
        mode: 'BINANCE',
        checkoutUrl: 'https://pay.binance.com/',
      };
    case 'mock':
      return { ...common, mode: 'MOCK' };
  }
}

function previewDelivered(order: OrderDetailDto): OrderDetailDto {
  return {
    ...order,
    status: 'DELIVERED',
    paidAt: '2026-01-01T00:01:00.000Z',
    items: order.items.map((item) => ({
      ...item,
      deliveredLines: Array.from(
        { length: item.quantity },
        (_, index) => `KEY-XEM-TRUOC-${index + 1}`,
      ),
    })),
  };
}

/**
 * API cho trang /admin/telegram: cấu hình bot, trạng thái sống, và bản XEM
 * TRƯỚC dựng bằng CHÍNH các hàm render của bot — cái admin thấy là cái khách
 * sẽ thấy, không phải một bản chép tay sẽ lệch dần theo thời gian.
 */
@Controller('admin/telegram')
@UseGuards(JwtAuthGuard, AdminGuard)
export class TelegramAdminController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly settings: SettingsService,
    private readonly products: ProductsService,
    private readonly announcements: AnnouncementService,
    private readonly audit: AuditService,
  ) {}

  @Get('status')
  async status(): Promise<TelegramStatusDto> {
    const cfg = await this.settings.getTelegramConfig();
    return {
      enabled: cfg.enabled,
      tokenSet: cfg.token !== '',
      ...this.telegram.getStatus(),
    };
  }

  /** Cập nhật riêng cấu hình bot — xem chú thích ở UpdateTelegramSettingsDto. */
  @Put('settings')
  updateSettings(
    @CurrentUser() user: User,
    @Body() dto: UpdateTelegramSettingsDto,
  ): Promise<AdminStoreSettingDto> {
    return this.settings.updateTelegram(user, dto);
  }

  @Post('owner-test')
  @RateLimit({ limit: 5, windowMs: 60_000, name: 'admin:telegram-owner-test' })
  async sendOwnerTest(@CurrentUser() user: User): Promise<{ ok: true }> {
    await this.telegram.sendOwnerTest();
    await this.audit.log(
      user,
      'settings.update',
      { type: 'telegram', id: 'owner-alert-test' },
      { action: 'send_test' },
    );
    return { ok: true };
  }

  @Get('preview')
  async preview(@Query() query: TelegramPreviewQueryDto): Promise<TelegramPreviewDto> {
    const lang = query.lang ?? 'vi';
    const [products, rates, support, cfg, announcement, enabledMethods] = await Promise.all([
      this.products.list(lang),
      this.settings.getPublicRates(),
      this.settings.getSupportInfo(),
      this.settings.getTelegramConfig(),
      this.announcements.getPublic(lang),
      this.settings.getEnabledMethods(),
    ]);

    /*
     * BẢN ĐỒ MÀN HÌNH khoá theo callback_data: giả lập bấm nút nào tra đúng
     * khoá đó — logic điều hướng nằm nguyên trong renderer của bot, trang
     * admin không chép lại gì để rồi lệch dần.
     */
    const screens: Record<string, TelegramMessagePreview> = {};
    const dua = (key: string, view: BotView) => {
      screens[key] = {
        text: view.text,
        keyboard: toPreviewKeyboard(view.keyboard),
        ...(view.photo ? { photo: view.photo } : {}),
      };
    };

    dua('h', renderHub('Khách', 0, lang, rates, cfg.greeting));
    dua('s', renderSupport(support.supportChannels, support.supportNote, lang));
    dua('lg', renderLanguageMenu(lang));
    dua(
      'a',
      renderAccount(
        { name: 'Khách', code: 100000, balance: 0, spentUsdt: 0, doneCount: 0 },
        lang,
        rates,
      ),
    );
    dua('o', renderOrderList([], lang, rates));

    const stockProduct = products.find((product) => product.variants.length > 0);
    const stockVariant = stockProduct?.variants[0];
    if (stockProduct && stockVariant) {
      dua(
        'stock-alert',
        renderStockAlert(
          {
            productId: stockProduct.id,
            productName: stockProduct.name,
            variantName: stockVariant.name,
            price: stockVariant.price,
            priceCurrency: stockVariant.priceCurrency,
            priceAmount: stockVariant.priceAmount,
            added: 5,
            total: Math.max(5, stockVariant.availableStock),
            createdAt: new Date(),
          },
          lang,
          rates,
          this.telegram.getStatus().botUsername ?? '@cattstore_shop_bot',
        ),
      );
    }
    dua('owner-alert', {
      text: renderOwnerNewOrderAlert({
        code: 'DH-XEMTRUOC',
        customer: 'Khách Telegram #94000963',
        items: [
          {
            name:
              stockProduct && stockVariant
                ? `${stockProduct.name} · ${stockVariant.name}`
                : 'ChatGPT Plus 30 ngày · Mặc định',
            quantity: 1,
          },
        ],
        total: '100.000 ₫',
        createdAt: new Date(),
      }),
      keyboard: [],
    });

    const depositMethods = enabledMethods
      .map((entry) => entry.method)
      .filter((method): method is Exclude<PaymentMethod, 'mock' | 'binance_pay'> =>
        ['sepay', 'crypto_bep20', 'crypto_trc20', 'binance_id'].includes(method),
      );
    dua('d', renderDepositMenu(lang, 0, rates));
    const previewDepositCode = 'NAP-XEMTRUOC';
    const addDepositScreens = (vnd: number) => {
      dua(`dn:${vnd}`, renderDepositMethodChooser(vnd, depositMethods, lang));
      for (const method of depositMethods) {
        const entry = enabledMethods.find((item) => item.method === method);
        if (!entry || rates.vndPerUsdt <= 0) continue;
        const mode: DepositPayMode =
          method === 'sepay' ? 'SEPAY' : method === 'binance_id' ? 'BINANCE_ID' : 'CRYPTO';
        const network =
          method === 'crypto_bep20' ? 'BEP20' : method === 'crypto_trc20' ? 'TRC20' : null;
        dua(
          encodeCallback({ kind: 'depositMethod', vnd, method }),
          renderDepositInstructions(
            {
              code: previewDepositCode,
              vndAmount: vnd,
              amountUsdt: floorUsdt(vnd / rates.vndPerUsdt),
              mode,
              cryptoNetwork: network,
              cryptoAddress: entry.address ?? null,
            },
            mode === 'SEPAY'
              ? {
                  accountNumber: entry.address ?? '',
                  bank: entry.bank ?? '',
                  accountHolder: entry.accountHolder ?? '',
                }
              : null,
            lang,
            mode === 'SEPAY' ? 10 : 30,
          ),
        );
      }
    };
    for (const vnd of DEPOSIT_VND_OPTIONS.flat()) addDepositScreens(vnd);
    dua(`dx:${previewDepositCode}`, renderDepositCancelled(previewDepositCode, lang));

    const nhom = groupCategories(products, lang);
    if (nhom.length <= 1) {
      // Một danh mục: c:pg là danh sách phẳng theo trang.
      const trang1 = renderStorefront(products, lang, rates, 1);
      for (let pg = 1; pg <= trang1.totalPages; pg++) {
        dua(`c:${pg}`, renderStorefront(products, lang, rates, pg));
      }
    } else {
      dua('c:1', renderStorefront(products, lang, rates, 1));
      for (let i = 0; i < nhom.length; i++) {
        const trang1 = renderCategoryProducts(products, i, lang, rates, 1);
        if (!trang1) continue;
        for (let pg = 1; pg <= trang1.totalPages; pg++) {
          const view = renderCategoryProducts(products, i, lang, rates, pg);
          if (view) dua(`ct:${i}:${pg}`, view);
        }
      }
    }

    // Chi tiết sản phẩm: dựng cho đúng những khoá p:… mà các màn trên trỏ tới.
    for (const screen of Object.values(screens)) {
      for (const row of screen.keyboard) {
        for (const button of row) {
          const match = /^p:([A-Za-z0-9_-]+):([0-9]+)$/.exec(button.callbackData);
          if (!match || screens[button.callbackData]) continue;
          const product = products.find((sp) => sp.id === match[1]);
          if (!product) continue;
          dua(
            button.callbackData,
            renderProductDetail(product, lang, rates, support.supportChannels, Number(match[2])),
          );
        }
      }
    }

    // Mô tả + chọn số lượng dùng đúng dữ liệu sản phẩm nhưng KHÔNG tạo đơn.
    for (const screen of [...Object.values(screens)]) {
      for (const row of screen.keyboard) {
        for (const button of row) {
          const parsed = parseCallback(button.callbackData);
          if (!parsed || screens[button.callbackData]) continue;
          if (parsed.kind === 'productDescription') {
            const product = products.find((item) => item.id === parsed.productId);
            if (product) {
              dua(button.callbackData, renderProductDescription(product, lang, parsed.backPage));
            }
          } else if (parsed.kind === 'buy') {
            const product = products.find((item) => item.id === parsed.productId);
            const variant = product?.variants.find((item) => item.id === parsed.variantId);
            if (product && variant) {
              dua(
                button.callbackData,
                renderQuantityPicker(product, variant, lang, rates, parsed.backPage),
              );
            }
          }
        }
      }
    }

    // Bấm số lượng → bảng phương thức → hướng dẫn từng kênh, tất cả chỉ là mẫu.
    for (const screen of [...Object.values(screens)]) {
      for (const row of screen.keyboard) {
        for (const button of row) {
          const parsed = parseCallback(button.callbackData);
          if (!parsed || parsed.kind !== 'qty' || screens[button.callbackData]) continue;
          let product: ProductDto | undefined;
          let variant: ProductVariantDto | undefined;
          for (const candidate of products) {
            const found = candidate.variants.find((item) => item.id === parsed.variantId);
            if (found) {
              product = candidate;
              variant = found;
              break;
            }
          }
          if (!product || !variant) continue;
          const code = `DH-X${products.indexOf(product) + 1}Q${parsed.qty}`;
          const order = previewOrder(product, variant, parsed.qty, code);
          dua(button.callbackData, renderMethodChooser(order, enabledMethods, lang, rates, 10));
          const delivered = previewDelivered(order);
          dua(
            encodeCallback({ kind: 'payBalance', orderCode: code }),
            renderOrderDelivered(delivered, lang),
          );
          for (const method of enabledMethods) {
            const callback = encodeCallback({
              kind: 'method',
              orderCode: code,
              method: method.method,
            });
            const paid = previewOrder(
              product,
              variant,
              parsed.qty,
              code,
              previewPayment(order, method, rates.vndPerUsdt),
            );
            dua(
              callback,
              renderPaymentInstructions(paid, lang, rates, 10, method.accountHolder ?? ''),
            );
            if (method.method === 'mock') {
              dua(
                encodeCallback({ kind: 'mockConfirm', orderCode: code }),
                renderOrderDelivered(delivered, lang),
              );
            }
          }
          dua(
            encodeCallback({ kind: 'cancelOrder', orderCode: code }),
            renderOrderView({ ...order, status: 'CANCELLED' }, lang, rates, null),
          );
        }
      }
    }
    // Nút quay lại của chi tiết có thể trỏ c:pg chưa có (chế độ danh mục) —
    // cho về màn cửa hàng để giả lập không bấm vào khoảng không.
    for (const screen of Object.values(screens)) {
      for (const row of screen.keyboard) {
        for (const button of row) {
          const m = /^c:([0-9]+)$/.exec(button.callbackData);
          if (m && !screens[button.callbackData]) {
            screens[button.callbackData] = screens['c:1'];
          }
        }
      }
    }

    const input = query.text?.trim() ?? '';
    let entry = 'h';
    if (input !== '' && !input.startsWith('/start')) {
      const action = input.startsWith('/orders') ? 'orders' : matchMenuAction(input);
      const byAction = {
        shop: 'c:1',
        deposit: 'd',
        orders: 'o',
        account: 'a',
        support: 's',
      } as const;
      if (action && action !== 'search') {
        entry = byAction[action];
      } else if (action === 'search') {
        entry = 'search-prompt';
        dua(entry, { text: botDict(lang).searchPrompt, keyboard: [] });
      } else if (/^[0-9]{3,10}$/.test(input)) {
        const vnd = Number(input);
        if (vnd >= DEPOSIT_MIN_VND && vnd <= DEPOSIT_MAX_VND) {
          addDepositScreens(vnd);
          entry = 'deposit-confirm';
          dua(entry, renderDepositConfirm(vnd, lang));
        }
      } else {
        const matches = searchProducts(products, input);
        if (matches.length > 0) {
          entry = 'search-results';
          dua(entry, renderSearchResults(matches, input, lang, rates));
        }
      }
    }

    return {
      announcement: cfg.sendAnnouncement ? renderAnnouncement(announcement, lang) : null,
      entry,
      screens,
    };
  }
}
