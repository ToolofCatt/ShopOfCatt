import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AI_PROVIDERS,
  PRODUCT_IMAGE_MAX_LENGTH,
  SUPPORT_CHANNELS_MAX,
  SUPPORT_NOTE_MAX_LENGTH,
  type AiProvider,
} from '@webcatt/shared';
import { K } from '../../i18n/messages';
import { SupportChannelInput } from './update-settings.dto';

/** PATCH chỉ chứa trường của tab thanh toán; thiếu trường nghĩa là giữ nguyên. */
export class PatchPaymentSettingsDto {
  @IsOptional() @IsBoolean({ message: K.adminSettingsFlagInvalid }) mockEnabled?: boolean;
  @IsOptional() @IsBoolean({ message: K.adminSettingsFlagInvalid }) binancePayEnabled?: boolean;
  @IsOptional() @IsBoolean({ message: K.adminSettingsFlagInvalid }) binanceIdEnabled?: boolean;
  @IsOptional() @IsString({ message: K.adminBinanceIdInvalid }) @Matches(/^[0-9]*$/, { message: K.adminBinanceIdInvalid }) @MaxLength(32, { message: K.adminBinanceIdInvalid }) binanceId?: string;
  @IsOptional() @IsString({ message: K.adminImageInvalid }) @MaxLength(PRODUCT_IMAGE_MAX_LENGTH, { message: K.adminImageTooLarge }) binanceQr?: string;
  @IsOptional() @IsBoolean({ message: K.adminSettingsFlagInvalid }) cryptoEnabled?: boolean;
  @IsOptional() @IsString({ message: K.adminSettingsAddressInvalid }) bep20Address?: string;
  @IsOptional() @IsString({ message: K.adminSettingsAddressInvalid }) trc20Address?: string;
  @IsOptional() @IsBoolean({ message: K.adminSettingsFlagInvalid }) sepayEnabled?: boolean;
  @IsOptional() @IsString({ message: K.adminSepayAccountInvalid }) @Matches(/^[0-9-]*$/, { message: K.adminSepayAccountInvalid }) @MaxLength(32, { message: K.adminSepayAccountInvalid }) sepayAccountNumber?: string;
  @IsOptional() @IsString({ message: K.adminSepayBankInvalid }) @MaxLength(50, { message: K.adminSepayBankInvalid }) sepayBank?: string;
  @IsOptional() @IsString({ message: K.adminSepayHolderInvalid }) @MaxLength(100, { message: K.adminSepayHolderInvalid }) sepayAccountHolder?: string;
  @IsOptional() @IsString({ message: K.adminSepayApiKeyInvalid }) @MaxLength(200, { message: K.adminSepayApiKeyInvalid }) sepayApiKey?: string;
  @IsOptional() @IsString({ message: K.adminSepayApiKeyInvalid }) @MaxLength(200, { message: K.adminSepayApiKeyInvalid }) sepayWebhookSecret?: string;
}

export class PatchRateSettingsDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: K.adminVndRateInvalid }) @Min(0, { message: K.adminVndRateInvalid }) @Max(10_000_000, { message: K.adminVndRateInvalid }) vndPerUsdt?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }, { message: K.adminCnyRateInvalid }) @Min(0, { message: K.adminCnyRateInvalid }) @Max(10_000, { message: K.adminCnyRateInvalid }) cnyPerUsdt?: number;
  @IsOptional() @IsBoolean({ message: K.adminSettingsFlagInvalid }) rateAuto?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: K.adminRateMarkupInvalid }) @Min(0, { message: K.adminRateMarkupInvalid }) @Max(50, { message: K.adminRateMarkupInvalid }) rateMarkupPercent?: number;
  @IsOptional() @IsInt({ message: K.adminRateHourInvalid }) @Min(0, { message: K.adminRateHourInvalid }) @Max(23, { message: K.adminRateHourInvalid }) rateHour?: number;
}

export class PatchSupportSettingsDto {
  @IsOptional() @IsArray({ message: K.adminSupportContactInvalid }) @ArrayMaxSize(SUPPORT_CHANNELS_MAX, { message: K.adminSupportTooMany }) @ValidateNested({ each: true }) @Type(() => SupportChannelInput) supportChannels?: SupportChannelInput[];
  @IsOptional() @IsString({ message: K.adminSupportNoteInvalid }) @MaxLength(SUPPORT_NOTE_MAX_LENGTH, { message: K.adminSupportNoteInvalid }) supportNote?: string;
}

export class PatchAiSettingsDto {
  @IsOptional() @IsIn(AI_PROVIDERS, { message: K.adminAiProviderInvalid }) aiProvider?: AiProvider;
  @IsOptional() @IsString({ message: K.adminAiBaseUrlInvalid }) @MaxLength(300, { message: K.adminAiBaseUrlInvalid }) aiBaseUrl?: string;
  @IsOptional() @IsString({ message: K.adminAiModelInvalid }) @MaxLength(120, { message: K.adminAiModelInvalid }) aiModel?: string;
  @IsOptional() @IsString({ message: K.adminAiKeyInvalid }) @MaxLength(300, { message: K.adminAiKeyInvalid }) aiApiKey?: string;
}
