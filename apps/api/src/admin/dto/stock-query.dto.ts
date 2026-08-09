import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { toPositiveInt } from '../../common/codes';
import { K } from '../../i18n/messages';

const STOCK_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD'] as const;
export type StockStatusFilter = (typeof STOCK_STATUSES)[number];

export class StockQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsIn(STOCK_STATUSES, { message: K.adminStockStatusInvalid })
  status?: StockStatusFilter;

  @IsOptional()
  @Transform(({ value }) => toPositiveInt(value))
  @IsInt({ message: K.adminPageInvalid })
  page?: number;

  @IsOptional()
  @Transform(({ value }) => toPositiveInt(value))
  @IsInt({ message: K.adminLimitInvalid })
  limit?: number;
}
