import { describe, expect, it } from 'vitest';
import { parseStockImport, StockImportError } from './stock-import';

describe('parseStockImport', () => {
  it('keeps the existing one-line-per-item format', () => {
    expect(parseStockImport(' KEY-A \n\nKEY-B\r\n').items).toEqual(['KEY-A', 'KEY-B']);
  });

  it('splits a JSON array into compact items', () => {
    const parsed = parseStockImport(JSON.stringify([{ key: 'A' }, { key: 'B' }]));

    expect(parsed.kind).toBe('json-array');
    expect(parsed.items.map((item) => JSON.parse(item))).toEqual([
      { key: 'A' },
      { key: 'B' },
    ]);
  });

  it('also splits accounts nested inside a top-level export array', () => {
    const parsed = parseStockImport(
      JSON.stringify([
        { accounts: [{ id: 1 }, { id: 2 }], proxies: [] },
        { accounts: [{ id: 3 }], proxies: [] },
      ]),
    );

    expect(parsed.items.map((item) => JSON.parse(item).accounts[0].id)).toEqual([1, 2, 3]);
  });

  it('splits accounts while preserving the import wrapper', () => {
    const input = JSON.stringify({
      accounts: [{ name: 'first' }, { name: 'second' }, { name: 'third' }],
      exported_at: '2030-01-02T03:04:05Z',
      proxies: [{ id: 'shared-proxy' }],
    });

    const parsed = parseStockImport(input);
    const items = parsed.items.map((item) => JSON.parse(item));

    expect(parsed.kind).toBe('json-accounts');
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.accounts)).toEqual([
      [{ name: 'first' }],
      [{ name: 'second' }],
      [{ name: 'third' }],
    ]);
    expect(items.every((item) => item.exported_at === '2030-01-02T03:04:05Z')).toBe(true);
    expect(items.every((item) => item.proxies[0].id === 'shared-proxy')).toBe(true);
  });

  it('keeps a single JSON object as one stock item', () => {
    const parsed = parseStockImport('{\n  "login": "a@example.test",\n  "token": "x"\n}');

    expect(parsed.kind).toBe('json');
    expect(parsed.items).toEqual(['{"login":"a@example.test","token":"x"}']);
  });

  it('can parse normalized JSON lines again', () => {
    const first = parseStockImport(
      JSON.stringify({ accounts: [{ id: 1 }, { id: 2 }], proxies: [] }),
    );
    const second = parseStockImport(first.items.join('\n'));

    expect(second.kind).toBe('json-lines');
    expect(second.items).toEqual(first.items);
  });

  it('rejects malformed structured JSON instead of creating bracket items', () => {
    expect(() => parseStockImport('{\n  "accounts": [\n    {"id": 1}\n')).toThrow(
      StockImportError,
    );
    expect(() => parseStockImport('{"id":1}\n{"id":')).toThrowError('invalid-json');
  });

  it('rejects an invalid or empty accounts collection', () => {
    expect(() => parseStockImport('{"accounts":{}}')).toThrowError('accounts-not-array');
    expect(() => parseStockImport('{"accounts":[]}')).toThrowError('no-items');
  });
});
