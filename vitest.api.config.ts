import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // `cloudflare:workers` is only available in the Workers runtime; stub
      // it out so route-metadata tests can import server/index.ts in Node.
      'cloudflare:workers': path.resolve(__dirname, 'tests/unit/stubs/cloudflare-workers.ts'),
      // The remote-MCP feature pulls two Workers-runtime-only packages into the
      // worker-entry graph (workers/app.ts → oauth-provider.ts and the
      // re-exported InspectorMcp → inspector-mcp.ts). Both packages' dist code
      // does `import ... from "cloudflare:workers" | "cloudflare:email"` at
      // module load, which Node's ESM loader rejects. They're external
      // node_modules (native-loaded), so the `cloudflare:*` aliases above can't
      // reach inside them — instead alias each package to a local stub so the
      // real ones are never loaded in Node. The real packages run in the
      // Workers-runtime tests (tests/workers/mcp/*) and production.
      '@cloudflare/workers-oauth-provider': path.resolve(__dirname, 'tests/unit/stubs/workers-oauth-provider.ts'),
      'agents/mcp': path.resolve(__dirname, 'tests/unit/stubs/agents-mcp.ts'),
      // `server/lib/i18n/messages.ts` re-exports the compiled Paraglide
      // catalogue, which lives under `app/`. The worker build resolves this
      // through vite.config.ts's own `~` alias and the api tsc pass through
      // tsconfig.api.json's `paths`; this is the third resolver that has to
      // agree, and without it every api spec that reaches a server-side
      // message fails to import rather than to assert.
      '~': path.resolve(__dirname, 'app'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Load `scripts/*.mjs` (e.g. the tenant-scoping gate) via native Node import
    // instead of vitest's transform pipeline, which throws "Invalid or unexpected
    // token" on these standalone build scripts. Tests import their exported pure
    // functions through a runtime `import(fileURL)`.
    server: { deps: { external: [/scripts[\\/].+\.mjs$/] } },
    // Per-file environment overrides: add `// @vitest-environment happy-dom`
    // docblock to client-side test files (db, sync-engine, photo-resize, etc.)
    // that need a DOM environment. This is the vitest v4 equivalent of the
    // v1 `environmentMatchGlobs` option (removed in v2+).
    //
    // No global setupFiles. The only thing setup ever did was pull in
    // fake-indexeddb for the three happy-dom collab specs, and a setup file runs
    // for EVERY spec: 558 node-environment files were loading an IndexedDB
    // polyfill they never touch (measured: 76s of the suite's CPU). The three
    // that need it import it themselves.
    include: ['tests/unit/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['server/services/**/*.ts'],
    },
  },
});
