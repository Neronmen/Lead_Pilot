import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname) } },
  test: { include: ['**/*.test.ts', '**/*.test.tsx'], exclude: ['node_modules', '.next', 'e2e'] },
});
