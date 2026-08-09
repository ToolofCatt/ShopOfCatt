import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { K } from '../../i18n/messages';

export class AddStockDto {
  @IsString({ message: K.adminStockContentInvalid })
  @IsNotEmpty({ message: K.adminStockContentRequired })
  content: string;

  @IsOptional()
  @IsBoolean({ message: K.adminStockDedupeInvalid })
  dedupe?: boolean;
}
