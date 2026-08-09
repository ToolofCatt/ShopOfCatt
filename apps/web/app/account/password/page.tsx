'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { PASSWORD_MIN_LENGTH } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Button, Card, Field, Spinner } from '@/components/ui';
import { PasswordInput } from '@/components/password-input';

interface FieldErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, token, loading: authLoading, replaceToken } = useAuth();
  const { t } = useI18n();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Trang yêu cầu đăng nhập — giống trang /orders.
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?next=${encodeURIComponent('/account/password')}`);
    }
  }, [authLoading, user, router]);

  // Đổi xong → quay lại trang trước đó.
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => {
      if (window.history.length > 1) router.back();
      else router.push('/');
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [success, router]);

  if (authLoading || !user) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  }

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (!currentPassword) errors.currentPassword = t.account.errCurrentRequired;

    if (!newPassword) errors.newPassword = t.auth.errPasswordRequired;
    else if (newPassword.length < PASSWORD_MIN_LENGTH)
      errors.newPassword = t.auth.errPasswordShort(PASSWORD_MIN_LENGTH);

    if (!confirmPassword) errors.confirmPassword = t.auth.errConfirmRequired;
    else if (confirmPassword !== newPassword)
      errors.confirmPassword = t.auth.errConfirmMismatch;

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      // Máy chủ vô hiệu hóa mọi token cũ và cấp token mới cho phiên hiện tại.
      const result = await apiFetch<{ success: true; accessToken: string }>(
        '/auth/change-password',
        {
          method: 'POST',
          body: { currentPassword, newPassword, confirmPassword },
          token,
        },
      );
      replaceToken(result.accessToken);
      setSuccess(true);
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <Card className="space-y-5 p-6">
        {success ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 strokeWidth={1.75} className="h-10 w-10 text-emerald-600" />
            <p className="font-semibold tracking-tight text-neutral-950">
              {t.account.successTitle}
            </p>
            <p className="text-sm text-neutral-500">{t.account.successHint}</p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">{t.account.passwordTitle}</h1>
              <p className="text-sm text-neutral-500">{t.account.passwordSubtitle}</p>
            </div>

            <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" noValidate>
              <Field
                label={t.account.currentPasswordLabel}
                htmlFor="current-password"
                error={fieldErrors.currentPassword}
              >
                <PasswordInput
                  id="current-password"
                  autoComplete="current-password"
                  autoFocus
                  placeholder={t.account.currentPasswordPlaceholder}
                  invalid={Boolean(fieldErrors.currentPassword)}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>

              <Field
                label={t.account.newPasswordLabel}
                htmlFor="new-password"
                error={fieldErrors.newPassword}
                hint={t.auth.passwordHint(PASSWORD_MIN_LENGTH)}
              >
                <PasswordInput
                  id="new-password"
                  autoComplete="new-password"
                  placeholder={t.account.newPasswordPlaceholder}
                  invalid={Boolean(fieldErrors.newPassword)}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </Field>

              <Field
                label={t.account.confirmNewLabel}
                htmlFor="confirm-new-password"
                error={fieldErrors.confirmPassword}
              >
                <PasswordInput
                  id="confirm-new-password"
                  autoComplete="new-password"
                  placeholder={t.account.confirmNewPlaceholder}
                  invalid={Boolean(fieldErrors.confirmPassword)}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </Field>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <Button type="submit" className="w-full" loading={submitting}>
                {t.account.submit}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
