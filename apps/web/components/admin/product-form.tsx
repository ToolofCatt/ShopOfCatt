'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Eye,
  FileImage,
  Languages,
  Layers,
  Save,
  Settings2,
} from 'lucide-react';
import {
  STOCK_DRAW_MODES,
  TRANSLATABLE_LOCALES,
  type DisplayCurrency,
  type ProductDto,
  type ProductImageDto,
  type StockDrawMode,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { PriceInput } from '@/components/admin/price-input';
import { Button, Card, Field, Input, buttonVariants } from '@/components/ui';
import { TEXTAREA_CLASSES, localeLabel } from '@/components/admin/helpers';
import { GalleryPicker } from '@/components/admin/gallery-picker';
import { ImagePicker } from '@/components/admin/image-picker';
import type { CompressedPair } from '@/lib/image-compress';
import { ProductPreview } from '@/components/admin/product-preview';
import { ToggleRow } from '@/components/admin/toggle-row';
import { TranslationSection, type TranslationBlock } from '@/components/admin/translation';
import { VariantManager } from '@/components/admin/variant-manager';
import { VariantStockPanel } from '@/components/admin/variant-stock-panel';
import {
  PRODUCT_EDITOR_TABS,
  ProductEditorTabs,
  productPanelId,
  productTabId,
  type ProductEditorTab,
  type ProductEditorTabItem,
} from '@/components/admin/product-editor-tabs';
import { cn } from '@/lib/cn';

interface ProductFieldErrors {
  name?: string;
  price?: string;
  sortOrder?: string;
}

interface ProductDraft {
  name: string;
  slug: string;
  price: string;
  priceCurrency: DisplayCurrency;
  category: string;
  shortDescription: string;
  description: string;
  sortOrder: string;
  active: boolean;
  stockDrawMode: StockDrawMode;
}

const CREATE_TABS: readonly ProductEditorTab[] = ['overview', 'content', 'preview'];

function makeDraft(product?: ProductDto): ProductDraft {
  return {
    name: product?.name ?? '',
    slug: product?.slug ?? '',
    price: '',
    priceCurrency: 'USDT',
    category: product?.category ?? '',
    shortDescription: product?.shortDescription ?? '',
    description: product?.description ?? '',
    sortOrder: product ? String(product.sortOrder) : '0',
    active: product?.active ?? true,
    stockDrawMode: product?.stockDrawMode ?? 'SEQUENTIAL',
  };
}

function draftKey(draft: ProductDraft): string {
  return JSON.stringify(draft);
}

function isEditorTab(value: string | null): value is ProductEditorTab {
  return value !== null && PRODUCT_EDITOR_TABS.some((tab) => tab === value);
}

function TabPanel({
  tab,
  activeTab,
  children,
  className,
}: {
  tab: ProductEditorTab;
  activeTab: ProductEditorTab;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={productPanelId(tab)}
      role="tabpanel"
      aria-labelledby={productTabId(tab)}
      tabIndex={0}
      hidden={activeTab !== tab}
      className={cn('focus:outline-none', className)}
    >
      {children}
    </section>
  );
}

export interface ProductFormProps {
  /** Khi có sản phẩm → chế độ sửa (PATCH); không có → tạo mới (POST). */
  product?: ProductDto;
  /** Sản phẩm vừa được lưu/dịch/đổi ảnh — cha cập nhật tiêu đề và số liệu. */
  onProductUpdated?: (product: ProductDto) => void;
  /** Nạp lại sản phẩm sau khi thêm/sửa/xóa loại. */
  onProductRefresh?: () => Promise<void> | void;
  /** Nạp lại bộ đếm sau thao tác kho; lỗi không chặn thao tác vừa hoàn thành. */
  onStockChanged?: () => void;
}

export function ProductForm({
  product,
  onProductUpdated,
  onProductRefresh,
  onStockChanged,
}: ProductFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { token } = useAuth();
  const { t } = useI18n();
  const isEdit = Boolean(product);

  /*
   * Một bản nháp sống xuyên suốt mọi tab. Nạp lại product để cập nhật kho/giá
   * không được phép ghi đè phần chủ shop đang gõ nhưng chưa bấm Lưu.
   */
  const [draft, setDraft] = useState<ProductDraft>(() => makeDraft(product));
  const [savedDraft, setSavedDraft] = useState<ProductDraft>(() => makeDraft(product));
  const [imagePick, setImagePick] = useState<CompressedPair | null>(null);
  const image = imagePick ? imagePick.image : (product?.image ?? '');

  /* Ảnh phụ lưu tức thời, độc lập với bản nháp của biểu mẫu. */
  const [images, setImages] = useState<ProductImageDto[]>(product?.images ?? []);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<ProductFieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedOnce, setSavedOnce] = useState(isEdit);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  const allowedTabs = isEdit ? PRODUCT_EDITOR_TABS : CREATE_TABS;
  const requestedTab = searchParams.get('tab');
  const activeTab =
    isEditorTab(requestedTab) && allowedTabs.includes(requestedTab) ? requestedTab : 'overview';

  const setActiveTab = (next: ProductEditorTab) => {
    if (!allowedTabs.includes(next)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // URL cũ, tab sai hoặc chưa có `tab` đều được chuẩn hóa để có thể copy link.
  useEffect(() => {
    if (requestedTab === activeTab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', activeTab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [activeTab, pathname, requestedTab, router, searchParams]);

  useEffect(() => {
    if (!pendingFocus || activeTab !== 'overview') return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(pendingFocus)?.focus();
      setPendingFocus(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, pendingFocus]);

  const tabItems = useMemo<ProductEditorTabItem[]>(() => {
    const all: ProductEditorTabItem[] = [
      { value: 'overview', label: t.admin.productTabOverview, icon: Settings2 },
      { value: 'content', label: t.admin.productTabContent, icon: FileImage },
      {
        value: 'variants',
        label: t.admin.productTabVariants,
        icon: Layers,
        count: product?.variants.length ?? 0,
      },
      {
        value: 'stock',
        label: t.admin.productTabStock,
        icon: Boxes,
        count: product?.availableStock ?? 0,
      },
      { value: 'translations', label: t.admin.productTabTranslations, icon: Languages },
      { value: 'preview', label: t.admin.productTabPreview, icon: Eye },
    ];
    return all.filter((item) => allowedTabs.includes(item.value));
  }, [allowedTabs, product?.availableStock, product?.variants.length, t]);

  const dirty = draftKey(draft) !== draftKey(savedDraft) || imagePick !== null;

  const updateDraft = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaveError(null);
  };

  const validate = (): ProductFieldErrors | null => {
    const errors: ProductFieldErrors = {};
    if (!draft.name.trim()) errors.name = t.admin.errNameRequired;

    if (!isEdit) {
      const priceNumber = Number(draft.price);
      if (
        draft.price.trim() === '' ||
        !Number.isFinite(priceNumber) ||
        priceNumber < 0
      ) {
        errors.price = t.admin.errPriceInvalid;
      }
    }

    const sortOrderNumber = draft.sortOrder.trim() === '' ? 0 : Number(draft.sortOrder);
    if (!Number.isInteger(sortOrderNumber)) errors.sortOrder = t.admin.errSortOrderInvalid;
    return Object.keys(errors).length > 0 ? errors : null;
  };

  const focusFirstError = (errors: ProductFieldErrors) => {
    setActiveTab('overview');
    if (errors.name) setPendingFocus('product-name');
    else if (errors.price) setPendingFocus('product-price');
    else if (errors.sortOrder) setPendingFocus('product-sort-order');
  };

  const buildBody = (): Record<string, unknown> => {
    const optional = (value: string): string | null | undefined => {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      return isEdit ? null : undefined;
    };

    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      sortOrder: draft.sortOrder.trim() === '' ? 0 : Number(draft.sortOrder),
      active: draft.active,
      stockDrawMode: draft.stockDrawMode,
      shortDescription: optional(draft.shortDescription),
      description: optional(draft.description),
      category: optional(draft.category),
      // Chỉ gửi ảnh khi chủ shop thực sự đổi; gửi lại URL ảnh cũ sẽ phá dữ liệu base64.
      ...(imagePick
        ? {
            image: optional(imagePick.image),
            thumbnail: optional(imagePick.thumbnail),
          }
        : {}),
    };
    if (!isEdit) {
      body.price = Number(draft.price);
      body.priceCurrency = draft.priceCurrency;
    }
    if (draft.slug.trim()) body.slug = draft.slug.trim();
    for (const key of Object.keys(body)) {
      if (body[key] === undefined) delete body[key];
    }
    return body;
  };

  /** Lưu một lần cho cả Tổng quan và Nội dung, bất kể tab hiện tại. */
  const persistDraft = async (): Promise<ProductDto> => {
    if (submitting) throw new Error(t.admin.productDraftSaving);

    const errors = validate();
    setFieldErrors(errors ?? {});
    if (errors) {
      setSaveError(t.admin.productDraftInvalid);
      focusFirstError(errors);
      throw new Error(t.admin.translateFixForm);
    }

    setSubmitting(true);
    setSaveError(null);
    try {
      const updated =
        isEdit && product
          ? await apiFetch<ProductDto>(`/admin/products/${product.id}`, {
              method: 'PATCH',
              body: buildBody(),
              token,
            })
          : await apiFetch<ProductDto>('/admin/products', {
              method: 'POST',
              body: buildBody(),
              token,
            });

      const normalized = makeDraft(updated);
      setDraft(normalized);
      setSavedDraft(normalized);
      setImagePick(null);
      setSavedOnce(true);
      onProductUpdated?.(updated);

      if (!isEdit) router.push(`/admin/products/${updated.id}?tab=variants`);
      return updated;
    } catch (err) {
      setSaveError(apiErrorMessage(err, t.common.connectionError));
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty || submitting) return;
    try {
      await persistDraft();
    } catch {
      // Lỗi đã nằm cạnh trường và trong thanh lưu cố định.
    }
  };

  /** Lưu bản tiếng Việt đang gõ rồi mới dịch để hai bản luôn cùng phiên bản. */
  const handleTranslate = async () => {
    if (!product) return;
    if (dirty) await persistDraft();
    else {
      const errors = validate();
      setFieldErrors(errors ?? {});
      if (errors) {
        setSaveError(t.admin.productDraftInvalid);
        focusFirstError(errors);
        throw new Error(t.admin.translateFixForm);
      }
    }

    const translated = await apiFetch<ProductDto>(`/admin/products/${product.id}/translate`, {
      method: 'POST',
      token,
    });
    onProductUpdated?.(translated);
  };

  /**
   * Ảnh phụ đã được lưu riêng ngay khi thao tác. Không trộn nó vào snapshot của
   * form, nếu không bấm Lưu sau đó có thể ghi đè kết quả mới bằng dữ liệu cũ.
   */
  const runGallery = async (action: () => Promise<ProductDto>): Promise<boolean> => {
    setGalleryBusy(true);
    setGalleryError(null);
    try {
      const updated = await action();
      setImages(updated.images);
      onProductUpdated?.(updated);
      return true;
    } catch (err) {
      setGalleryError(apiErrorMessage(err, t.common.connectionError));
      return false;
    } finally {
      setGalleryBusy(false);
    }
  };

  const handleAddImage = (data: string) =>
    runGallery(() =>
      apiFetch<ProductDto>(`/admin/products/${product?.id}/images`, {
        method: 'POST',
        body: { data },
        token,
      }),
    );

  const handleRemoveImage = async (imageId: string) => {
    await runGallery(() =>
      apiFetch<ProductDto>(`/admin/images/${imageId}`, { method: 'DELETE', token }),
    );
  };

  const handleMoveImage = async (imageId: string, direction: -1 | 1) => {
    const from = images.findIndex((item) => item.id === imageId);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= images.length) return;
    const ids = images.map((item) => item.id);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await runGallery(() =>
      apiFetch<ProductDto>(`/admin/products/${product?.id}/images/order`, {
        method: 'PATCH',
        body: { ids },
        token,
      }),
    );
  };

  const translationBlocks: TranslationBlock[] = product
    ? TRANSLATABLE_LOCALES.map((locale) => ({
        locale,
        label: localeLabel(locale, t),
        fields: [
          { label: t.admin.transFieldName, value: product.translations?.[locale]?.name ?? '' },
          {
            label: t.admin.transFieldShortDescription,
            value: product.translations?.[locale]?.shortDescription ?? '',
          },
          {
            label: t.admin.transFieldCategory,
            value: product.translations?.[locale]?.category ?? '',
          },
          {
            label: t.admin.transFieldDescription,
            value: product.translations?.[locale]?.description ?? '',
            multiline: true,
          },
          ...product.variants.map((variant) => ({
            label: t.admin.transFieldVariantName(variant.name),
            value: variant.translations?.[locale]?.name ?? '',
          })),
        ],
      }))
    : [];

  const status = submitting
    ? t.admin.productDraftSaving
    : saveError
      ? t.admin.productDraftError
      : dirty || !savedOnce
        ? t.admin.productDraftUnsaved
        : t.admin.productDraftSaved;

  return (
    <div className="pb-24">
      <ProductEditorTabs
        items={tabItems}
        value={activeTab}
        onChange={setActiveTab}
        ariaLabel={t.admin.productTabsAria}
      />

      <form id="product-editor-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <TabPanel tab="overview" activeTab={activeTab}>
          <Card className="p-5 sm:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
                {t.admin.productOverviewTitle}
              </h2>
              <p className="mt-1 text-sm text-neutral-500">{t.admin.productOverviewHint}</p>
            </div>

            <div className="space-y-4">
              <Field label={t.admin.formName} htmlFor="product-name" error={fieldErrors.name}>
                <Input
                  id="product-name"
                  value={draft.name}
                  invalid={Boolean(fieldErrors.name)}
                  placeholder={t.admin.formNamePlaceholder}
                  onChange={(event) => updateDraft('name', event.target.value)}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.admin.formSlug} htmlFor="product-slug">
                  <Input
                    id="product-slug"
                    value={draft.slug}
                    placeholder={isEdit ? 'my-product' : t.admin.formSlugAuto}
                    className="font-mono"
                    onChange={(event) => updateDraft('slug', event.target.value)}
                  />
                </Field>
                <Field label={t.admin.formCategory} htmlFor="product-category">
                  <Input
                    id="product-category"
                    value={draft.category}
                    placeholder={t.admin.formCategoryPlaceholder}
                    onChange={(event) => updateDraft('category', event.target.value)}
                  />
                </Field>
              </div>

              {!isEdit && (
                <Field label={t.admin.formPrice} htmlFor="product-price" error={fieldErrors.price}>
                  <PriceInput
                    id="product-price"
                    value={draft.price}
                    currency={draft.priceCurrency}
                    onChange={(amount, unit) => {
                      setDraft((current) => ({
                        ...current,
                        price: amount,
                        priceCurrency: unit,
                      }));
                      setSaveError(null);
                    }}
                    invalid={Boolean(fieldErrors.price)}
                    placeholder="9.99"
                  />
                </Field>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <Field
                  label={t.admin.formSortOrder}
                  htmlFor="product-sort-order"
                  error={fieldErrors.sortOrder}
                  hint={t.admin.formSortOrderHint}
                >
                  <Input
                    id="product-sort-order"
                    type="number"
                    step={1}
                    inputMode="numeric"
                    value={draft.sortOrder}
                    invalid={Boolean(fieldErrors.sortOrder)}
                    onChange={(event) => updateDraft('sortOrder', event.target.value)}
                  />
                </Field>

                <Field label={t.admin.formStockDrawMode} htmlFor="product-draw-mode">
                  <div id="product-draw-mode" className="grid gap-2 sm:grid-cols-2">
                    {STOCK_DRAW_MODES.map((mode) => (
                      <label
                        key={mode}
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3.5 transition-colors hover:border-neutral-400 has-[:checked]:border-neutral-950 has-[:checked]:bg-neutral-50"
                      >
                        <input
                          type="radio"
                          name="stock-draw-mode"
                          value={mode}
                          checked={draft.stockDrawMode === mode}
                          onChange={() => updateDraft('stockDrawMode', mode)}
                          className="mt-0.5 shrink-0"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-neutral-950">
                            {t.admin.formStockDrawModes[mode]}
                          </span>
                          <span className="mt-0.5 block text-xs text-neutral-500">
                            {t.admin.formStockDrawModeHints[mode]}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </Field>
              </div>

              <ToggleRow
                id="product-active"
                checked={draft.active}
                onChange={(value) => updateDraft('active', value)}
                label={t.admin.formActive}
                hint={t.admin.formActiveHint}
              />
            </div>
          </Card>
        </TabPanel>

        <TabPanel tab="content" activeTab={activeTab}>
          <Card className="p-5 sm:p-6">
            <div className="mb-5">
              <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
                {t.admin.productContentTitle}
              </h2>
              <p className="mt-1 text-sm text-neutral-500">{t.admin.productContentHint}</p>
            </div>

            <div className="space-y-4">
              <Field label={t.admin.formImage} htmlFor="product-image">
                <ImagePicker
                  value={image}
                  bytes={imagePick ? null : product?.imageBytes ?? null}
                  onChange={(value) => {
                    setImagePick(value);
                    setSaveError(null);
                  }}
                />
              </Field>

              {isEdit && product && (
                <Field
                  label={t.admin.formGallery}
                  htmlFor="product-gallery"
                  hint={t.admin.formGalleryHint}
                  error={galleryError ?? undefined}
                >
                  <GalleryPicker
                    images={images}
                    coverCount={image ? 1 : 0}
                    busy={galleryBusy}
                    onAdd={handleAddImage}
                    onRemove={handleRemoveImage}
                    onMove={handleMoveImage}
                  />
                </Field>
              )}

              <Field label={t.admin.formShortDescription} htmlFor="product-short-description">
                <Input
                  id="product-short-description"
                  value={draft.shortDescription}
                  placeholder={t.admin.formShortDescriptionPlaceholder}
                  onChange={(event) => updateDraft('shortDescription', event.target.value)}
                />
              </Field>

              <Field
                label={t.admin.formDescription}
                htmlFor="product-description"
                hint={t.admin.formDescriptionHint}
              >
                <textarea
                  id="product-description"
                  rows={12}
                  value={draft.description}
                  placeholder={t.admin.formDescriptionPlaceholder}
                  onChange={(event) => updateDraft('description', event.target.value)}
                  className={TEXTAREA_CLASSES}
                />
              </Field>
            </div>
          </Card>
        </TabPanel>
      </form>

      {product && (
        <>
          <TabPanel tab="variants" activeTab={activeTab}>
            <VariantManager product={product} onChanged={onProductRefresh ?? (() => undefined)} />
          </TabPanel>

          <TabPanel tab="stock" activeTab={activeTab}>
            <VariantStockPanel product={product} onStockChanged={onStockChanged ?? (() => undefined)} />
          </TabPanel>

          <TabPanel tab="translations" activeTab={activeTab}>
            <Card className="p-5 sm:p-6">
              <TranslationSection blocks={translationBlocks} onTranslate={handleTranslate} />
            </Card>
          </TabPanel>
        </>
      )}

      <TabPanel tab="preview" activeTab={activeTab}>
        <ProductPreview
          input={{
            name: draft.name,
            slug: draft.slug,
            category: draft.category,
            shortDescription: draft.shortDescription,
            description: draft.description,
            image,
            thumbnail: imagePick ? imagePick.thumbnail : (product?.thumbnail ?? ''),
            images,
            price: draft.price,
            priceCurrency: draft.priceCurrency,
            variants: product?.variants ?? [],
          }}
        />
      </TabPanel>

      <div className="pointer-events-none fixed bottom-4 left-[4.75rem] right-4 z-40 md:left-[16rem] lg:left-[17rem] lg:right-8">
        <div className="pointer-events-auto mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white/95 px-3 py-3 shadow-lg backdrop-blur sm:px-4">
          <div className="min-w-0" aria-live="polite">
            <div className="flex items-center gap-2 text-sm font-medium text-neutral-800">
              {saveError ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
              ) : !dirty && savedOnce ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
              )}
              <span>{status}</span>
            </div>
            {saveError && <p className="mt-0.5 truncate text-xs text-red-600">{saveError}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden sm:block">
              <Link href="/admin/products" className={buttonVariants({ variant: 'ghost' })}>
                {t.common.cancel}
              </Link>
            </span>
            <Button
              type="submit"
              form="product-editor-form"
              loading={submitting}
              disabled={!dirty || galleryBusy}
            >
              {!submitting && <Save className="h-4 w-4" aria-hidden="true" />}
              {isEdit ? t.admin.formSubmitSave : t.admin.formSubmitCreate}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
