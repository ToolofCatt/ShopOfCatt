import type { PaymentMethod, ProductVariantDto } from '@webcatt/shared';

interface Selection { productId: string; variantId: string; quantity: number; coupon: string; method: PaymentMethod | null }
interface StorageAccess { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
type Access = () => StorageAccess;
type PurchaseDraft = Selection & { version: 1; savedAt: number };
const methods: PaymentMethod[] = ['mock', 'binance_pay', 'binance_id', 'sepay', 'crypto_bep20', 'crypto_trc20'];
const draftKey = (id: string) => `customer-purchase:v1:${id}`;

export function savePurchaseDraft(storage: Access, selection: Selection, now = Date.now()): boolean {
  try {
    // Không spread input: không được lưu giá, token hay thông tin khách vào draft.
    const draft: PurchaseDraft = { version: 1, savedAt: now, productId: selection.productId, variantId: selection.variantId, quantity: selection.quantity, coupon: selection.coupon, method: selection.method };
    storage().setItem(draftKey(selection.productId), JSON.stringify(draft));
    return true;
  } catch { return false; }
}

export function readPurchaseDraft(storage: Access, productId: string, now = Date.now()): PurchaseDraft | null {
  try {
    const raw = storage().getItem(draftKey(productId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as PurchaseDraft;
    if (!draft || draft.version !== 1 || draft.productId !== productId || typeof draft.variantId !== 'string' ||
      !Number.isSafeInteger(draft.quantity) || draft.quantity < 1 || typeof draft.coupon !== 'string' || draft.coupon.length > 200 ||
      (draft.method !== null && !methods.includes(draft.method)) || !Number.isFinite(draft.savedAt) ||
      now < draft.savedAt || now - draft.savedAt >= 30 * 60 * 1000) {
      clearPurchaseDraft(storage, productId);
      return null;
    }
    return { version: 1, savedAt: draft.savedAt, productId, variantId: draft.variantId, quantity: draft.quantity, coupon: draft.coupon, method: draft.method };
  } catch { return null; }
}

export function clearPurchaseDraft(storage: Access, productId: string): void {
  try { storage().removeItem(draftKey(productId)); } catch { /* Storage có thể bị chặn ở chế độ riêng tư. */ }
}

export function revalidatePurchaseDraft(draft: Selection, variants: Pick<ProductVariantDto, 'id' | 'active' | 'availableStock'>[], enabled: PaymentMethod[]) {
  const available = variants.filter((variant) => variant.active);
  const selected = available.find((variant) => variant.id === draft.variantId) ?? available.find((variant) => variant.availableStock > 0) ?? available[0];
  const variantId = selected?.id ?? null;
  const quantity = Math.min(draft.quantity, Math.max(1, selected?.availableStock ?? 0));
  const method = draft.method && enabled.includes(draft.method) ? draft.method : enabled[0] ?? null;
  return { variantId, quantity, coupon: draft.coupon, method, changed: variantId !== draft.variantId || quantity !== draft.quantity || method !== draft.method || !selected?.availableStock };
}
