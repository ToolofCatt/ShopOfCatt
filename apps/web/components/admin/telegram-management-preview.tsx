'use client';

import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  TELEGRAM_ADMIN_PERMISSIONS,
  telegramAdminText,
  type TelegramAdminPermission,
} from '@webcatt/shared';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { apiFetch } from '@/lib/api';
import { Button, Spinner } from '@/components/ui';

interface View {
  text: string;
  keyboard: { text: string; callback_data: string }[][];
}
export function TelegramManagementPreview() {
  const { token } = useAuth();
  const { locale } = useI18n();
  const [permission, setPermission] =
    useState<TelegramAdminPermission>('OPERATOR');
  const [screen, setScreen] = useState('home');
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    setError(false);
    setView(null);
    void apiFetch<View>(
      `/admin/telegram/management-preview?lang=${locale}&permission=${permission}&screen=${screen}`,
      { token },
    )
      .then((v) => {
        if (current) setView(v);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [token, locale, permission, screen]);
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex items-center gap-2">
        <select
          className="h-9 min-w-0 flex-1 rounded-md border border-neutral-300 px-2 text-sm"
          aria-label={telegramAdminText(locale, 'permission')}
          value={permission}
          onChange={(e) => {
            setPermission(e.target.value as TelegramAdminPermission);
            setScreen('home');
          }}
        >
          {TELEGRAM_ADMIN_PERMISSIONS.map((p) => (
            <option key={p} value={p}>
              {telegramAdminText(locale, p)}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="sm"
          aria-label={telegramAdminText(locale, 'refresh')}
          title={telegramAdminText(locale, 'refresh')}
          onClick={() => setScreen('home')}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-80 rounded-md border border-neutral-200 bg-[#eff4f2] p-3">
        {error ? (
          <p role="alert">{telegramAdminText(locale, 'error')}</p>
        ) : !view ? (
          <Spinner />
        ) : (
          <>
            <div
              className="whitespace-pre-wrap break-words rounded-md bg-white p-3 text-sm leading-6"
              dangerouslySetInnerHTML={{ __html: view.text }}
            />
            <div className="mt-2 space-y-1">
              {view.keyboard.map((row, i) => (
                <div key={i} className="flex gap-1">
                  {row.map((button) => (
                    <button
                      key={button.callback_data}
                      className="min-h-9 min-w-0 flex-1 rounded border border-neutral-300 bg-white/80 px-2 py-1 text-sm"
                      onClick={() =>
                        setScreen(button.callback_data.replace(/^demo:/, ''))
                      }
                    >
                      {button.text}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
