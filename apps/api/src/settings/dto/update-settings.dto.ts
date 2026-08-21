import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
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
  SUPPORT_FIELD_MAX_LENGTH,
  SUPPORT_NOTE_MAX_LENGTH,
  type AiProvider,
} from '@webcatt/shared';
import { K } from '../../i18n/messages';

export class SupportChannelInput {
  @IsString({ message: K.adminSupportContactInvalid })
  @IsNotEmpty({ message: K.adminSupportContactInvalid })
  @MaxLength(SUPPORT_FIELD_MAX_LENGTH, { message: K.adminSupportContactInvalid })
  label: string;

  @IsString({ message: K.adminSupportContactInvalid })
  @IsNotEmpty({ message: K.adminSupportContactInvalid })
  @MaxLength(SUPPORT_FIELD_MAX_LENGTH, { message: K.adminSupportContactInvalid })
  value: string;

  @IsOptional()
  @IsString({ message: K.adminSupportUrlInvalid })
  @MaxLength(300, { message: K.adminSupportUrlInvalid })
  url?: string;
}

export class UpdateSettingsDto {
  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  mockEnabled: boolean;

  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  binancePayEnabled: boolean;

  /** Nhận tiền bằng cách khách chuyển thẳng tới Binance ID của chủ shop. */
  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  binanceIdEnabled: boolean;

  /**
   * Binance ID — chỉ gồm chữ số. Không ép độ dài cố định vì Binance có thể đổi,
   * nhưng chặn ký tự lạ để chủ shop không dán nhầm tên hiển thị vào đây rồi
   * khách chuyển tiền tới hư không.
   */
  @IsString({ message: K.adminBinanceIdInvalid })
  @Matches(/^[0-9]*$/, { message: K.adminBinanceIdInvalid })
  @MaxLength(32, { message: K.adminBinanceIdInvalid })
  binanceId: string;

  /**
   * Ảnh QR nhận tiền Binance Pay, data URI đã nén ở trình duyệt.
   *
   * Dùng mức chặn của ảnh LỚN chứ không phải ảnh nhỏ: mã QR cần nét, nén mạnh
   * là các ô vuông nhoè và máy quét đọc không ra. Chỉ một ảnh cho cả cửa hàng
   * nên vài trăm KB trong CSDL là chấp nhận được.
   */
  @IsOptional()
  @IsString({ message: K.adminImageInvalid })
  @MaxLength(PRODUCT_IMAGE_MAX_LENGTH, { message: K.adminImageTooLarge })
  binanceQr?: string;

  /**
   * Chuẩn giao thức của dịch vụ AI. `IsIn` lấy thẳng từ AI_PROVIDERS trong
   * shared, nên thêm nhà cung cấp mới ở đó là chỗ này tự nhận.
   */
  @IsOptional()
  @IsIn(AI_PROVIDERS, { message: K.adminAiProviderInvalid })
  aiProvider?: AiProvider;

  /** Địa chỉ gốc API. Rỗng = mặc định của nhà cung cấp. */
  @IsOptional()
  @IsString({ message: K.adminAiBaseUrlInvalid })
  @MaxLength(300, { message: K.adminAiBaseUrlInvalid })
  aiBaseUrl?: string;

  /** Tên model. Rỗng = mặc định. */
  @IsOptional()
  @IsString({ message: K.adminAiModelInvalid })
  @MaxLength(120, { message: K.adminAiModelInvalid })
  aiModel?: string;

  /**
   * Khoá API cho dịch tự động.
   *
   * Ba trạng thái, đừng gộp lại: KHÔNG gửi trường này = giữ nguyên khoá cũ
   * (trang quản trị không bao giờ nhận được khoá nên không gửi ngược lên được),
   * gửi chuỗi rỗng = xoá khoá, gửi chuỗi khác = đặt khoá mới.
   */
  @IsOptional()
  @IsString({ message: K.adminAiKeyInvalid })
  @MaxLength(300, { message: K.adminAiKeyInvalid })
  aiApiKey?: string;

  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  cryptoEnabled: boolean;

  /** SePay — nhận chuyển khoản ngân hàng VND. */
  @IsBoolean({ message: K.adminSettingsFlagInvalid })
  sepayEnabled: boolean;

  /** Số tài khoản: chữ số, có thể có gạch ngang ở một số ngân hàng. */
  @IsString({ message: K.adminSepayAccountInvalid })
  @Matches(/^[0-9-]*$/, { message: K.adminSepayAccountInvalid })
  @MaxLength(32, { message: K.adminSepayAccountInvalid })
  sepayAccountNumber: string;

  /** Tên ngắn ngân hàng ("Vietcombank") hoặc mã BIN. */
  @IsString({ message: K.adminSepayBankInvalid })
  @MaxLength(50, { message: K.adminSepayBankInvalid })
  sepayBank: string;

  @IsString({ message: K.adminSepayHolderInvalid })
  @MaxLength(100, { message: K.adminSepayHolderInvalid })
  sepayAccountHolder: string;

  /**
   * Bao nhiêu VND cho 1 USDT.
   *
   * `Max` không phải để phòng chủ shop gõ số lớn thật, mà để một lần gõ lệch tay
   * (thêm ba số 0) không dựng ra số tiền vô nghĩa rồi báo cho khách.
   */
  @IsNumber({ maxDecimalPlaces: 2 }, { message: K.adminVndRateInvalid })
  @Min(0, { message: K.adminVndRateInvalid })
  @Max(10_000_000, { message: K.adminVndRateInvalid })
  vndPerUsdt: number;

  /**
   * Khoá API webhook SePay. Ba trạng thái như khoá AI: không gửi = giữ nguyên,
   * gửi rỗng = xoá, gửi chuỗi = đặt mới.
   */
  @IsOptional()
  @IsString({ message: K.adminSepayApiKeyInvalid })
  @MaxLength(200, { message: K.adminSepayApiKeyInvalid })
  sepayApiKey?: string;

  /** Khoá bí mật HMAC (tuỳ chọn). Cùng ba trạng thái như trên. */
  @IsOptional()
  @IsString({ message: K.adminSepayApiKeyInvalid })
  @MaxLength(200, { message: K.adminSepayApiKeyInvalid })
  sepayWebhookSecret?: string;

  @IsString({ message: K.adminSettingsAddressInvalid })
  bep20Address: string;

  @IsString({ message: K.adminSettingsAddressInvalid })
  trc20Address: string;

  /** Các kênh liên hệ hỗ trợ hiện ở khối "Quên mật khẩu". */
  @IsOptional()
  @IsArray({ message: K.adminSupportContactInvalid })
  @ArrayMaxSize(SUPPORT_CHANNELS_MAX, { message: K.adminSupportTooMany })
  @ValidateNested({ each: true })
  @Type(() => SupportChannelInput)
  supportChannels?: SupportChannelInput[];

  /** Lời nhắn tùy chỉnh ở khối "Quên mật khẩu". */
  @IsOptional()
  @IsString({ message: K.adminSupportNoteInvalid })
  @MaxLength(SUPPORT_NOTE_MAX_LENGTH, { message: K.adminSupportNoteInvalid })
  supportNote?: string;
}
