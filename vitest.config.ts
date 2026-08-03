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
    // Node by default; a file that needs a browser declares it with a
    // `// @vitest-environment happy-dom` docblock — the same shape
    // vitest.api.config.ts already uses, so both suites read the same way.
    //
    // 136 of the 305 web spec files touch no browser API at all: no render, no
    // document/window, no storage, no testing-library. Under a blanket
    // happy-dom they each built a full DOM and loaded the jest-dom matchers to
    // use neither.
    //
    // The direction matters more than the saving. Declaring the browser (rather
    // than declaring its absence) means a component test written without the
    // docblock fails loudly on its first render, in the file whose author can
    // fix it. The opposite default would let the waste silently reaccumulate,
    // one new pure-logic spec at a time, with nothing to notice.
    environment: 'node',
    // Same reasoning as vitest.api.config.ts: the cost is rebuilding the module
    // graph per spec file, not running assertions. React, react-dom and the
    // testing-library stack are the bulk of it here. Cached in
    // node_modules/.vite keyed on the dependency set.
    //
    // react/react-dom are excluded because `resolve.dedupe` above exists to
    // keep exactly ONE React instance alive across the root and the nested copy
    // under packages/shared-ui — pre-bundling them risks handing a component a
    // second instance, which surfaces as "Invalid hook call" rather than as a
    // clear failure.
    deps: {
      optimizer: {
        web: {
          enabled: true,
          exclude: ['react', 'react-dom'],
        },
      },
    },
    // No maxWorkers cap and no pool override — see vitest.api.config.ts for the
    // measurements behind both. Capping cost 13% of wall-clock for memory that
    // was never scarce, and the threads pool segfaults on better-sqlite3.
    include: [
      'app/**/*.test.ts',
      'app/**/*.test.tsx',
      'packages/shared-ui/src/**/*.test.ts',
      'packages/shared-ui/src/**/*.test.tsx',
    ],
    setupFiles: ['tests/setup-web.ts'],
  },
});
