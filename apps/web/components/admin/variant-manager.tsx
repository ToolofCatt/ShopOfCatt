'use client';

import { useId, useState } from 'react';
import { Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { formatUsdt, type ProductDto, type ProductVariantDto } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { usePrices } from '@/lib/prices';
import { cn } from '@/lib/cn';
import { Badge, Button, Card, Field, Input, Spinner } from '@/components/ui';

const ICON_BUTTON_CLASSES =
  'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950 disabled:pointer-events-none disabled:opacity-50';

interface VariantPayload {
  name: string;
  price: number;
  sortOrder: number;
  active: boolean;
}

interface VariantFieldErrors {
  name?: string;
  price?: string;
  sortOrder?: string;
}

interface VariantFormProps {
  initial?: ProductVariantDto;
  submitLabel: string;
  onSubmit: (values: VariantPayload) => Promise<void>;
  onCancel: () => void;
}

/** Biểu mẫu thêm/sửa một loại — dùng chung cho cả hai chế độ. */
function VariantForm({ initial, submitLabel, onSubmit, onCancel }: VariantFormProps) {
  const { t } = useI18n();
  const { allConversions } = usePrices();
  const fieldId = useId();

  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(initial ? String(initial.price) : '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [active, setActive] = useState(initial?.active ?? true);

  const [fieldErrors, setFieldErrors] = useState<VariantFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;

    const trimmedName = name.trim();
    const priceNumber = Number(price);
    const sortOrderNumber = sortOrder.trim() === '' ? 0 : Number(sortOrder);

    const errors: VariantFieldErrors = {};
    if (!trimmedName) errors.name = t.admin.errVariantNameRequired;
    if (price.trim() === '' || !Number.isFinite(priceNumber) || priceNumber < 0) {
      errors.price = t.admin.errPriceInvalid;
    }
    if (!Number.isInteger(sortOrderNumber)) errors.sortOrder = t.admin.errSortOrderInvalid;
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: trimmedName,
        price: priceNumber,
        sortOrder: sortOrderNumber,
        active,
      });
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 bg-neutral-50 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.admin.variantNameLabel} htmlFor={`${fieldId}-name`} error={fieldErrors.name}>
          <Input
            id={`${fieldId}-name`}
            value={name}
            invalid={Boolean(fieldErrors.name)}
            placeholder={t.admin.variantNamePlaceholder}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field
          label={t.admin.formPrice}
          htmlFor={`${fieldId}-price`}
          error={fieldErrors.price}
          hint={allConversions(Number(price)) ?? undefined}
        >
          <Input
            id={`${fieldId}-price`}
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
      </div>

      <div className="grid items-end gap-3 sm:grid-cols-2">
        <Field
          label={t.admin.formSortOrder}
          htmlFor={`${fieldId}-sort-order`}
          error={fieldErrors.sortOrder}
        >
          <Input
            id={`${fieldId}-sort-order`}
            type="number"
            step={1}
            inputMode="numeric"
            value={sortOrder}
            invalid={Boolean(fieldErrors.sortOrder)}
            onChange={(event) => setSortOrder(event.target.value)}
          />
        </Field>
        <label
          htmlFor={`${fieldId}-active`}
          className={cn(
            'flex h-10 cursor-pointer select-none items-center gap-2.5 rounded-lg border border-neutral-300 bg-white px-3',
            'text-sm font-medium text-neutral-800 transition-colors hover:border-neutral-500',
          )}
        >
          <input
            id={`${fieldId}-active`}
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            className="h-4 w-4 cursor-pointer accent-neutral-950"
          />
          {t.admin.variantActiveLabel}
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <Button size="sm" loading={submitting} onClick={() => void handleSubmit()}>
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={submitting} onClick={onCancel}>
          {t.common.cancel}
        </Button>
      </div>
    </div>
  );
}

export interface VariantManagerProps {
  product: ProductDto;
  /** Tải lại sản phẩm sau khi thêm/sửa/xóa loại. */
  onChanged: () => Promise<void> | void;
}

