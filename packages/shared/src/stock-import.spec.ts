import { describe, expect, it } from 'vitest';
import { parseStockImport, StockImportError } from './stock-import';

describe('parseStockImport plain keys', () => {
  it.each([
    '123456789012345678901234567890',
    '9007199254740993',
    '1e6',
    '1E+09',
    '-0',
    '001234567890',
    '1.2300',
    'true',
    'null',
    '"KEY-A"',
  ])('preserves scalar-looking key %s without JSON coercion', (key) => {
    expect(parseStockImport(key)).toEqual({ kind: 'lines', items: [key] });
  });

  it('preserves a numeric first key and mixed plain lines', () => {
    expect(parseStockImport('9007199254740993\r\nKEY-A\n00123\n1e6\n')).toEqual({
      kind: 'lines',
      items: ['9007199254740993', 'KEY-A', '00123', '1e6'],
    });
  });

  it('keeps line trimming and blank input behavior', () => {
    expect(parseStockImport(' KEY-A \n\nKEY-B\r\n')).toEqual({
      kind: 'lines', items: ['KEY-A', 'KEY-B'],
    });
    expect(parseStockImport(' \r\n ')).toEqual({ kind: 'empty', items: [] });
  });
});

describe('parseStockImport structured compatibility', () => {
  it('compacts pretty objects and splits arrays', () => {
    expect(parseStockImport('{\n "key": "A"\n}')).toEqual({
      kind: 'json', items: ['{"key":"A"}'],
    });
    expect(parseStockImport('[{"key":"A"},{"key":"B"}]')).toEqual({
      kind: 'json-array', items: ['{"key":"A"}', '{"key":"B"}'],
    });
  });

  it('preserves export metadata around each account, including nested arrays', () => {
    const input = '[{"accounts":[{"id":1},{"id":2}],"proxies":[],"version":3}]';
    expect(parseStockImport(input)).toEqual({
      kind: 'json-array',
      items: [
        '{"accounts":[{"id":1}],"proxies":[],"version":3}',
        '{"accounts":[{"id":2}],"proxies":[],"version":3}',
      ],
    });
  });

  it('accepts structured NDJSON including normalized accounts exports', () => {
    expect(parseStockImport('{"accounts":[{"id":1}],"proxies":[]}\n{"key":"B"}')).toEqual({
      kind: 'json-lines',
      items: ['{"accounts":[{"id":1}],"proxies":[]}', '{"key":"B"}'],
    });
  });

  it.each(['{\n "accounts": [\n {"id":1}\n', '{"id":1}\n{"id":', '[{"id":1}', '{"id":1}\n1e6']) (
    'rejects malformed or mixed structured JSON without creating bracket items',
    (input) => {
      expect(() => parseStockImport(input)).toThrowError(new StockImportError('invalid-json'));
    },
  );

  it('keeps validation errors for empty arrays and invalid accounts', () => {
    expect(() => parseStockImport('[]')).toThrowError('no-items');
    expect(() => parseStockImport('{"accounts":{}}')).toThrowError('accounts-not-array');
    expect(() => parseStockImport('{"accounts":[]}')).toThrowError('no-items');
  });
});
