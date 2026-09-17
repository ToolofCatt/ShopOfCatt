import { STOREFRONT_BUSINESS_BLOCKS, type StorefrontBlock, type StorefrontBlockType, type StorefrontLocale } from '@webcatt/shared';

export function builderBlockLocked(block: StorefrontBlock): boolean {
  return (STOREFRONT_BUSINESS_BLOCKS as readonly string[]).includes(block.type) || (block.children ?? []).some(builderBlockLocked);
}

export function builderTextFields(type: StorefrontBlockType): string[] {
  // Heading chỉ nhận text; title/body từng làm bản nháp bị parser chặt từ chối.
  if (type === 'heading') return ['text'];
  if (['banner', 'features', 'faq', 'contact'].includes(type)) return ['title', 'body'];
  if (type === 'richText') return ['html'];
  if (type === 'image') return ['alt'];
  return [];
}

export function builderLocalizedValue(block: StorefrontBlock, key: string, locale: StorefrontLocale): string {
  const value = block.props[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const exact = (value as Record<string, unknown>)[locale];
    return typeof exact === 'string' ? exact : '';
  }
  return typeof value === 'string' ? value : '';
}

export function setBuilderLocalized(block: StorefrontBlock, key: string, locale: StorefrontLocale, value: string) {
  const current = block.props[key];
  const row = current && typeof current === 'object' && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : { vi: '', en: '', zh: '' };
  row[locale] = value;
  block.props[key] = row;
}
