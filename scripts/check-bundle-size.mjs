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
 *
 * ── WHY THERE IS A SECOND LIMIT HERE NOW ────────────────────────────────────
 * Compressed script size was never the constraint this project actually hit.
 * A self-hoster hit Cloudflare Error 1102 on `/login` (discussion #325) while
 * this gate was passing comfortably at ~70%: the binding limit is Worker
 * STARTUP TIME — 1 second to parse and execute global scope — and nothing
 * measured it. Cloudflare's own limits page names the cause: "generating or
 * consuming a large schema at the top level is a common cause of exceeding
 * this limit".
 *
 * So the measurement moved from `wrangler deploy --dry-run` to
 * `wrangler check startup`, which reports the SAME size line plus a startup
 * CPU profile, from one build.
 *
 * ⚠️ THE PROFILE IS REPORTED, NEVER ASSERTED ON. Cloudflare's docs are explicit
 * that it runs on the local machine and "results can vary widely"; measured
 * here across four runs of one identical build on one machine: 61.0, 64.0,
 * 65.4, 66.2 ms. A threshold on that number would fail on a slower CI runner
 * for no reason and teach everyone to ignore it.
 *
 * What IS asserted is the ENTRY CHUNK's byte size — deterministic, identical
 * on every machine, and the thing that actually drives startup work. That is
 * the number that moved when the 900 KB OpenAPI snapshot stopped being a
 * module-scope import: 1,272 KiB -> 752 KiB.
 */
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

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

  // `check startup` builds nothing itself here (we already did) and prints the
  // size line plus the startup profile. Needs wrangler >= 4.116.
  const out = sh("npx wrangler check startup -c build/server/wrangler.json");
  const m = out.match(/Bundle:\s*([\d.]+)\s*(KiB|MiB)\s*\/\s*gzip:\s*([\d.]+)\s*(KiB|MiB)/i);
  if (!m) {
    console.error("[bundle-size] could not find the 'Bundle: … / gzip: …' line in `wrangler check startup` output — wrangler format change?");
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

  // ── The startup profile: REPORTED, never asserted on ──────────────────────
  // See the header. It is measured on this machine's CPU, and `wrangler check
  // startup` offers no way to pin CPU or memory — the full option list is
  // --outfile / --workerBundle / --pages / --args. The authoritative number is
  // `startup_time_ms`, which Cloudflare measures on its own hardware and
  // reports from `wrangler deploy` or `wrangler versions upload`.
  const prof = out.match(/Active:\s*([\d.]+)\s*ms/i);
  console.log(
    prof
      ? `[bundle-size] local startup profile: ${prof[1]} ms active (this machine; not comparable across machines, not a gate)`
      : "[bundle-size] local startup profile: not reported by this wrangler",
  );

  // ── The deterministic half, which IS a gate ───────────────────────────────
  // Entry-chunk bytes are identical on every machine and are what actually
  // drives startup work: this is the number that moved 1,302,525 -> 769,776
  // when a 900 KB module-scope JSON import became a deferred one. A ceiling
  // here catches the class of regression that the size gate above cannot see,
  // because compressed upload size barely moves when eager work does.
  const ENTRY = "build/server/index.js";
  const ENTRY_CEILING_BYTES = 850_000;
  if (existsSync(ENTRY)) {
    const bytes = statSync(ENTRY).size;
    const kib = (bytes / 1024).toFixed(0);
    console.log(`[bundle-size] entry chunk (evaluated on every cold start): ${bytes} bytes / ${kib} KiB`);
    if (bytes > ENTRY_CEILING_BYTES) {
      console.error(
        `[bundle-size] FAIL — the entry chunk is over ${ENTRY_CEILING_BYTES} bytes. Something heavy`,
      );
      console.error("  moved into module scope. Find it with `wrangler check startup`, which writes a");
      console.error("  .cpuprofile — open the flamegraph in Chrome DevTools or VS Code — then defer it");
      console.error("  behind a dynamic import the way server/durable-objects/inspector-mcp.ts defers");
      console.error("  the OpenAPI snapshot.");
      process.exit(1);
    }
  } else {
    // Not silently fine: a missing entry chunk means this half measured nothing.
    console.error(`[bundle-size] FAIL — ${ENTRY} is missing, so the entry-chunk ceiling checked nothing.`);
    process.exit(1);
  }

  process.exit(0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[bundle-size] gate errored: ${msg.split("\n")[0]}`);
  process.exit(1);
}
