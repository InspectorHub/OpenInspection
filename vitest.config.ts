import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // Dedupe React so a component pulled in from packages/shared-ui (which has a
    // nested react copy) shares the single root React instance — otherwise its
    // hooks throw "Invalid hook call" under the test renderer.
    dedupe: ['react', 'react-dom'],
    alias: {
      '~': path.resolve(__dirname, 'app'),
      '@core/shared-ui': path.resolve(__dirname, 'packages/shared-ui/src'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: [
      'app/**/*.test.ts',
      'app/**/*.test.tsx',
      'packages/shared-ui/src/**/*.test.ts',
      'packages/shared-ui/src/**/*.test.tsx',
    ],
    setupFiles: ['tests/setup-web.ts'],
  },
});
