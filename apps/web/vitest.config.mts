import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  test: {
    include: ['**/*.spec.ts', '**/*.spec.tsx'],
    exclude: ['.next/**', 'node_modules/**'],
  },
});
