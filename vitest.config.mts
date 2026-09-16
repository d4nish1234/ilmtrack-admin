import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
      // The data layer marks itself 'server-only', which throws when imported
      // outside a React Server Component. Under Node that guard has nothing to
      // protect, so stub it and let the tests import those modules directly.
      'server-only': resolve(import.meta.dirname, './tests/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The emulator can be slow to answer the first query.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Tests share one emulator project; run them in order.
    fileParallelism: false,
  },
});
