'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus, ServerCrash, Ticket, Trash2, X } from 'lucide-react';
import {
  formatUsdt,
  type AdminCouponDto,
  type DiscountType,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Label,
  Spinner,
} from '@/components/ui';
import { PageHeader } from '@/components/admin/page-header';

interface FormState {
  code: string;
  type: DiscountType;
  value: string;
  minAmount: string;
  maxUses: string;
  perUserLimit: string;
  startsAt: string;
  expiresAt: string;
  note: string;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  code: '',
  type: 'PERCENT',
  value: '',
  minAmount: '',
  maxUses: '',
  perUserLimit: '',
  startsAt: '',
  expiresAt: '',
  note: '',
  active: true,
};

/** ISO → giá trị cho <input type="datetime-local"> theo giờ máy khách. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/** "" → null; giá trị datetime-local → ISO. */
function fromLocalInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toForm(coupon: AdminCouponDto): FormState {
  return {
    code: coupon.code,
    type: coupon.type,
    value: String(coupon.value),
    minAmount: coupon.minAmount > 0 ? String(coupon.minAmount) : '',
    maxUses: coupon.maxUses === null ? '' : String(coupon.maxUses),
    perUserLimit: coupon.perUserLimit === null ? '' : String(coupon.perUserLimit),
    startsAt: toLocalInput(coupon.startsAt),
    expiresAt: toLocalInput(coupon.expiresAt),
    note: coupon.note ?? '',
    active: coupon.active,
  };
}

