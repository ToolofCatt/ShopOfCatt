'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { apiErrorMessage } from '@/lib/api';
import { safeCustomerNext } from '@/lib/customer-navigation';
import { SupportPanel } from '@/components/support-panel';
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
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeCustomerNext(searchParams.get('next'));
  const { user, loading: authLoading, login } = useAuth();
  const { t } = useI18n();
  const storefront = useStorefront();
  const siteName = storefront.document.brand.name || 'Digital Store';
  const logo = storefront.mediaUrl(storefront.document.brand.logoAssetId) ?? '/logo-mark.png';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      await login(email.trim(), password);
      router.push(next);
    } catch (err) {
      setError(apiErrorMessage(err, t.common.connectionError));
      setSubmitting(false);
    }
  };

  const registerHref =
    next !== '/' ? `/register?next=${encodeURIComponent(next)}` : '/register';

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
          <h1 className="text-xl font-semibold tracking-tight">{t.auth.loginTitle}</h1>
          <p className="text-sm text-neutral-500">{t.auth.loginSubtitle(siteName)}</p>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4" noValidate>
          <Field label={t.auth.emailLabel} htmlFor="login-email" error={fieldErrors.email}>
            <Input
              id="login-email"
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

          <Field label={t.auth.passwordLabel} htmlFor="login-password" error={fieldErrors.password}>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              placeholder={t.auth.passwordPlaceholder}
              invalid={Boolean(fieldErrors.password)}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" className="w-full" loading={submitting}>
            {t.auth.loginSubmit}
          </Button>
        </form>

        <SupportPanel title={t.auth.forgotTitle} hint={t.auth.forgotHint} />

        <p className="text-center text-sm text-neutral-500">
          {t.auth.noAccount}{' '}
          <Link
            href={registerHref}
            className="font-medium text-neutral-950 underline underline-offset-4 hover:no-underline"
          >
            {t.auth.goRegister}
          </Link>
        </p>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6 text-neutral-400" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
