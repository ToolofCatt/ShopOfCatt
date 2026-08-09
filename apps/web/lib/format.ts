/**
 * Số USDT on-chain phải hiển thị ĐÚNG từng chữ số lẻ (đơn có phần lẻ duy nhất
 * k×0.0001 để nhận diện) — không được làm tròn 2 chữ số như formatUsdt.
 * Giữ tối đa 6 và tối thiểu 2 chữ số thập phân: 8.5003 → "8.5003", 9 → "9.00".
 */
export function formatCryptoAmount(amount: number): string {
  const trimmed = amount.toFixed(6).replace(/0+$/, '');
  const [whole, decimals = ''] = trimmed.split('.');
  return `${whole}.${decimals.padEnd(2, '0')}`;
}
