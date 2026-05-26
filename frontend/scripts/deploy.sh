#!/bin/bash
# Build + deploy Remix frontend to CF Workers
# Usage: npm run deploy

set -e

echo "Building Remix frontend..."
npx react-router build

echo "Creating SSR worker entry..."
cat > build/worker-entry.js << 'EOF'
import { createRequestHandler } from "react-router";
import * as serverBuild from "./server/index.js";
const handler = createRequestHandler(serverBuild, "production");
export default {
  async fetch(request, env, ctx) {
    if (env.API_WORKER) globalThis.__API_WORKER = env.API_WORKER;
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

echo "Deploying to Cloudflare Workers..."
npx wrangler deploy

echo "Done!"
