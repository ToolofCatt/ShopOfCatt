import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  /** Ô nổi bật (nền đen, chữ trắng) — dùng cho chỉ số quan trọng nhất. */
  accent?: boolean;
  className?: string;
}

/**
 * Ô chỉ số: nhãn mờ ở trên, số lớn ở dưới, biểu tượng nhỏ góc phải.
 * Biểu tượng đặt ở góc để con số là thứ mắt nhìn thấy trước.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent = false,
  className,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        'relative overflow-hidden p-5',
        accent && 'border-neutral-950 bg-neutral-950',
        className,
      )}
    >
      <Icon
        strokeWidth={1.75}
        aria-hidden="true"
        className={cn(
          'absolute right-4 top-4 h-5 w-5',
          accent ? 'text-white/40' : 'text-neutral-300',
        )}
      />
      <p
        className={cn(
          'pr-8 text-sm',
          accent ? 'text-neutral-400' : 'text-neutral-500',
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          'mt-2 text-2xl font-semibold tabular-nums tracking-tight',
          accent ? 'text-white' : 'text-neutral-950',
        )}
      >
        {value}
      </p>
      {hint && (
        <p
          className={cn(
            'mt-1 text-xs',
            accent ? 'text-neutral-400' : 'text-neutral-500',
          )}
        >
          {hint}
        </p>
      )}
    </Card>
  );
}
