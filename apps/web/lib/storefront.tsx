'use client';

import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { PublicStorefrontDto, StorefrontTheme } from '@webcatt/shared';
import { apiBaseUrl } from '@/lib/api';

interface StorefrontContextValue extends PublicStorefrontDto {
  mediaUrl: (id: string | null) => string | null;
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export function StorefrontProvider({ config, children }: { config: PublicStorefrontDto; children: ReactNode }) {
  const value = useMemo<StorefrontContextValue>(() => ({
    ...config,
    mediaUrl: (id) => id ? `${apiBaseUrl()}/storefront/media/${id}` : null,
  }), [config]);
  return (
    <StorefrontContext.Provider value={value}>
      <div data-storefront-root data-store-preset={config.document.theme.preset} data-store-button-style={config.document.theme.buttonStyle} data-store-density={config.document.theme.density} className="min-h-screen bg-[var(--store-background)] text-[var(--store-foreground)]" style={themeVariables(config.document.theme)}>
        {children}
      </div>
    </StorefrontContext.Provider>
  );
}

export function useStorefront(): StorefrontContextValue {
  const value = useContext(StorefrontContext);
  if (!value) throw new Error('useStorefront phải nằm trong StorefrontProvider.');
  return value;
}

export function themeVariables(theme: StorefrontTheme): CSSProperties {
  const density = theme.density === 'compact' ? 0.82 : theme.density === 'spacious' ? 1.18 : 1;
  const heading = fontFamily(theme.headingFont);
  const body = fontFamily(theme.bodyFont);
  return {
    '--store-background': theme.colors.background,
    '--store-surface': theme.colors.surface,
    '--store-foreground': theme.colors.foreground,
    '--store-muted': theme.colors.muted,
    '--store-primary': theme.colors.primary,
    '--store-primary-foreground': theme.colors.primaryForeground,
    '--store-border': theme.colors.border,
    '--store-success': theme.colors.success,
    '--store-danger': theme.colors.danger,
    '--store-radius': `${theme.radius}px`,
    '--store-container': `${theme.containerWidth}px`,
    '--store-density': String(density),
    '--store-control-height': `${Math.round(40 * density)}px`,
    '--store-heading-font': heading,
    '--store-body-font': body,
    fontFamily: body,
  } as CSSProperties;
}

function fontFamily(font: StorefrontTheme['bodyFont']): string {
  if (font === 'system-serif') return 'Georgia, Cambria, Times New Roman, serif';
  if (font === 'system-mono') return 'var(--font-geist-mono), ui-monospace, monospace';
  if (font === 'system-sans') return 'Arial, Helvetica, sans-serif';
  return 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif';
}
