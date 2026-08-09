import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import type { OrderStatus } from '@webcatt/shared';
import { cn } from '@/lib/cn';

/* ============================== Spinner ============================== */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 strokeWidth={2} className={cn('h-4 w-4 animate-spin', className)} aria-hidden="true" />;
}

/* ============================== Button ============================== */

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-neutral-950 text-white hover:bg-neutral-800',
  outline: 'border border-neutral-300 bg-white text-neutral-950 hover:border-neutral-500 hover:bg-neutral-50',
  ghost: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
  danger: 'border border-red-200 bg-white text-red-600 hover:border-red-400 hover:bg-red-50',
};

const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
};

/** Class builder — lets <Link> and <a> elements render as buttons. */
export function buttonVariants(
  options: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {},
): string {
  const { variant = 'primary', size = 'md', className } = options;
  return cn(
    'inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-lg font-medium transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950',
    'disabled:pointer-events-none disabled:opacity-50',
    BUTTON_VARIANT_CLASSES[variant],
    BUTTON_SIZE_CLASSES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={buttonVariants({ variant, size, className })}
      {...rest}
    >
      {loading && <Spinner className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      {children}
    </button>
  );
}

/* ============================== Input / Label / Field ============================== */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ className, invalid = false, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-lg border bg-white px-3 text-sm text-neutral-950 transition-colors',
        'placeholder:text-neutral-400 focus:outline-none focus:ring-2',
        invalid
          ? 'border-red-400 focus:border-red-500 focus:ring-red-600/10'
          : 'border-neutral-300 focus:border-neutral-950 focus:ring-neutral-950/10',
        className,
      )}
      {...rest}
    />
  );
}

export function Label({ className, children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('block text-sm font-medium text-neutral-800', className)} {...rest}>
      {children}
    </label>
  );
}

export interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, className, children }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-neutral-500">{hint}</p>
      ) : null}
    </div>
  );
}

/* ============================== Badge ============================== */

export type BadgeVariant = 'solid' | 'outline' | 'muted' | 'success';

const BADGE_VARIANT_CLASSES: Record<BadgeVariant, string> = {
  solid: 'bg-neutral-950 text-white',
  outline: 'border border-neutral-300 text-neutral-700',
  muted: 'bg-neutral-100 text-neutral-500',
  success: 'bg-emerald-600 text-white',
};

export interface BadgeProps {
  variant?: BadgeVariant;
  className?: string;
  children: ReactNode;
}

export function Badge({ variant = 'outline', className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        BADGE_VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Monochrome status mapping — emerald reserved for DELIVERED (success) only. */
export const ORDER_STATUS_BADGE_VARIANT: Record<OrderStatus, BadgeVariant> = {
  PENDING: 'outline',
  PAID: 'solid',
  DELIVERED: 'success',
  CANCELLED: 'muted',
  EXPIRED: 'muted',
};

/* Nhãn trạng thái phụ thuộc ngôn ngữ → xem components/order-status-badge.tsx */

/* ============================== Card ============================== */

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border border-neutral-200 bg-white', className)} {...rest}>
      {children}
    </div>
  );
}

/* ============================== EmptyState ============================== */

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-neutral-300 px-6 py-16 text-center',
        className,
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
        <Icon strokeWidth={1.75} className="h-6 w-6 text-neutral-500" />
      </span>
      <p className="font-semibold tracking-tight text-neutral-950">{title}</p>
      {hint && <p className="max-w-sm text-sm text-neutral-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
