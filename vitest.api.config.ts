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
    // ⚠️ Do NOT turn on `clearMocks` / `mockReset` / `restoreMocks` here without
    // re-reading [redacted]
    // `clearMocks: true` was tried on 2026-08-08 as the first step toward
    // relaxing isolation and MEASURED WORSE: the isolated suite stayed green,
    // but under `--no-isolate` the failure count went 1218 -> 1235 and
    // `this.client.prepare is not a function` went 20 -> 213, because the fake
    // D1 client that `tests/unit/db.ts` hands to drizzle is built from mock
    // functions and gets wiped out from under it. The leakage this suite has is
    // shared MODULE STATE, not spy call history.
    // The suite is IMPORT-bound, not assertion-bound. A full run reported
    // `import 1977s` against `tests 1246s`: with the default forks pool and
    // isolation, each of the 600+ spec files gets a fresh process that rebuilds
    // the whole module graph from scratch.
    //
    // Pre-bundling collapses a dependency's many small ESM files into one, so a
    // fork pays one module fetch instead of dozens. `include` is the whole of
    // it: ONLY the specifiers listed below are pre-bundled, and `enabled: true`
    // on its own caches NOTHING. Vitest hard-sets `noDiscovery: true` on every
    // optimizer environment (`resolveOptimizerConfig`), and Vite treats
    // `noDiscovery && !include.length` as "optimizer off" outright
    // (`isDepOptimizationDisabled`) — so nothing is ever auto-discovered into
    // the list, and an empty list disables the option it appears to configure.
    // `ssr` is the correct key: `environment: 'node'` runs in Vite's ssr
    // environment, and the optimizer is applied per environment NAME. (The
    // ≤ v3 name `web` is read by nothing in v4 — see vitest.config.ts.)
    //
    // 🔴 THE LIST IS EMPTY, AND THAT IS A MEASURED RESULT, NOT AN OVERSIGHT.
    // `include: ['drizzle-orm', 'drizzle-orm/sqlite-core']` was landed and
    // reverted the same day. It worked in every way it was checked — the
    // artifact appeared in deps_ssr/ AND the poison test proved it loaded — and
    // it still broke the suite, in a way no targeted run could show:
    //
    //     Cannot find module '/node_modules/drizzle-orm/d1/index.js&v=b448f4c1'
    //
    // Optimizing ANY entry point of a package version-stamps how the whole
    // package resolves. `drizzle-orm/d1` is `vi.mock`ed by 361 specs and was
    // deliberately kept OUT of `include` for exactly that reason — but out of
    // `include` is not out of reach. Adding it to `exclude` does not help
    // either; the `&v=` query is still attached and the mock's resolution
    // fails. Two calendar specs stopped collecting entirely.
    //
    // So the bar for adding an entry here is higher than "never mocked" and
    // "duplicate-safe" (the two criteria that let `drizzle-orm` through):
    // NO SUBPATH of the package may be mocked or aliased anywhere, and the only
    // way to know is a full `npm run test:unit`. A 31-file sample said yes and
    // was wrong.
    //
    // For the record, the two criteria that still apply on top of that:
    //   - Never mocked, package-wide. `vi.mock('drizzle-orm/d1')` × 361.
    //   - Duplicate-safe. A pre-bundled entry is a SECOND copy of that code.
    //     drizzle would have survived that by design — brands are
    //     `Symbol.for('drizzle:*')` from the global registry and `is()` compares
    //     `entityKind` STRINGS — but `@hono/zod-openapi` would not: it inlines
    //     its own `zod`/`hono` while server code imports both raw, so
    //     `extendZodWithOpenApi` would patch a prototype half the schemas never
    //     see.
    //
    // `exclude` keeps the stubbed Workers packages out: they are aliased above
    // to local stubs, and pre-bundling would resolve the real ones.
    //
    // To verify a change here, look for the artifact, never at the clock. Runs
    // of this suite vary by ±70% on an otherwise busy machine, which is more
    // than any plausible saving. Artifacts land in
    // node_modules/.vite/vitest/<sha1(project label, "" here)>/deps_ssr/ — and
    // "the file appeared" only proves it was BUILT. Prepend `throw new Error()`
    // to it and re-run: the specs must fail.
    //
    // ⚠️ And then run the FULL suite anyway. The poison test answers "is this
    // bundle loaded", which is necessary and, as the revert above shows, not
    // sufficient — it says nothing about what the package's other subpaths now
    // resolve to.
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: [],
          exclude: ['@cloudflare/workers-oauth-provider', 'agents/mcp'],
        },
      },
    },
    // Do NOT set pool: 'threads' here. It was tried and the run dies with a
    // SIGSEGV (exit 139): 312 specs drive an in-memory better-sqlite3, and that
    // native addon does not survive being loaded into worker_threads even
    // though each worker builds its own Database. The default forks pool is a
    // requirement, not an oversight.
    //
    // maxWorkers is deliberately NOT capped either. Capping it to 4 on an
    // 8-core machine was measured at 694s against 611s uncapped — a 13% loss —
    // while the forks only held ~300MB each, so memory was never the
    // constraint. Leave the pool sized to the machine.
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
