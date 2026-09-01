'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import { RefreshCw } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, type CaptchaDto } from '@webcatt/shared';
import { apiErrorMessage, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { Button, Card, Field, Input, Spinner } from '@/components/ui';
import { PasswordInput } from '@/components/password-input';
import { Wordmark } from '@/components/wordmark';
import { useStorefront } from '@/lib/storefront';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  captcha?: string;
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';
  const { user, loading: authLoading, register } = useAuth();
  const { t } = useI18n();
  const storefront = useStorefront();
  const siteName = storefront.document.brand.name || 'Digital Store';
  const logo = storefront.mediaUrl(storefront.document.brand.logoAssetId) ?? '/logo-mark.png';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Câu hỏi xác minh — chặn đăng ký hàng loạt bằng máy.
  const [captcha, setCaptcha] = useState<CaptchaDto | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  const loadCaptcha = useCallback(() => {
    setCaptchaAnswer('');
    apiFetch<CaptchaDto>('/auth/captcha')
      .then(setCaptcha)
      .catch(() => setCaptcha(null));
  }, []);

  useEffect(loadCaptcha, [loadCaptcha]);

  // Already signed in → go straight to the destination.
  useEffect(() => {
    if (!authLoading && user && !submitting) router.replace(next);
  }, [authLoading, user, submitting, next, router]);

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    const trimmedEmail = email.trim();
    if (!trimmedEmail) errors.email = t.auth.errEmailRequired;
    else if (!EMAIL_PATTERN.test(trimmedEmail)) errors.email = t.auth.errEmailInvalid;

    if (!password) errors.password = t.auth.errPasswordRequired;
    else if (password.length < PASSWORD_MIN_LENGTH)
      errors.password = t.auth.errPasswordShort(PASSWORD_MIN_LENGTH);

    if (!confirmPassword) errors.confirmPassword = t.auth.errConfirmRequired;
    else if (confirmPassword !== password)
      errors.confirmPassword = t.auth.errConfirmMismatch;

    if (!captchaAnswer.trim()) errors.captcha = t.auth.errCaptchaRequired;

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
      await register({
        email: email.trim(),
        password,
        confirmPassword,
        captchaId: captcha?.id ?? '',
        captchaAnswer: captchaAnswer.trim(),
      });
      router.push(next);
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
      // Mỗi câu hỏi chỉ dùng được một lần → lấy câu mới sau mỗi lần thất bại.
      loadCaptcha();
      setSubmitting(false);
    }
  };

  const loginHref = next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <Card className="space-y-5 p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="" aria-hidden="true" className="h-14 w-14 rounded-xl object-contain" />
          <Wordmark size="lg" />
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{t.auth.registerTitle}</h1>
          <p className="text-sm text-neutral-500">{t.auth.registerSubtitle(siteName)}</p>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" noValidate>
          <Field label={t.auth.emailLabel} htmlFor="register-email" error={fieldErrors.email}>
            <Input
              id="register-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder={t.auth.emailPlaceholder}
              invalid={Boolean(fieldErrors.email)}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field
            label={t.auth.passwordLabel}
            htmlFor="register-password"
            error={fieldErrors.password}
            hint={t.auth.passwordHint(PASSWORD_MIN_LENGTH)}
          >
            <PasswordInput
              id="register-password"
              autoComplete="new-password"
              placeholder={t.auth.passwordPlaceholder}
              invalid={Boolean(fieldErrors.password)}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Field
            label={t.auth.confirmLabel}
            htmlFor="register-confirm-password"
            error={fieldErrors.confirmPassword}
          >
            <PasswordInput
              id="register-confirm-password"
              autoComplete="new-password"
              placeholder={t.auth.confirmPlaceholder}
              invalid={Boolean(fieldErrors.confirmPassword)}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </Field>

          <Field
            label={t.auth.captchaLabel}
            htmlFor="register-captcha"
            error={fieldErrors.captcha}
            hint={t.auth.captchaHint}
          >
            <div className="flex items-center gap-2">
              <span
                aria-live="polite"
                className="flex h-10 min-w-[104px] items-center justify-center rounded-lg border border-neutral-300 bg-neutral-50 px-3 font-mono text-sm font-semibold tabular-nums tracking-wider text-neutral-950 select-none"
              >
                {captcha ? captcha.question : '…'}
              </span>
              <button
                type="button"
                onClick={loadCaptcha}
                aria-label={t.auth.captchaRefresh}
                title={t.auth.captchaRefresh}
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-neutral-300 text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-950"
              >
                <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
              </button>
              <Input
                id="register-captcha"
                inputMode="numeric"
                autoComplete="off"
                className="flex-1"
                placeholder={t.auth.captchaPlaceholder}
                invalid={Boolean(fieldErrors.captcha)}
                value={captchaAnswer}
                onChange={(event) =>
                  setCaptchaAnswer(event.target.value.replace(/[^\d-]/g, ''))
                }
              />
            </div>
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" loading={submitting}>
            {t.auth.registerSubmit}
          </Button>
        </form>

        <p className="text-center text-sm text-neutral-500">
          {t.auth.hasAccount}{' '}
          <Link
            href={loginHref}
            className="font-medium text-neutral-950 underline underline-offset-4 hover:no-underline"
          >
            {t.auth.goLogin}
          </Link>
        </p>
      </Card>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
