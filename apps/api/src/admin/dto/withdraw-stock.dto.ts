import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { STOCK_DRAW_MODES, type StockDrawMode } from '@webcatt/shared';
import { toPositiveInt } from '../../common/codes';
import { K } from '../../i18n/messages';

/** Chặn một cú bấm lỡ tay rút sạch kho của một loại hàng bán chạy. */
export const WITHDRAW_MAX = 500;

export class WithdrawStockDto {
  @Transform(({ value }) => toPositiveInt(value))
  @IsInt({ message: K.adminWithdrawQuantityInvalid })
  @Min(1, { message: K.adminWithdrawQuantityInvalid })
  @Max(WITHDRAW_MAX, { message: K.adminWithdrawTooMany })
  quantity: number;

  /** Thứ tự rút. Bỏ trống = tuần tự (cũ trước). */
  @IsOptional()
  @IsIn(STOCK_DRAW_MODES, { message: K.adminStockDrawModeInvalid })
  mode?: StockDrawMode;
}
