export interface MailOfferDto {
  code: string;
  name: string;
  category: 'gmail-api' | 'gmail-account';
  price: string;
  priceCurrency: 'VND' | 'USDT';
  priceAmount: string;
  purchasable: boolean;
  stock: number;
  active: boolean;
  syncedAt: string;
}
export interface MailCatalogDto {
  offers: MailOfferDto[];
  purchaseEnabled: boolean;
  stale: boolean;
  syncedAt: string | null;
}
export interface MailProviderSettingDto {
  tokenSet: boolean;
  tokenSuffix: string;
  enabled: boolean;
  currencyConfirmed: boolean;
  multiplier: string;
  maxOrderCost: string;
  maxDailyCost: string;
  syncedAt: string | null;
  lastSyncFailed: boolean;
}
export interface MailPurchaseDto {
  id: string;
  offerCode: string;
  serviceName: string;
  quantity: number;
  total: string;
  status: 'REQUESTING' | 'DELIVERED' | 'REVIEW' | 'REFUNDED';
  createdAt: string;
}
export interface MailboxDto {
  id: string;
  purchaseId: string;
  email: string;
  service: string;
  price: string;
  priceCurrency: 'VND' | 'USDT';
  priceAmount: string;
  closed: boolean;
  canRead: boolean;
  pollFailed: boolean;
  codes: { id: string; code: string; receivedAt: string }[];
}
export interface MailWorkspaceDto {
  balance: string;
  mailboxes: MailboxDto[];
  purchases: MailPurchaseDto[];
  nextCursor: string | null;
}
export type MailPriceCurrency = 'VND' | 'USDT';
export interface MailOfferPriceInput {
  active?: boolean;
  useMultiplier?: boolean;
  saleCurrency?: MailPriceCurrency;
  saleAmount?: string;
}
export interface AdminMailOfferDto extends MailOfferDto { cost: string; salePrice: string | null; saleCurrency: MailPriceCurrency; saleAmount: string | null }
export interface AdminMailCatalogDto extends Omit<MailCatalogDto, 'offers'> { offers: AdminMailOfferDto[] }
export interface AdminMailPurchaseDto extends MailPurchaseDto { userCode: number; providerOrderNo: string | null; expectedCost: string; actualCost: string | null }
