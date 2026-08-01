import path from "node:path";
import { existsSync } from "node:fs";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

// Which wrangler config the cloudflare plugin bakes into the build:
//   WRANGLER_CONFIG env wins (e.g. deploy:saas sets wrangler.saas.jsonc);
//   else a local real-id wrangler.local.jsonc if present (dev / your own deploy);
//   else the committed placeholder wrangler.jsonc (one-click deploy — CF provisions).
const wranglerConfig =
  process.env.WRANGLER_CONFIG ||
  (existsSync("wrangler.local.jsonc") ? "wrangler.local.jsonc" : "wrangler.jsonc");

/**
 * Keep the canvas stack out of the WORKER bundle.
 *
 * `react-konva` drags konva, react-reconciler and normalize-wheel behind it,
 * and all four were landing in the server build even though `PhotoAnnotator` —
 * their only consumer — gates every render behind a client-only `mounted` flag
 * because konva touches the DOM. None of it can execute on the server; it was
 * pure freight.
 *
 * That matters because OpenInspection promises one-click deploys on Workers
 * Free, whose script limit is 3 MiB gzipped, and the worker had drifted to the
 * ceiling. `React.lazy` does NOT fix this — every emitted chunk still counts
 * toward the upload, so the module has to leave the server graph entirely.
 *
 * A `resolve.alias` under `environments.ssr` is the tidier-looking spelling and
 * it silently does nothing here (the build output was byte-identical, same
 * chunk hash) — the framework plugins own that config. Resolving by hand is
 * explicit and verifiable: `grep -c node_modules/konva build/server/assets/*.js`
 * must find nothing.
 */
function konvaSsrStub(): Plugin {
  return {
    name: "oi:konva-ssr-stub",
    enforce: "pre",
    resolveId(source) {
      if (source !== "react-konva") return null;
      if (this.environment?.name !== "ssr") return null;
      return path.resolve(__dirname, "app/components/media-studio/react-konva.ssr-stub.tsx");
    },
  };
}

export default defineConfig({
  /**
   * MINIFY THE WORKER. Vite turns minification off for SSR builds by default,
   * on the reasonable assumption that server output runs in Node where bytes do
   * not matter. Here the "SSR" build IS the deployed artifact, and Workers Free
   * caps the script at 3 MiB gzipped — so the default shipped the worker as
   * 177k lines of unminified source, averaging 37 bytes a line.
   *
   * That is why the bundle sat at the ceiling while every diet attempt went
   * looking for whole dependencies to remove: the largest single saving was not
   * a dependency at all, it was a build flag nobody had set.
   *
   * `esbuild` (not terser) because the build already runs it and the difference
   * between the two is a couple of percent against a saving measured in tens.
   * Exported names — the `fetch`/`queue`/`scheduled` handlers and the
   * `InspectionDocDO` class that `wrangler.jsonc` binds BY NAME — are preserved
   * by esbuild's minifier; `check:bundle` and the DO binding both fail loudly if
   * that ever stops being true.
   */
  build: { minify: "esbuild" },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "app"),
      "@core/shared-ui": path.resolve(__dirname, "packages/shared-ui/src"),
    },
  },
  plugins: [
    konvaSsrStub(),
    // i18n — compile inlang messages to app/paraglide before RR resolves imports.
    // Strategy cookie→baseLocale ONLY: the framework ships DORMANT (nothing sets
    // the PARAGLIDE_LOCALE cookie yet), so every request resolves to baseLocale
    // ('en') — extraction adds English messages with zero visible change. The
    // locale SOURCE (Accept-Language / stored preference) and the language switcher
    // are a later phase, added once translations exist. The default `globalVariable`
    // strategy is excluded — it is a module-global, not request-safe under
    // multi-tenant SSR concurrency (design §3a); locale is scoped per-request via
    // AsyncLocalStorage (paraglideMiddleware in workers/app.ts).
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./app/paraglide",
      strategy: ["cookie", "baseLocale"],
      // One module per locale instead of one per message. On an SSR Worker every
      // message ships regardless of per-message tree-shaking, so message-modules
      // buys nothing here but emits ~2 files per message (thousands total), which
      // makes importing `~/paraglide/messages` O(catalog-size) slow to resolve in
      // the vitest/happy-dom test env (timeouts). locale-modules keeps it ~1 file
      // per locale — fast import, same shipped output.
      outputStructure: "locale-modules",
      emitTsDeclarations: true,
    }),
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: "ssr" }, configPath: wranglerConfig }),
    reactRouter(),
  ],
});
