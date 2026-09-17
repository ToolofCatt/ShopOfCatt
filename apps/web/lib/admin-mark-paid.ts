import type { IncomingTransferDto, PaymentMode } from '@webcatt/shared';

export function canMarkPaidManually(mode: PaymentMode | null): boolean {
  return mode === 'CRYPTO' || mode === 'BINANCE_ID' || mode === 'SEPAY' || mode === 'BINANCE' || mode === 'INITIALIZING';
}

export function buildMarkPaidRequest(
  mode: PaymentMode | null,
  note: string,
  selectedId: string,
  transfers: IncomingTransferDto[],
): { note: string; incomingTransferId: string } | null {
  const trimmed = note.trim();
  if (!canMarkPaidManually(mode) || !trimmed || trimmed.length > 300 || !selectedId) return null;
  const selected = transfers.find((entry) => entry.id === selectedId);
  if (!selected || (selected.status !== 'OBSERVED' && selected.status !== 'REVIEW') || selected.reviewReason === 'provider-facts-changed') return null;
  // Ghi chú không chứng minh đã nhận tiền; chỉ gửi ID người vận hành tự chọn.
  // Số tiền/receiver vẫn do API đối chiếu, không sao chép dữ liệu tài chính vào POST.
  return { note: trimmed, incomingTransferId: selected.id };
}
