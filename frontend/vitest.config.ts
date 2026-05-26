import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'app'),
      '@core/shared-ui': path.resolve(__dirname, '../packages/shared-ui/src'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/unit/**/*.spec.ts', 'tests/unit/**/*.test.ts'],
  },
});
