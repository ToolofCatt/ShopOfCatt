import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveLocaleFromHeader, type Locale } from './locale';
import {
  K,
  isMessageKey,
  parseMessage,
  translate,
  type MessageParams,
} from './messages';

interface KeyedMessage {
  key: string;
  params?: MessageParams;
}

function isKeyedMessage(value: unknown): value is KeyedMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as KeyedMessage).key === 'string'
  );
}

/**
 * ValidationPipe của Nest gắn thêm đường dẫn thuộc tính vào trước message khi
 * DTO lồng nhau (ví dụ "items.0.order.variant_id_required"). Bóc dần các đoạn
 * đầu để tìm ra khoá thật, nếu không sẽ trả về nguyên văn khoá cho người dùng.
 */
function findMessageKey(raw: string): string | null {
  // Bọc lại để TypeScript không thu hẹp kiểu của biến lặp bên dưới
  const known = (candidate: string): boolean => isMessageKey(candidate);

  if (known(raw)) return raw;
  let rest = raw;
  let index = rest.indexOf('.');
  while (index !== -1) {
    rest = rest.slice(index + 1);
    if (known(rest)) return rest;
    index = rest.indexOf('.');
  }
  return null;
}

/** Dịch một phần tử message: khoá → câu đã dịch, còn lại giữ nguyên. */
function translateEntry(value: unknown, locale: Locale): unknown {
  if (isKeyedMessage(value)) return translate(value.key, locale, value.params ?? {});
  if (typeof value === 'string') {
    const found = findMessageKey(value);
    if (found) {
      const { key, params } = parseMessage(found);
      return translate(key, locale, params);
    }
  }
  return value;
}

/**
 * Bộ lọc ngoại lệ toàn cục: chuyển khoá thông báo thành câu đúng ngôn ngữ
 * người dùng (header Accept-Language) ngay trước khi trả response.
 * Các body đặc biệt (ví dụ webhook Binance trả returnCode) được giữ nguyên.
 */
@Catch()
export class I18nExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(I18nExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const locale = resolveLocaleFromHeader(request.headers['accept-language']);

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: translate(K.internalError, locale),
      });
      return;
    }

    const status = exception.getStatus();
    const body = exception.getResponse();

    // Ném bằng chuỗi thuần (hiếm) — Nest bọc thành object, nhưng phòng trường hợp
    if (typeof body === 'string') {
      response.status(status).json({
        statusCode: status,
        message: translateEntry(body, locale),
      });
      return;
    }

    if (typeof body !== 'object' || body === null) {
      response.status(status).json(body);
      return;
    }

    const source = body as Record<string, unknown>;

    // Ném bằng { key, params } — dùng cho thông báo có tham số
    if (isKeyedMessage(source) && !('message' in source)) {
      response.status(status).json({
        statusCode: status,
        message: translate(source.key, locale, source.params ?? {}),
      });
      return;
    }

    if (!('message' in source)) {
      // Body tuỳ biến (ví dụ webhook Binance: { returnCode, returnMessage })
      response.status(status).json(source);
      return;
    }

    const raw = source.message;
    const message = Array.isArray(raw)
      ? raw.map((item) => translateEntry(item, locale))
      : translateEntry(raw, locale);

    response.status(status).json({ ...source, message });
  }
}
