import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // `cloudflare:workers` is only available in the Workers runtime; stub
      // it out so route-metadata tests can import server/index.ts in Node.
      'cloudflare:workers': path.resolve(__dirname, 'tests/unit/stubs/cloudflare-workers.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Per-file environment overrides: add `// @vitest-environment happy-dom`
    // docblock to client-side test files (db, sync-engine, photo-resize, etc.)
    // that need a DOM environment. This is the vitest v4 equivalent of the
    // v1 `environmentMatchGlobs` option (removed in v2+).
    setupFiles: ['tests/unit/setup-client.ts'],
    include: ['tests/unit/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/services/**/*.ts'],
    },
  },
});
