#!/bin/bash
# Build + deploy Remix frontend to CF Workers
# Usage: npm run deploy
set -e

echo "[1/3] Building Remix frontend..."
npx react-router build

echo "[2/3] Creating SSR worker entry..."
cat > build/worker-entry.js << 'EOF'
import { createRequestHandler } from "react-router";
import * as serverBuild from "./server/index.js";
const handler = createRequestHandler(serverBuild, "production");
export default {
  async fetch(request, env, ctx) {
    if (env.API_WORKER) globalThis.__API_WORKER = env.API_WORKER;
    if (env.API_URL) globalThis.__API_URL = env.API_URL;
    if (env.SESSION_SECRET) globalThis.__SESSION_SECRET = env.SESSION_SECRET;
    const url = new URL(request.url);
    if (env.ASSETS) {
      if (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.svg" || url.pathname === "/logo.svg" || url.pathname === "/manifest.json" || url.pathname.endsWith(".css") || url.pathname.endsWith(".js") || url.pathname.endsWith(".svg") || url.pathname.endsWith(".woff2")) {
        const r = await env.ASSETS.fetch(request);
        if (r.status !== 404) return r;
      }
    }
    try { return await handler(request, { cloudflare: { env, ctx } }); }
    catch (err) { console.error("SSR error:", err); return new Response("Internal Server Error", { status: 500 }); }
  },
};
EOF

# Patch generated wrangler.json: set main entry (Vite plugin leaves it empty)
node -e "
  const fs = require('fs');
  const f = 'build/client/wrangler.json';
  let raw = fs.readFileSync(f, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const c = JSON.parse(raw);
  c.main = '../worker-entry.js';
  fs.writeFileSync(f, JSON.stringify(c));
"

echo "[3/3] Deploying to Cloudflare Workers..."
npx wrangler deploy --config build/client/wrangler.json

echo "Done!"
