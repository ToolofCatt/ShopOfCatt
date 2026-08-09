import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { toPositiveInt } from '../../common/codes';
import { K } from '../../i18n/messages';

const ORDER_STATUSES = [
  'PENDING',
  'PAID',
  'DELIVERED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type OrderStatusFilter = (typeof ORDER_STATUSES)[number];

export class OrdersQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsIn(ORDER_STATUSES, { message: K.adminOrderStatusInvalid })
  status?: OrderStatusFilter;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString({ message: K.adminSearchInvalid })
  q?: string;

  /** Lọc theo khách hàng — trang chi tiết khách dùng bộ lọc này. */
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString({ message: K.adminUserIdInvalid })
  userId?: string;

  @IsOptional()
  @Transform(({ value }) => toPositiveInt(value))
  @IsInt({ message: K.adminPageInvalid })
  page?: number;

  @IsOptional()
  @Transform(({ value }) => toPositiveInt(value))
  @IsInt({ message: K.adminLimitInvalid })
  limit?: number;
}
