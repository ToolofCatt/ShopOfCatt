export type StockImportKind =
  | 'empty'
  | 'lines'
  | 'json'
  | 'json-array'
  | 'json-accounts'
  | 'json-lines';

export type StockImportErrorCode = 'invalid-json' | 'accounts-not-array' | 'no-items';

export class StockImportError extends Error {
  readonly code: StockImportErrorCode;

  constructor(code: StockImportErrorCode) {
    super(code);
    this.name = 'StockImportError';
    this.code = code;
  }
}

export interface ParsedStockImport {
  items: string[];
  kind: StockImportKind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new StockImportError('invalid-json');
  return serialized;
}

/**
 * Tách format export có `accounts` nhưng giữ lớp bao ngoài. Khách nhận một món
 * vẫn có thể import lại như file gốc, thay vì nhận một object account bị cụt.
 */
function splitJsonValue(value: unknown): ParsedStockImport {
  if (Array.isArray(value)) {
    if (value.length === 0) throw new StockImportError('no-items');
    return {
      items: value.flatMap((item) => splitJsonValue(item).items),
      kind: 'json-array',
    };
  }

  if (isRecord(value) && 'accounts' in value) {
    if (!Array.isArray(value.accounts)) {
      throw new StockImportError('accounts-not-array');
    }
    if (value.accounts.length === 0) throw new StockImportError('no-items');
    return {
      items: value.accounts.map((account) =>
        stringifyJson({ ...value, accounts: [account] }),
      ),
      kind: 'json-accounts',
    };
  }

  return { items: [stringifyJson(value)], kind: 'json' };
}

function tryParseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Chuẩn hóa mọi nguồn nhập thành NDJSON: mỗi chuỗi trong `items` là đúng một
 * StockItem. API vẫn nhận giao thức mỗi dòng một món nên không đụng tới khoá
 * transaction hoặc logic giao hàng.
 */
export function parseStockImport(input: string): ParsedStockImport {
  const trimmed = input.trim();
  if (trimmed === '') return { items: [], kind: 'empty' };

  const wholeJson = tryParseJson(trimmed);
  if (wholeJson.ok) return splitJsonValue(wholeJson.value);

  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  /*
   * Nội dung đã chuẩn hóa có thể gồm nhiều JSON compact, mỗi JSON một dòng.
   * Chỉ vào nhánh này khi dòng đầu tự nó là JSON hợp lệ; nhờ vậy một JSON pretty
   * bị hỏng không bị cắt thành hàng loạt StockItem chứa dấu ngoặc.
   */
  const firstLine = tryParseJson(lines[0] ?? '');
  if (firstLine.ok) {
    const items = lines.flatMap((line) => {
      const parsed = tryParseJson(line);
      if (!parsed.ok) throw new StockImportError('invalid-json');
      return splitJsonValue(parsed.value).items;
    });
    return { items, kind: 'json-lines' };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    throw new StockImportError('invalid-json');
  }

  return { items: lines, kind: 'lines' };
}
