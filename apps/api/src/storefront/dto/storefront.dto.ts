import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { StorefrontDocument } from '@webcatt/shared';
import { STOREFRONT_PAGE_KINDS } from '@webcatt/shared';

export class UpdateStorefrontDraftDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsObject()
  document: StorefrontDocument;
}

export class UploadStoreMediaDto {
  @IsString()
  @MaxLength(1_500_000)
  data: string;
}

export class SetMaintenanceDto {
  @IsBoolean()
  enabled: boolean;
}

export class SetSetupStepDto {
  @IsIn(['system', 'design', 'payments', 'channels', 'catalog', 'review'])
  step: 'system' | 'design' | 'payments' | 'channels' | 'catalog' | 'review';
}

export class PreviewPageQueryDto {
  @IsIn(STOREFRONT_PAGE_KINDS)
  page: (typeof STOREFRONT_PAGE_KINDS)[number];
}

export class RevisionLimitQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 20;
}