export default function AdminCouponsPage() {
  const { token } = useAuth();
  const { t, formatDate } = useI18n();

  const [coupons, setCoupons] = useState<AdminCouponDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<AdminCouponDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = () => {
    apiFetch<AdminCouponDto[]>('/admin/coupons', { token })
      .then((data) => {
        setCoupons(data);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(apiErrorMessage(err, t.common.connectionError));
      });
  };

  useEffect(() => {
    if (!token) return;
    let active = true;
    apiFetch<AdminCouponDto[]>('/admin/coupons', { token })
      .then((data) => {
        if (active) setCoupons(data);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(apiErrorMessage(err, t.common.connectionError));
      });
    return () => {
      active = false;
    };
  }, [token, t]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setSaved(false);
    setFormOpen(true);
  };

  const openEdit = (coupon: AdminCouponDto) => {
    setEditing(coupon);
    setForm(toForm(coupon));
    setFormError(null);
    setSaved(false);
    setFormOpen(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    setSaved(false);

    // Chuỗi rỗng ở các ô "không giới hạn" gửi null để xóa giới hạn.
    const payload = {
      type: form.type,
      value: Number(form.value),
      minAmount: form.minAmount.trim() === '' ? 0 : Number(form.minAmount),
      maxUses: form.maxUses.trim() === '' ? null : Number(form.maxUses),
      perUserLimit:
        form.perUserLimit.trim() === '' ? null : Number(form.perUserLimit),
      startsAt: fromLocalInput(form.startsAt),
      expiresAt: fromLocalInput(form.expiresAt),
      note: form.note.trim() === '' ? null : form.note.trim(),
      active: form.active,
    };

    try {
      if (editing) {
        await apiFetch<AdminCouponDto>(`/admin/coupons/${editing.id}`, {
          method: 'PATCH',
          body: payload,
          token,
        });
      } else {
        await apiFetch<AdminCouponDto>('/admin/coupons', {
          method: 'POST',
          body: { ...payload, code: form.code.trim().toUpperCase() },
          token,
        });
      }
      load();
      setSaved(true);
      setFormOpen(false);
    } catch (err) {
      setFormError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (coupon: AdminCouponDto) => {
    if (!window.confirm(t.admin.couponDeleteConfirm(coupon.code))) return;
    try {
      await apiFetch(`/admin/coupons/${coupon.id}`, {
        method: 'DELETE',
        token,
      });
      load();
    } catch (err) {
      setLoadError(apiErrorMessage(err, t.common.connectionError));
    }
  };

  const discountLabel = (coupon: AdminCouponDto): string =>
    coupon.type === 'PERCENT'
      ? `${coupon.value}%`
      : formatUsdt(coupon.value);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t.admin.couponsTitle}
        description={t.admin.couponsSubtitle}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            {t.admin.couponNew}
          </Button>
        }
      />

      {formOpen && (
        <Card className="mb-6 p-6">
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" noValidate>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold tracking-tight">
                {editing ? t.admin.couponEdit : t.admin.couponNew}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                aria-label={t.common.cancel}
                className="cursor-pointer rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t.admin.couponCodeLabel}
                htmlFor="coupon-code"
                hint={editing ? undefined : t.admin.couponCodeHint}
              >
                <Input
                  id="coupon-code"
                  required
                  disabled={editing !== null}
                  className="font-mono uppercase"
                  placeholder={t.admin.couponCodePlaceholder}
                  value={form.code}
                  onChange={(event) =>
                    setForm({ ...form, code: event.target.value.toUpperCase() })
                  }
                />
              </Field>

              <Field label={t.admin.couponTypeLabel} htmlFor="coupon-type">
                <select
                  id="coupon-type"
                  value={form.type}
                  onChange={(event) =>
                    setForm({ ...form, type: event.target.value as DiscountType })
                  }
                  className="h-10 w-full cursor-pointer rounded-lg border border-neutral-300 bg-white px-3 text-sm outline-none transition-colors focus:border-neutral-950"
                >
                  <option value="PERCENT">{t.admin.couponTypePercent}</option>
                  <option value="FIXED">{t.admin.couponTypeFixed}</option>
                </select>
              </Field>

              <Field label={t.admin.couponValueLabel} htmlFor="coupon-value">
                <Input
                  id="coupon-value"
                  required
                  inputMode="decimal"
                  value={form.value}
                  onChange={(event) => setForm({ ...form, value: event.target.value })}
                />
              </Field>

              <Field label={t.admin.couponMinAmountLabel} htmlFor="coupon-min">
                <Input
                  id="coupon-min"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.minAmount}
                  onChange={(event) => setForm({ ...form, minAmount: event.target.value })}
                />
              </Field>

              <Field
                label={t.admin.couponMaxUsesLabel}
                htmlFor="coupon-max-uses"
                hint={t.admin.couponUnlimitedHint}
              >
                <Input
                  id="coupon-max-uses"
                  inputMode="numeric"
                  placeholder={t.admin.couponUnlimited}
                  value={form.maxUses}
                  onChange={(event) => setForm({ ...form, maxUses: event.target.value })}
                />
              </Field>

              <Field
                label={t.admin.couponPerUserLabel}
                htmlFor="coupon-per-user"
                hint={t.admin.couponUnlimitedHint}
              >
                <Input
                  id="coupon-per-user"
                  inputMode="numeric"
                  placeholder={t.admin.couponUnlimited}
                  value={form.perUserLimit}
                  onChange={(event) =>
                    setForm({ ...form, perUserLimit: event.target.value })
                  }
                />
              </Field>

              <Field label={t.admin.couponStartsAtLabel} htmlFor="coupon-starts">
                <Input
                  id="coupon-starts"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
                />
              </Field>

              <Field label={t.admin.couponExpiresAtLabel} htmlFor="coupon-expires">
                <Input
                  id="coupon-expires"
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
                />
              </Field>
            </div>

            <Field label={t.admin.couponNoteLabel} htmlFor="coupon-note">
              <Input
                id="coupon-note"
                placeholder={t.admin.couponNotePlaceholder}
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
              />
            </Field>

            <label
              htmlFor="coupon-active"
              className="flex cursor-pointer items-center gap-2.5"
            >
              <input
                id="coupon-active"
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
                className="h-4 w-4 cursor-pointer accent-neutral-950"
              />
              <Label htmlFor="coupon-active" className="cursor-pointer">
                {t.admin.couponActiveLabel}
              </Label>
            </label>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div className="flex gap-2 border-t border-neutral-100 pt-4">
              <Button type="submit" loading={saving}>
                {t.common.save}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                {t.common.cancel}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {saved && !formOpen && (
        <p className="mb-4 text-sm font-medium text-emerald-600">{t.admin.couponSaved}</p>
      )}

      {loadError ? (
        <EmptyState
          icon={ServerCrash}
          title={t.admin.couponsLoadError}
          hint={loadError}
          action={
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t.common.retry}
            </Button>
          }
        />
      ) : coupons === null ? (
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      ) : coupons.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title={t.admin.couponsEmptyTitle}
          hint={t.admin.couponsEmptyHint}
          action={<Button onClick={openCreate}>{t.admin.couponNew}</Button>}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500">
                <th className="px-4 py-3 font-medium">{t.admin.couponColCode}</th>
                <th className="px-4 py-3 font-medium">{t.admin.couponColValue}</th>
                <th className="px-4 py-3 text-right font-medium">
                  {t.admin.couponColMin}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t.admin.couponColUsed}
                </th>
                <th className="px-4 py-3 font-medium">{t.admin.couponColExpires}</th>
                <th className="px-4 py-3 font-medium">{t.admin.couponColStatus}</th>
                <th className="px-4 py-3" aria-hidden="true" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {coupons.map((coupon) => (
                <tr key={coupon.id} className="transition-colors hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <span className="font-mono font-medium text-neutral-950">
                      {coupon.code}
                    </span>
                    {coupon.note && (
                      <span className="mt-0.5 block text-xs text-neutral-400">
                        {coupon.note}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {discountLabel(coupon)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                    {coupon.minAmount > 0 ? formatUsdt(coupon.minAmount) : t.common.dash}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {t.admin.couponUsedOf(coupon.usedCount, coupon.maxUses)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                    {coupon.expiresAt ? formatDate(coupon.expiresAt) : t.common.dash}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={coupon.active ? 'solid' : 'muted'}>
                      {coupon.active ? t.admin.visible : t.admin.hidden}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(coupon)}
                        aria-label={t.admin.couponEdit}
                        title={t.admin.couponEdit}
                        className="cursor-pointer rounded-lg p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
                      >
                        <Pencil className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(coupon)}
                        aria-label={t.common.delete}
                        title={t.common.delete}
                        className="cursor-pointer rounded-lg p-2 text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
