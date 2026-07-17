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
    // i18n Phase C — compile inlang messages to app/paraglide before RR resolves
    // imports. strategy cookie→baseLocale ONLY: the default `globalVariable` is a
    // module-global that is not request-safe under multi-tenant SSR concurrency
    // (see the Phase C design §3a); locale is scoped per-request via AsyncLocalStorage
    // (paraglideMiddleware in workers/app.ts).
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./app/paraglide",
      strategy: ["cookie", "baseLocale"],
      emitTsDeclarations: true,
    }),
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: "ssr" }, configPath: wranglerConfig }),
    reactRouter(),
  ],
});
