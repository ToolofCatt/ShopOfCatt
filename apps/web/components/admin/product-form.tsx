'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { TRANSLATABLE_LOCALES, type ProductDto } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Button, Card, Field, Input, buttonVariants } from '@/components/ui';
import { TEXTAREA_CLASSES, localeLabel } from '@/components/admin/helpers';
import { ImagePicker } from '@/components/admin/image-picker';
import { ProductPreview } from '@/components/admin/product-preview';
import { ToggleRow } from '@/components/admin/toggle-row';
import { TranslationSection, type TranslationBlock } from '@/components/admin/translation';

interface ProductFieldErrors {
  name?: string;
  price?: string;
  sortOrder?: string;
}

export interface ProductFormProps {
  /** When set → edit mode (PATCH); otherwise create mode (POST). */
  product?: ProductDto;
  /** Edit mode: sản phẩm vừa được lưu/dịch lại — cha cập nhật lại state. */
  onProductUpdated?: (product: ProductDto) => void;
}

export function ProductForm({ product, onProductUpdated }: ProductFormProps) {
  const router = useRouter();
  const { token } = useAuth();
  const { t } = useI18n();
  const isEdit = Boolean(product);

  const [name, setName] = useState(product?.name ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  // Giá chỉ có ở chế độ tạo mới — nó sinh ra loại đầu tiên ("Mặc định").
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState(product?.category ?? '');
  const [image, setImage] = useState(product?.image ?? '');
  const [shortDescription, setShortDescription] = useState(product?.shortDescription ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [sortOrder, setSortOrder] = useState(product ? String(product.sortOrder) : '0');
  const [active, setActive] = useState(product?.active ?? true);

  const [fieldErrors, setFieldErrors] = useState<ProductFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Kiểm tra biểu mẫu — trả về lỗi theo trường, hoặc null khi hợp lệ. */
  const validate = (): ProductFieldErrors | null => {
    const errors: ProductFieldErrors = {};
    if (!name.trim()) errors.name = t.admin.errNameRequired;

    if (!isEdit) {
      const priceNumber = Number(price);
      if (price.trim() === '' || !Number.isFinite(priceNumber) || priceNumber < 0) {
        errors.price = t.admin.errPriceInvalid;
      }
    }

    const sortOrderNumber = sortOrder.trim() === '' ? 0 : Number(sortOrder);
    if (!Number.isInteger(sortOrderNumber)) errors.sortOrder = t.admin.errSortOrderInvalid;

    return Object.keys(errors).length > 0 ? errors : null;
  };

  /** Thân yêu cầu gửi lên API (đã kiểm tra hợp lệ trước đó). */
  const buildBody = (): Record<string, unknown> => {
    // Optional text fields: omitted when empty on create; sent as null on edit
    // so the admin can clear a previously set value.
    const optional = (value: string): string | null | undefined => {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      return isEdit ? null : undefined;
    };

    const body: Record<string, unknown> = {
      name: name.trim(),
      sortOrder: sortOrder.trim() === '' ? 0 : Number(sortOrder),
      active,
      shortDescription: optional(shortDescription),
      description: optional(description),
      image: optional(image),
      category: optional(category),
    };
    // Giá chỉ gửi khi tạo mới: API dùng nó để tạo loại "Mặc định".
    if (!isEdit) body.price = Number(price);
    // Slug is never nullable: send only when provided (create auto-generates from name).
    if (slug.trim()) body.slug = slug.trim();
    for (const key of Object.keys(body)) {
      if (body[key] === undefined) delete body[key];
    }
    return body;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const errors = validate();
    setFieldErrors(errors ?? {});
    if (errors) return;

    setSubmitting(true);
    setError(null);
    try {
      if (isEdit && product) {
        await apiFetch<ProductDto>(`/admin/products/${product.id}`, {
          method: 'PATCH',
          body: buildBody(),
          token,
        });
      } else {
        await apiFetch<ProductDto>('/admin/products', { method: 'POST', body: buildBody(), token });
      }
      router.push('/admin/products');
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
      setSubmitting(false);
    }
  };

  /** Lưu bản tiếng Việt rồi dịch — bảo đảm bản dịch khớp nội dung đang xem. */
  const handleTranslate = async () => {
    if (!product) return;

    const errors = validate();
    setFieldErrors(errors ?? {});
    if (errors) throw new Error(t.admin.translateFixForm);

    await apiFetch<ProductDto>(`/admin/products/${product.id}`, {
      method: 'PATCH',
      body: buildBody(),
      token,
    });
    const translated = await apiFetch<ProductDto>(`/admin/products/${product.id}/translate`, {
      method: 'POST',
      token,
    });
    onProductUpdated?.(translated);
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

  return (
    <div className="space-y-6">
      {/*
        Biểu mẫu bên trái, xem trước bên phải. Cột phải dính theo màn hình để nó
        vẫn trong tầm mắt khi cuộn xuống ô mô tả dài. Dưới `xl` thì xem trước
        xuống dưới biểu mẫu thay vì bóp cả hai lại.
      */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
        <Card className="p-6">
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" noValidate>
            <Field label={t.admin.formName} htmlFor="product-name" error={fieldErrors.name}>
              <Input
                id="product-name"
                value={name}
                invalid={Boolean(fieldErrors.name)}
                placeholder={t.admin.formNamePlaceholder}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.admin.formSlug} htmlFor="product-slug">
                <Input
                  id="product-slug"
                  value={slug}
                  placeholder={isEdit ? 'my-product' : t.admin.formSlugAuto}
                  className="font-mono"
                  onChange={(event) => setSlug(event.target.value)}
                />
              </Field>
              {isEdit ? (
                <Field label={t.admin.formCategory} htmlFor="product-category">
                  <Input
                    id="product-category"
                    value={category}
                    placeholder={t.admin.formCategoryPlaceholder}
                    onChange={(event) => setCategory(event.target.value)}
                  />
                </Field>
              ) : (
                <Field
                  label={t.admin.formPrice}
                  htmlFor="product-price"
                  error={fieldErrors.price}
                >
                  <Input
                    id="product-price"
                    type="number"
                    min={0}
                    step={0.01}
                    inputMode="decimal"
                    value={price}
                    invalid={Boolean(fieldErrors.price)}
                    placeholder="9.99"
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </Field>
              )}
            </div>

            {!isEdit && (
              <Field label={t.admin.formCategory} htmlFor="product-category">
                <Input
                  id="product-category"
                  value={category}
                  placeholder={t.admin.formCategoryPlaceholder}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </Field>
            )}

            <Field label={t.admin.formImage} htmlFor="product-image">
              <ImagePicker value={image} onChange={setImage} />
            </Field>

            <Field label={t.admin.formShortDescription} htmlFor="product-short-description">
              <Input
                id="product-short-description"
                value={shortDescription}
                placeholder={t.admin.formShortDescriptionPlaceholder}
                onChange={(event) => setShortDescription(event.target.value)}
              />
            </Field>

            <Field
              label={t.admin.formDescription}
              htmlFor="product-description"
              hint={t.admin.formDescriptionHint}
            >
              <textarea
                id="product-description"
                rows={8}
                value={description}
                placeholder={t.admin.formDescriptionPlaceholder}
                onChange={(event) => setDescription(event.target.value)}
                className={TEXTAREA_CLASSES}
              />
            </Field>

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
                value={sortOrder}
                invalid={Boolean(fieldErrors.sortOrder)}
                onChange={(event) => setSortOrder(event.target.value)}
              />
            </Field>

            <ToggleRow
              id="product-active"
              checked={active}
              onChange={setActive}
              label={t.admin.formActive}
              hint={t.admin.formActiveHint}
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex items-center gap-2 border-t border-neutral-100 pt-4">
              <Button type="submit" loading={submitting}>
                {isEdit ? t.admin.formSubmitSave : t.admin.formSubmitCreate}
              </Button>
              <Link href="/admin/products" className={buttonVariants({ variant: 'ghost' })}>
                {t.common.cancel}
              </Link>
            </div>
          </form>
        </Card>

        <div className="xl:sticky xl:top-24">
          <ProductPreview
            input={{
              name,
              slug,
              category,
              shortDescription,
              description,
              image,
              price,
              variants: product?.variants ?? [],
            }}
          />
        </div>
      </div>

      {/* Bảng dịch giữ nguyên chiều ngang đầy đủ — nó có lưới 2 cột riêng bên trong. */}
      {product && (
        <Card className="p-6">
          <TranslationSection blocks={translationBlocks} onTranslate={handleTranslate} />
        </Card>
      )}
    </div>
  );
}
