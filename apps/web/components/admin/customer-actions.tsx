'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound, Lock, LockOpen, ShieldMinus, ShieldPlus } from 'lucide-react';
import {
  isAdminRole,
  type AdminCustomerDto,
  type AdminResetPasswordDto,
  type Role,
} from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Badge, Button, type BadgeVariant } from '@/components/ui';
import { customerLabel } from '@/components/admin/helpers';
import type { Dictionary } from '@/lib/i18n';

/** Vai trò → biến thể badge: SUPERADMIN đậm, ADMIN viền, USER mờ. */
const ROLE_BADGE_VARIANT: Record<Role, BadgeVariant> = {
  SUPERADMIN: 'solid',
  ADMIN: 'outline',
  USER: 'muted',
};

export function roleLabel(role: Role, t: Dictionary): string {
  if (role === 'SUPERADMIN') return t.admin.roleSuperadmin;
  if (role === 'ADMIN') return t.admin.roleAdmin;
  return t.admin.roleUser;
}

export function RoleBadge({ role }: { role: Role }) {
  const { t } = useI18n();
  return <Badge variant={ROLE_BADGE_VARIANT[role]}>{roleLabel(role, t)}</Badge>;
}

/** Badge trạng thái tài khoản: "Đã khóa" nổi bật, còn lại mờ. */
export function CustomerStatusBadge({ locked }: { locked: boolean }) {
  const { t } = useI18n();
  return (
    <Badge variant={locked ? 'solid' : 'muted'}>
      {locked ? t.admin.customerLocked : t.admin.customerActive}
    </Badge>
  );
}

type CustomerAction =
  | 'lock'
  | 'unlock'
  | 'grant-admin'
  | 'revoke-admin'
  | 'reset-password';

export interface CustomerActionsProps {
  customer: AdminCustomerDto;
  /** Gọi lại sau khi thao tác thành công để tải lại dữ liệu. */
  onChanged: () => void | Promise<void>;
  className?: string;
}

/**
 * Các nút thao tác trên một khách hàng:
 * - Khóa/mở khóa: ẩn với admin và với chính mình.
 * - Cấp/thu hồi quyền admin: chỉ SUPERADMIN nhìn thấy.
 * Mỗi nút xác nhận bằng window.confirm trước khi gọi API.
 */
export function CustomerActions({ customer, onChanged, className }: CustomerActionsProps) {
  const { user, token } = useAuth();
  const { t } = useI18n();
  const [busy, setBusy] = useState<CustomerAction | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isSelf = user?.id === customer.id;
  const targetIsAdmin = isAdminRole(customer.role);
  const locked = customer.lockedAt !== null;
  const viewerIsSuper = user?.role === 'SUPERADMIN';

  const showLock = !targetIsAdmin && !isSelf && !locked;
  const showUnlock = !isSelf && locked;
  const showGrant = viewerIsSuper && customer.role === 'USER' && !locked;
  const showRevoke = viewerIsSuper && customer.role === 'ADMIN';
  // Quên mật khẩu: admin đặt lại thay khách. Không tự đặt lại cho chính mình,
  // và admin thường không đụng được tài khoản quản trị khác.
  const showReset =
    !isSelf &&
    customer.role !== 'SUPERADMIN' &&
    (viewerIsSuper || !targetIsAdmin);

  if (!showLock && !showUnlock && !showGrant && !showRevoke && !showReset) {
    return null;
  }

  const run = async (action: CustomerAction, confirmMessage: string) => {
    if (busy) return;
    if (!window.confirm(confirmMessage)) return;
    setBusy(action);
    try {
      await apiFetch<unknown>(`/admin/customers/${customer.id}/${action}`, {
        method: 'POST',
        token,
      });
      await onChanged();
    } catch (err) {
      window.alert(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async () => {
    if (busy) return;
    if (!window.confirm(t.admin.resetPasswordConfirm(customerLabel(customer)))) return;
    setBusy('reset-password');
    setCopied(false);
    try {
      const result = await apiFetch<AdminResetPasswordDto>(
        `/admin/customers/${customer.id}/reset-password`,
        { method: 'POST', token },
      );
      setNewPassword(result.password);
      await onChanged();
    } catch (err) {
      window.alert(apiErrorMessage(err, t.common.connectionError));
    } finally {
      setBusy(null);
    }
  };

  const copyPassword = () => {
    if (!newPassword) return;
    void navigator.clipboard.writeText(newPassword).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className={className ?? 'flex flex-wrap items-center gap-2'}
      onClick={(event) => event.stopPropagation()}
    >
      {showLock && (
        <Button
          variant="danger"
          size="sm"
          loading={busy === 'lock'}
          disabled={busy !== null}
          onClick={() => void run('lock', t.admin.lockConfirm(customerLabel(customer)))}
        >
          {busy !== 'lock' && <Lock strokeWidth={1.75} className="h-3.5 w-3.5" />}
          {t.admin.lockAction}
        </Button>
      )}
      {showUnlock && (
        <Button
          variant="outline"
          size="sm"
          loading={busy === 'unlock'}
          disabled={busy !== null}
          onClick={() => void run('unlock', t.admin.unlockConfirm(customerLabel(customer)))}
        >
          {busy !== 'unlock' && <LockOpen strokeWidth={1.75} className="h-3.5 w-3.5" />}
          {t.admin.unlockAction}
        </Button>
      )}
      {showGrant && (
        <Button
          variant="outline"
          size="sm"
          loading={busy === 'grant-admin'}
          disabled={busy !== null}
          onClick={() => void run('grant-admin', t.admin.grantConfirm(customerLabel(customer)))}
        >
          {busy !== 'grant-admin' && <ShieldPlus strokeWidth={1.75} className="h-3.5 w-3.5" />}
          {t.admin.grantAction}
        </Button>
      )}
      {showRevoke && (
        <Button
          variant="danger"
          size="sm"
          loading={busy === 'revoke-admin'}
          disabled={busy !== null}
          onClick={() => void run('revoke-admin', t.admin.revokeConfirm(customerLabel(customer)))}
        >
          {busy !== 'revoke-admin' && <ShieldMinus strokeWidth={1.75} className="h-3.5 w-3.5" />}
          {t.admin.revokeAction}
        </Button>
      )}
      {showReset && (
        <Button
          variant="outline"
          size="sm"
          loading={busy === 'reset-password'}
          disabled={busy !== null}
          onClick={() => void resetPassword()}
        >
          {busy !== 'reset-password' && (
            <KeyRound strokeWidth={1.75} className="h-3.5 w-3.5" />
          )}
          {t.admin.resetPassword}
        </Button>
      )}

      {/* Mật khẩu mới chỉ hiện một lần — admin chép rồi gửi cho khách. */}
      {newPassword && (
        <div className="w-full space-y-1.5 rounded-lg border border-neutral-300 bg-neutral-50 p-3">
          <p className="text-sm font-medium text-neutral-950">
            {t.admin.resetPasswordDone}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded border border-neutral-200 bg-white px-2.5 py-1.5 font-mono text-sm font-semibold break-all text-neutral-950">
              {newPassword}
            </code>
            <button
              type="button"
              onClick={copyPassword}
              aria-label={t.common.copy}
              title={t.common.copy}
              className="shrink-0 cursor-pointer rounded-lg border border-neutral-300 p-2 text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-950"
            >
              {copied ? (
                <Check className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
          </div>
          <p className="text-xs text-neutral-500">{t.admin.resetPasswordWarning}</p>
        </div>
      )}
    </div>
  );
}
