#!/usr/bin/env node
/**
 * SVG-dimensions guardrail.
 *
 * Every SVG served from `public/` MUST declare an intrinsic `width` AND
 * `height` on its root <svg>, not just a `viewBox`. An `<img src="/x.svg">`
 * with no intrinsic size falls back to the replaced-element default (~300px)
 * until the stylesheet loads and resizes it — a large "logo FOUC" flash on
 * every cold load (the bug fixed 2026-06-28). A `viewBox` alone does not set
 * intrinsic size, so it does not prevent the flash.
 *
 * Fix a violation by adding width/height to the root <svg> that preserve the
 * viewBox aspect, e.g. viewBox="0 0 470 400" -> width="47" height="40".
 *
 * Runs in `npm run lint` (CI gate) and the pre-commit hook.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "public";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.toLowerCase().endsWith(".svg")) out.push(p);
  }
  return out;
}

let files = [];
try {
  files = walk(ROOT);
} catch {
  // No public/ directory (e.g. a package with no static assets) → nothing to check.
  console.log("SVG-dimensions gate: OK (no public/ directory).");
  process.exit(0);
}

const violations = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const m = src.match(/<svg\b[^>]*>/i);
  if (!m) {
    violations.push([f, "no <svg> root tag found"]);
    continue;
  }
  const tag = m[0];
  const hasWidth = /\bwidth\s*=/.test(tag);
  const hasHeight = /\bheight\s*=/.test(tag);
  if (!hasWidth || !hasHeight) {
    const missing = [!hasWidth && "width", !hasHeight && "height"].filter(Boolean).join(" + ");
    violations.push([f, `missing ${missing}`]);
  }
}

if (violations.length) {
  console.error("SVG-dimensions gate: FAIL — public SVGs must declare intrinsic width + height (prevents logo FOUC).");
  for (const [f, why] of violations) console.error(`  ${f} — ${why}`);
  console.error('\nFix: add width="N" height="M" to the root <svg>, preserving the viewBox aspect.');
  process.exit(1);
}

console.log(`SVG-dimensions gate: OK (${files.length} public SVG${files.length === 1 ? "" : "s"} checked).`);
