#!/usr/bin/env node
/**
 * C-13(b) — worker bundle-size gate.
 *
 * OpenInspection promises one-click deploys on Workers FREE, whose script
 * limit is 3 MiB **gzipped**. A bundle that drifts past it fails every
 * self-hoster's deploy — so the size is a hard pre-commit/CI gate, measured
 * with the EXACT pipeline a real deploy uses:
 *
 *   1. `npm run build` (vendor:copy + gen-version + react-router build —
 *      the real pipeline, so `virtual:react-router/server-build` resolves;
 *      the old pre-commit bundle check died trying to resolve that virtual
 *      module outside the pipeline and trained everyone to --no-verify)
 *   2. `wrangler deploy --dry-run` on the build output — wrangler's own
 *      esbuild pass produces the authoritative upload size, identical to a
 *      real deploy's "Total Upload: X KiB / gzip: Y KiB" line.
 *
 * Hard-fail above the 3 MiB limit; warn above 85% so growth is visible
 * before it becomes a deploy outage. Pass `--skip-build` when a fresh
 * build/ already exists (CI runs build as its own step).
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

const LIMIT_KIB = 3 * 1024; // Workers Free: 3 MiB gzipped script limit
const WARN_RATIO = 0.85;

const skipBuild = process.argv.includes("--skip-build");

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

try {
  if (!skipBuild) {
    console.log("[bundle-size] building (react-router build via npm run build)…");
    sh("npm run build");
  } else if (!existsSync("build/server/wrangler.json")) {
    console.error("[bundle-size] --skip-build given but build/server/wrangler.json is missing — run npm run build first.");
    process.exit(1);
  }

  const out = sh("npx wrangler deploy --dry-run -c build/server/wrangler.json");
  const m = out.match(/Total Upload:\s*([\d.]+)\s*(KiB|MiB)\s*\/\s*gzip:\s*([\d.]+)\s*(KiB|MiB)/i);
  if (!m) {
    console.error("[bundle-size] could not find the 'Total Upload … / gzip …' line in wrangler's dry-run output — wrangler format change?");
    process.exit(1);
  }

  const toKiB = (value, unit) => (unit.toLowerCase() === "mib" ? Number(value) * 1024 : Number(value));
  const rawKiB = toKiB(m[1], m[2]);
  const gzipKiB = toKiB(m[3], m[4]);
  const pct = (gzipKiB / LIMIT_KIB) * 100;

  console.log(
    `[bundle-size] worker upload: ${rawKiB.toFixed(0)} KiB raw / ${gzipKiB.toFixed(0)} KiB gzip ` +
    `(${pct.toFixed(1)}% of the ${LIMIT_KIB / 1024} MiB Workers Free limit)`,
  );

  if (gzipKiB > LIMIT_KIB) {
    console.error(`[bundle-size] FAIL — gzip size exceeds the Workers Free 3 MiB script limit; self-host deploys would break.`);
    process.exit(1);
  }
  if (gzipKiB > LIMIT_KIB * WARN_RATIO) {
    console.warn(`[bundle-size] WARNING — above ${WARN_RATIO * 100}% of the limit; plan a diet before this becomes a deploy outage.`);
  }
  process.exit(0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[bundle-size] gate errored: ${msg.split("\n")[0]}`);
  process.exit(1);
}
