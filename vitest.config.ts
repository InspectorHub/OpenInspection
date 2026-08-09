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
    // There is deliberately no `deps.optimizer` block. Vite's pre-bundler only
    // substitutes BARE specifiers that resolve into node_modules, and it is keyed
    // by Vite ENVIRONMENT name — "client" for the files that declare happy-dom,
    // "ssr" for the node ones. (Vitest 3's `web` key is read by nothing in
    // Vitest 4; naming it silently optimizes neither environment.)
    //
    // ⚠️ THE POINT IS NOT THAT NOTHING COULD WORK HERE — an earlier draft of this
    // comment said that and it was too strong. `vitest.api.config.ts` proves the
    // opposite for real bare dependencies: with the `ssr` key and an explicit
    // `include`, a bundle is emitted AND loaded (verified by poisoning it). This
    // config is also `environment: 'node'`, so the same would work.
    //
    // What is genuinely out of reach is the module that motivated looking:
    // an aliased app source such as `~/paraglide/messages` is rewritten to a
    // project path before the optimizer's resolver sees the specifier, so listing
    // one emits a bundle under node_modules/.vite/vitest/<hash>/deps* that no test
    // ever loads. And note `resolveOptimizerConfig` hardcodes its own exclude list
    // — `['vitest', 'react', 'vue', …]`, matched by EXACT name, so `react-dom` is
    // NOT on it and `resolve.dedupe` above is what keeps that one single.
    //
    // So: adding an entry here is a real option, and it needs the same two tests
    // the api config's entries had to pass — is the specifier ever `vi.mock`ed,
    // and does a second copy of it break identity for anything.
    //
    // If a future change reintroduces it: the proof that an entry did anything is
    // that an artifact for it appears in that deps directory, never that a run got
    // faster. Transform time swings by several seconds between identical runs.
    //
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
