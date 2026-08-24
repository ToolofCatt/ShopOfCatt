import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type {
  AdminStoreSettingDto,
  TelegramMessagePreview,
  TelegramPreviewDto,
  TelegramStatusDto,
} from '@webcatt/shared';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnnouncementService } from '../announcement/announcement.service';
import { LOCALES, type Locale } from '../i18n/locale';
import { ProductsService } from '../products/products.service';
import { SettingsService } from '../settings/settings.service';
import { UpdateTelegramSettingsDto } from '../settings/dto/update-telegram-settings.dto';
import {
  groupCategories,
  renderAnnouncement,
  renderCategoryProducts,
  renderHub,
  renderLanguageMenu,
  renderProductDetail,
  renderStorefront,
  renderSupport,
} from './catalog-view';
import { TelegramService } from './telegram.service';
import type { TgInlineKeyboard } from './telegram-api';

class TelegramPreviewQueryDto {
  @IsOptional()
  @IsIn(LOCALES)
  lang?: Locale;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

/** Đổi bàn phím kiểu Bot API (snake_case) sang DTO camelCase cho web. */
function toPreviewKeyboard(keyboard: TgInlineKeyboard) {
  return keyboard.map((row) =>
    row.map((button) => ({ text: button.text, callbackData: button.callback_data })),
  );
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

  @Get('preview')
  async preview(@Query() query: TelegramPreviewQueryDto): Promise<TelegramPreviewDto> {
    const lang = query.lang ?? 'vi';
    const [products, rates, support, cfg, announcement] = await Promise.all([
      this.products.list(lang),
      this.settings.getPublicRates(),
      this.settings.getSupportInfo(),
      this.settings.getTelegramConfig(),
      this.announcements.getPublic(lang),
    ]);

    /*
     * BẢN ĐỒ MÀN HÌNH khoá theo callback_data: giả lập bấm nút nào tra đúng
     * khoá đó — logic điều hướng nằm nguyên trong renderer của bot, trang
     * admin không chép lại gì để rồi lệch dần.
     */
    const screens: Record<string, TelegramMessagePreview> = {};
    const dua = (key: string, view: { text: string; keyboard: TgInlineKeyboard }) => {
      screens[key] = { text: view.text, keyboard: toPreviewKeyboard(view.keyboard) };
    };

    dua('h', renderHub('Khách', 0, lang, rates, cfg.greeting));
    dua('s', renderSupport(support.supportChannels, support.supportNote, lang));
    dua('lg', renderLanguageMenu(lang));

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
            renderProductDetail(
              product, lang, rates, support.supportChannels, Number(match[2]),
            ),
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

    return {
      announcement: cfg.sendAnnouncement ? renderAnnouncement(announcement, lang) : null,
      entry: 'h',
      screens,
    };
  }
}
