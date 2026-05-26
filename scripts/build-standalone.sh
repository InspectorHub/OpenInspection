#!/bin/bash
# Build OpenInspection as a single CF Worker (standalone mode).
# Usage:  bash scripts/build-standalone.sh [--deploy]
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[1/5] Building Remix frontend..."
cd frontend
mkdir -p build && echo "export default {}" > build/worker-entry.js
npx react-router build
cd "$ROOT"

echo "[2/5] Copying frontend assets to api/public..."
mkdir -p api/public/assets
cp -r frontend/build/client/assets/* api/public/assets/ 2>/dev/null || true
for f in manifest.json sw.js widget.js; do
  [ -f "frontend/build/client/$f" ] && cp "frontend/build/client/$f" "api/public/$f"
done

echo "[3/5] Copying SSR bundle into API directory..."
cp frontend/build/server/index.js api/src/remix-ssr-bundle.js

echo "[4/5] Generating version..."
node scripts/gen-version.js

echo "[5/5] Build complete."
echo "Deploy: npx wrangler deploy -c wrangler.standalone.toml"

if [ "$1" = "--deploy" ]; then
  echo "Deploying..."
  npx wrangler deploy -c wrangler.standalone.toml
fi
