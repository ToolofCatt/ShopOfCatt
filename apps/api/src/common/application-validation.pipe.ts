import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { PartnerDepositInputDto, PartnerOrderInputDto, PartnerPageDto } from '../api-v1/partner-request';

export class ApplicationValidationPipe extends ValidationPipe {
  private readonly partnerValidation = new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true, transform: true,
  });

  constructor() {
    super({ whitelist: true, transform: true });
  }

  override transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    // Global pipe chạy trước controller: nếu strip trước thì typo maxTotalUsd
    // sẽ mất dấu và đơn vẫn mua không có trần. Chỉ DTO v1 đổi sang fail-closed;
    // web/Telegram và quản lý JWT giữ nguyên hành vi whitelist đang dùng.
    if (metadata.metatype === PartnerOrderInputDto || metadata.metatype === PartnerDepositInputDto || metadata.metatype === PartnerPageDto) {
      return this.partnerValidation.transform(value, metadata);
    }
    return super.transform(value, metadata);
  }
}
