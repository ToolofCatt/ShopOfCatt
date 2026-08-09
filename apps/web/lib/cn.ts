export type ClassValue = string | number | null | false | undefined;

/** Join truthy class names — tiny local replacement for clsx (no external deps). */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}
