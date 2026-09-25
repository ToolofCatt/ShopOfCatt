import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export class MailSettingsInput {
  @IsOptional() @IsString() @MaxLength(500) token?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() currencyConfirmed?: boolean;
  @IsOptional() @Matches(/^\d{1,3}(\.\d{1,4})?$/) multiplier?: string;
  @IsOptional() @Matches(/^\d{1,5}(\.\d{1,6})?$/) maxOrderCost?: string;
  @IsOptional() @Matches(/^\d{1,6}(\.\d{1,6})?$/) maxDailyCost?: string;
}
export class MailOfferInput {
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Matches(/^\d{1,5}(\.\d{1,6})?$/) salePrice?: string;
  @IsOptional() @IsBoolean() useMultiplier?: boolean;
}
export class RentMailInput {
  @IsUUID() requestId!: string;
  @Matches(/^[A-Za-z0-9_-]{1,100}$/) offerCode!: string;
  @IsInt() @Min(1) @Max(10) quantity!: number;
  @Matches(/^\d{1,6}(\.\d{1,6})?$/) expectedUnitPrice!: string;
}
export class RefundMailInput {
  @IsBoolean() confirmedNoDelivery!: boolean;
  @IsString() @MaxLength(1000) reason!: string;
}
