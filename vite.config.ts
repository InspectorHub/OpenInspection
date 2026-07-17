import path from "node:path";
import { existsSync } from "node:fs";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Which wrangler config the cloudflare plugin bakes into the build:
//   WRANGLER_CONFIG env wins (e.g. deploy:saas sets wrangler.saas.jsonc);
//   else a local real-id wrangler.local.jsonc if present (dev / your own deploy);
//   else the committed placeholder wrangler.jsonc (one-click deploy — CF provisions).
const wranglerConfig =
  process.env.WRANGLER_CONFIG ||
  (existsSync("wrangler.local.jsonc") ? "wrangler.local.jsonc" : "wrangler.jsonc");

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "app"),
      "@core/shared-ui": path.resolve(__dirname, "packages/shared-ui/src"),
    },
  },
  plugins: [
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
