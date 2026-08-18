'use client';

import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import type { TranslatableLocale, TranslationStatusDto } from '@webcatt/shared';
import { ApiError, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';

/**
 * Trạng thái dịch tự động của máy chủ (`GET /admin/translation/status`).
 * `null` = đang tải; khi gọi lỗi thì coi như chưa cấu hình để nút bị khoá.
 */
export function useTranslationStatus(): TranslationStatusDto | null {
  const { token } = useAuth();
  const [status, setStatus] = useState<TranslationStatusDto | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<TranslationStatusDto>('/admin/translation/status', { token })
      .then((data) => {
        if (active) setStatus(data);
      })
      .catch(() => {
        if (active)
          setStatus({ configured: false, source: null, provider: 'anthropic', model: '' });
      });
    return () => {
      active = false;
    };
  }, [token]);

  return status;
}

/**
 * Thông báo lỗi cho khối dịch: lỗi API dùng nguyên văn từ máy chủ, còn lỗi
 * thường (kiểm tra biểu mẫu phía web) đã mang sẵn câu tiếng người dùng đọc được.
 */
function translateErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.status === 0 ? fallback : err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export interface TranslationField {
  label: string;
  value: string;
  /** Giữ nguyên xuống dòng (dùng cho mô tả / nội dung dài). */
  multiline?: boolean;
}

export interface TranslationBlock {
  locale: TranslatableLocale;
  label: string;
  fields: TranslationField[];
}

export interface TranslationSectionProps {
  blocks: TranslationBlock[];
  /**
   * Lưu bản tiếng Việt rồi gọi endpoint dịch. Ném lỗi khi thất bại —
   * khối này tự hiển thị thông báo.
   */
  onTranslate: () => Promise<void>;
  className?: string;
}

/**
 * Khối "Bản dịch tự động": nút dịch (khoá khi máy chủ chưa cấu hình khoá API)
 * + bảng bản dịch EN/ZH chỉ đọc.
 */
export function TranslationSection({ blocks, onTranslate, className }: TranslationSectionProps) {
  const { t } = useI18n();
  const status = useTranslationStatus();

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const configured = status?.configured === true;
  const isEmpty = blocks.every((block) => block.fields.every((field) => !field.value.trim()));

  const handleTranslate = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setDone(false);
    try {
      await onTranslate();
      setDone(true);
    } catch (err) {
      setError(translateErrorMessage(err, t.common.connectionError));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={className}>
      <h2 className="text-lg font-semibold tracking-tight text-neutral-950">
        {t.admin.translationsTitle}
      </h2>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            variant="outline"
            loading={running}
            disabled={!configured}
            onClick={() => void handleTranslate()}
          >
            {!running && <Languages strokeWidth={1.75} className="h-4 w-4" />}
            {t.admin.translateAction}
          </Button>
          {status !== null && configured && (
            <span className="text-xs text-neutral-500">
              {t.admin.translateModel(status.model)}
            </span>
          )}
        </div>
        {configured ? (
          <p className="text-xs text-neutral-500">{t.admin.translateHintSaves}</p>
        ) : (
          status !== null && (
            /*
              Trước đây chỗ này KHÔNG hiện gì: nút chỉ mờ đi, chủ shop không đoán
              nổi vì sao bấm không được. Nay nói thẳng là thiếu khoá và chỉ chỗ dán.
            */
            <p className="text-xs text-neutral-500">{t.admin.translateNoKey}</p>
          )
        )}
        {done && !error && (
          <p className="text-sm font-medium text-emerald-600">{t.admin.translateDone}</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="mt-5 border-t border-neutral-100 pt-5">
        {isEmpty ? (
          <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
            {t.admin.translationsEmpty}
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {blocks.map((block) => (
              <div key={block.locale} className="rounded-lg border border-neutral-200 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {block.label}
                </p>
                <dl className="mt-3 space-y-3">
                  {block.fields.map((field) => (
                    <div key={field.label}>
                      <dt className="text-xs text-neutral-500">{field.label}</dt>
                      <dd
                        className={cn(
                          'mt-0.5 break-words text-sm text-neutral-950',
                          field.multiline && 'whitespace-pre-line',
                        )}
                      >
                        {field.value.trim() ? field.value : t.common.dash}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