/** Quản lý các loại của một sản phẩm: thêm / sửa / xóa, kèm tồn kho từng loại. */
export function VariantManager({ product, onChanged }: VariantManagerProps) {
  const { token } = useAuth();
  const { t } = useI18n();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = deletingId !== null;

  /**
   * Nạp lại sản phẩm sau khi thay đổi. Lỗi nạp lại hiển thị ở cấp thẻ, không
   * trộn lẫn với lỗi của biểu mẫu (thao tác đã thành công, chỉ số liệu là cũ).
   */
  const refresh = async () => {
    try {
      await onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
    }
  };

  const handleCreate = async (values: VariantPayload) => {
    await apiFetch<ProductVariantDto>(`/admin/products/${product.id}/variants`, {
      method: 'POST',
      body: values,
      token,
    });
    setCreating(false);
    setError(null);
    await refresh();
  };

  const handleUpdate = async (variantId: string, values: VariantPayload) => {
    await apiFetch<ProductVariantDto>(`/admin/variants/${variantId}`, {
      method: 'PATCH',
      body: values,
      token,
    });
    setEditingId(null);
    setError(null);
    await refresh();
  };

  const handleDelete = async (variant: ProductVariantDto) => {
    if (busy) return;
    if (!window.confirm(t.admin.variantDeleteConfirm(variant.name))) return;
    setDeletingId(variant.id);
    setError(null);
    try {
      await apiFetch<unknown>(`/admin/variants/${variant.id}`, { method: 'DELETE', token });
      await refresh();
    } catch (err) {
      // Kho có đơn hàng / loại cuối cùng → API trả lỗi, hiển thị nguyên văn.
      setError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
            {t.admin.variantsTitle}
          </h2>
          <p className="text-sm text-neutral-500">{t.admin.variantsSubtitle}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={creating}
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
        >
          <Plus strokeWidth={1.75} className="h-4 w-4" />
          {t.admin.variantAdd}
        </Button>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200">
        {product.variants.length === 0 && !creating ? (
          <p className="px-4 py-6 text-center text-sm text-neutral-500">{t.admin.variantsEmpty}</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {product.variants.map((variant) =>
              editingId === variant.id ? (
                <li key={variant.id}>
                  <VariantForm
                    initial={variant}
                    submitLabel={t.admin.variantSave}
                    onSubmit={(values) => handleUpdate(variant.id, values)}
                    onCancel={() => setEditingId(null)}
                  />
                </li>
              ) : (
                <li key={variant.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100">
                    <Layers strokeWidth={1.75} className="h-4 w-4 text-neutral-500" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-neutral-950">{variant.name}</p>
                      <Badge variant={variant.active ? 'solid' : 'muted'}>
                        {variant.active ? t.admin.visible : t.admin.hidden}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs tabular-nums text-neutral-500">
                      {t.admin.variantStockLine(variant.availableStock, variant.sold)} •{' '}
                      {t.admin.variantOrder(variant.sortOrder)}
                    </p>
                  </div>
                  <p className="whitespace-nowrap font-semibold tabular-nums text-neutral-950">
                    {formatUsdt(variant.price)}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title={t.admin.variantEdit}
                      aria-label={`${t.admin.variantEdit}: ${variant.name}`}
                      disabled={busy}
                      onClick={() => {
                        setEditingId(variant.id);
                        setCreating(false);
                      }}
                      className={ICON_BUTTON_CLASSES}
                    >
                      <Pencil strokeWidth={1.75} className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title={t.admin.variantDelete}
                      aria-label={`${t.admin.variantDelete}: ${variant.name}`}
                      disabled={busy}
                      onClick={() => void handleDelete(variant)}
                      className={cn(ICON_BUTTON_CLASSES, 'hover:bg-red-50 hover:text-red-600')}
                    >
                      {deletingId === variant.id ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        <Trash2 strokeWidth={1.75} className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </li>
              ),
            )}

            {creating && (
              <li>
                <VariantForm
                  submitLabel={t.admin.variantCreate}
                  onSubmit={handleCreate}
                  onCancel={() => setCreating(false)}
                />
              </li>
            )}
          </ul>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Card>
  );
}
