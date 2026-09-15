import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(import.meta.dirname, './src') },
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
