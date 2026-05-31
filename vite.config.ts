import path from "node:path";
import { existsSync } from "node:fs";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
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
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: "ssr" }, configPath: wranglerConfig }),
    reactRouter(),
  ],
});
