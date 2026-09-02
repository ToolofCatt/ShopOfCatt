import { defineConfig } from 'vitest/config';

export default defineConfig({
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
