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
  renderAnnouncement,
  renderProductDetail,
  renderStorefront,
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

    const storefront = renderStorefront(
      products,
      lang,
      rates,
      support.supportChannels,
      query.page ?? 1,
      cfg.greeting,
    );

    // Chỉ dựng chi tiết cho sản phẩm TRÊN TRANG hiện tại — nút của trang này
    // chỉ trỏ tới chúng, và cửa hàng nghìn sản phẩm không phải trả cả nghìn bản.
    const details: Record<string, TelegramMessagePreview> = {};
    for (const row of storefront.keyboard) {
      for (const button of row) {
        const match = /^p:([A-Za-z0-9_-]+):/.exec(button.callback_data);
        if (!match) continue;
        const product = products.find((p) => p.id === match[1]);
        if (!product) continue;
        const detail = renderProductDetail(
          product,
          lang,
          rates,
          support.supportChannels,
          storefront.page,
        );
        details[product.id] = {
          text: detail.text,
          keyboard: toPreviewKeyboard(detail.keyboard),
        };
      }
    }

    return {
      announcement: cfg.sendAnnouncement ? renderAnnouncement(announcement, lang) : null,
      storefront: {
        text: storefront.text,
        keyboard: toPreviewKeyboard(storefront.keyboard),
        page: storefront.page,
        totalPages: storefront.totalPages,
      },
      details,
    };
  }
}
