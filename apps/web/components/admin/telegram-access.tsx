'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  TELEGRAM_ADMIN_PERMISSIONS,
  telegramAdminText,
  validTelegramAdminId,
  type TelegramAdminDto,
  type TelegramAdminSettingsDto,
  type TelegramAdminPermission,
} from '@webcatt/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { apiFetch, apiErrorMessage } from '@/lib/api';
import { Button, Field, Input, Spinner } from '@/components/ui';
import { ToggleRow } from './toggle-row';

const empty = {
  telegramUserId: '',
  name: '',
  permission: 'OPERATOR' as TelegramAdminPermission,
  enabled: true,
};

export function TelegramAccessSettings() {
  const { token, user } = useAuth();
  const { locale, t } = useI18n();
  const text = (key: Parameters<typeof telegramAdminText>[1]) =>
    telegramAdminText(locale, key);
  const [data, setData] = useState<TelegramAdminSettingsDto | null>(null);
  const [editing, setEditing] = useState<TelegramAdminDto | null>(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!token || user?.role !== 'SUPERADMIN') return;
    try {
      setData(
        await apiFetch<TelegramAdminSettingsDto>('/admin/telegram/admins', {
          token,
        }),
      );
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
    }
  }, [token, user?.role, t.common.connectionError]);
  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setData(
        await apiFetch<TelegramAdminSettingsDto>(
          `/admin/telegram/admins${path}`,
          { token, method, body },
        ),
      );
      setForm(empty);
      setEditing(null);
      setRemoveId(null);
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setBusy(false);
    }
  };
  if (user?.role !== 'SUPERADMIN')
    return (
      <p className="border-y border-neutral-200 py-6 text-sm text-neutral-500">
        {text('webOnly')}
      </p>
    );

  return (
    <section className="min-w-0 space-y-6" aria-label={text('access')}>
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="h-5 w-5" />
          {text('access')}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          title={text('refresh')}
          aria-label={text('refresh')}
          onClick={() => void load()}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!data ? (
        !error && <Spinner />
      ) : (
        <>
          <ToggleRow
            id="telegram-admin-enabled"
            label={text('enable')}
            hint={text('webOnly')}
            disabled={busy}
            checked={data.enabled}
            onChange={(enabled) =>
              void mutate('/settings', 'PATCH', { enabled })
            }
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!validTelegramAdminId(form.telegramUserId)) {
                setError(text('invalid'));
                return;
              }
              void mutate(
                editing ? `/${editing.id}` : '',
                editing ? 'PATCH' : 'POST',
                { ...form, ...(editing ? { version: editing.version } : {}) },
              );
            }}
            className="grid gap-4 border-y border-neutral-200 py-5 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Field label="Telegram User ID" htmlFor="telegram-admin-id">
              <Input
                id="telegram-admin-id"
                inputMode="numeric"
                autoComplete="off"
                required
                disabled={Boolean(editing) || busy}
                value={form.telegramUserId}
                onChange={(event) =>
                  setForm({
                    ...form,
                    telegramUserId: event.target.value.trim(),
                  })
                }
              />
            </Field>
            <Field label={text('name')} htmlFor="telegram-admin-name">
              <Input
                id="telegram-admin-name"
                required
                maxLength={100}
                disabled={busy}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <Field
              label={text('permission')}
              htmlFor="telegram-admin-permission"
            >
              <select
                id="telegram-admin-permission"
                disabled={busy}
                className="h-10 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm"
                value={form.permission}
                onChange={(event) =>
                  setForm({
                    ...form,
                    permission: event.target.value as TelegramAdminPermission,
                  })
                }
              >
                {TELEGRAM_ADMIN_PERMISSIONS.map((permission) => (
                  <option key={permission} value={permission}>
                    {text(permission)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" loading={busy}>
                {editing ? (
                  <Save className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {text(editing ? 'save' : 'add')}
              </Button>
              {editing && (
                <Button
                  variant="ghost"
                  aria-label={text('cancel')}
                  title={text('cancel')}
                  onClick={() => {
                    setEditing(null);
                    setForm(empty);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="border-b text-xs text-neutral-500">
                <tr>
                  {[
                    'Telegram User ID',
                    text('name'),
                    text('permission'),
                    text('active'),
                    text('lastSeen'),
                    '',
                  ].map((label, index) => (
                    <th key={index} className="px-2 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {data.admins.map((admin) => (
                  <tr key={admin.id}>
                    <td className="px-2 py-3 font-mono">
                      {admin.telegramUserId}
                    </td>
                    <td className="max-w-40 break-words px-2 py-3">
                      {admin.name}
                    </td>
                    <td className="px-2 py-3">{text(admin.permission)}</td>
                    <td className="px-2 py-3">
                      <input
                        type="checkbox"
                        aria-label={`${text('active')} ${admin.name}`}
                        disabled={busy}
                        checked={admin.enabled}
                        onChange={(event) =>
                          void mutate(`/${admin.id}`, 'PATCH', {
                            ...admin,
                            enabled: event.target.checked,
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-3 text-xs text-neutral-500">
                      {admin.lastSeenAt
                        ? new Date(admin.lastSeenAt).toLocaleString(locale)
                        : '-'}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={`${text('edit')} ${admin.name}`}
                          title={text('edit')}
                          onClick={() => {
                            setEditing(admin);
                            setForm(admin);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={`${text('remove')} ${admin.name}`}
                          title={text('remove')}
                          onClick={() => setRemoveId(admin.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.admins.length && (
              <p className="py-8 text-center text-sm text-neutral-500">
                {text('empty')}
              </p>
            )}
          </div>
          {removeId && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 border-l-2 border-red-500 bg-red-50 p-4 text-sm"
            >
              <span>{text('removeConfirm')}</span>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => void mutate(`/${removeId}`, 'DELETE')}
              >
                {text('confirm')}
              </Button>
              <Button variant="ghost" onClick={() => setRemoveId(null)}>
                {text('cancel')}
              </Button>
            </div>
          )}
          {Boolean(data.pendingActions?.length) && (
            <section className="border-t border-neutral-200 pt-5">
              <h3 className="font-medium">{text('review')}</h3>
              <div className="divide-y divide-neutral-200">
                {data.pendingActions.map((action) => (
                  <div
                    key={action.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                  >
                    <span className="min-w-0 break-all">
                      {action.kind} · {action.targetId}
                      <small className="block text-neutral-500">
                        Telegram: {action.telegramUserId} · {action.status}
                      </small>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(text('reviewConfirm')))
                          void mutate(`/actions/${action.id}/reviewed`, 'POST');
                      }}
                    >
                      {text('reviewed')}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
