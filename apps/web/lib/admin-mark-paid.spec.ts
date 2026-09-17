import { describe, expect, it } from 'vitest';
import type { IncomingTransferDto, PaymentMode } from '@webcatt/shared';
import { buildMarkPaidRequest, canMarkPaidManually } from './admin-mark-paid';

const transfer: IncomingTransferDto = {
  id: 'transfer-observed', source: 'SEPAY', reference: 'tx-ref-100',
  amount: '100000.000000', currency: 'VND', receiver: 'account-123',
  status: 'OBSERVED', reviewReason: null, createdAt: '2026-09-17T00:00:00.000Z',
};
const externalModes: PaymentMode[] = ['CRYPTO', 'BINANCE_ID', 'SEPAY', 'BINANCE', 'INITIALIZING'];

describe('admin payment attribution payload', () => {
  it.each(externalModes)('requires an explicitly selected transfer for %s even with a note', (mode) => {
    expect(canMarkPaidManually(mode)).toBe(true);
    expect(buildMarkPaidRequest(mode, 'Verified receipt', '', [transfer])).toBeNull();
  });

  it.each(externalModes)('submits only the selected transfer id and trimmed note for %s', (mode) => {
    expect(buildMarkPaidRequest(mode, '  Verified receipt  ', transfer.id, [transfer])).toEqual({
      note: 'Verified receipt', incomingTransferId: 'transfer-observed',
    });
  });

  it('never selects the first or only transfer implicitly', () => {
    expect(buildMarkPaidRequest('SEPAY', 'Verified receipt', '', [transfer])).toBeNull();
  });

  it('does not submit a transfer absent from the current loaded list', () => {
    expect(buildMarkPaidRequest('SEPAY', 'Verified receipt', 'stale-transfer', [transfer])).toBeNull();
    expect(buildMarkPaidRequest('SEPAY', 'Verified receipt', transfer.id, [])).toBeNull();
  });

  it.each(['ATTRIBUTED', 'IGNORED', 'NEW_UNKNOWN_STATUS'])('rejects a transfer that is not available for review: %s', (status) => {
    expect(buildMarkPaidRequest('SEPAY', 'Verified receipt', transfer.id, [{ ...transfer, status }])).toBeNull();
  });

  it('never submits a provider-facts conflict through the ordinary review dialog', () => {
    expect(buildMarkPaidRequest('CRYPTO','Investigated',transfer.id,[{...transfer,status:'REVIEW',reviewReason:'provider-facts-changed'}])).toBeNull();
  });

  it('allows an explicitly reviewed transfer without copying sensitive or monetary fields into the request', () => {
    expect(buildMarkPaidRequest('CRYPTO', 'Manually reviewed', transfer.id, [{ ...transfer, status: 'REVIEW', reviewReason: 'Amount mismatch' }]))
      .toEqual({ note: 'Manually reviewed', incomingTransferId: transfer.id });
  });

  it.each(['', '   ', 'n'.repeat(301)])('rejects an absent or oversized audit note', (note) => {
    expect(buildMarkPaidRequest('SEPAY', note, transfer.id, [transfer])).toBeNull();
  });

  it.each(['MOCK', 'BALANCE', null, 'FUTURE_MODE'] as const)('refuses manual settlement entirely for %s', (mode) => {
    expect(canMarkPaidManually(mode as PaymentMode | null)).toBe(false);
    expect(buildMarkPaidRequest(mode as PaymentMode | null, 'Verified receipt', transfer.id, [transfer])).toBeNull();
    expect(buildMarkPaidRequest(mode as PaymentMode | null, 'Verified receipt', '', [transfer])).toBeNull();
  });
});
