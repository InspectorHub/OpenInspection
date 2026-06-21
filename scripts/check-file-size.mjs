#!/usr/bin/env node
/**
 * Large-file ratchet gate (anti-monolith).
 *
 * Flags source files over MAX_LINES. Files already over the limit are
 * grandfathered in `scripts/file-size-baseline.json` with their current line
 * count as a CAP — the ratchet only tightens:
 *   - a NEW file over the limit              → FAIL
 *   - a grandfathered file GROWS past its cap → FAIL
 *   - a grandfathered file SHRINKS            → OK (run `--update` to lock the lower cap)
 *
 * Splitting a file is the intended fix; bumping the baseline is a deliberate,
 * reviewed escape hatch (same philosophy as db:check's KNOWN_ACCEPTED and the
 * bundle-size cap). Generated files and tests are excluded.
 *
 *   node scripts/check-file-size.mjs            # gate (CI + pre-commit via `lint`)
 *   node scripts/check-file-size.mjs --update   # regenerate the baseline snapshot
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const MAX_LINES = 400;
const root = process.cwd();
const BASELINE = join(root, 'scripts', 'file-size-baseline.json');

// Exclude generated output + tests (they are not hand-maintained source).
const EXCLUDE = [
  /(^|\/)node_modules\//,
  /\.d\.ts$/, // generated decls (worker-configuration.d.ts, etc.)
  /(^|\/)tests?\//,
  /\.(spec|test)\.tsx?$/,
  /(^|\/)build\//,
  /(^|\/)drizzle-tmp\//,
  /(^|\/)\.react-router\//,
  /\/\+types\//, // react-router generated route types
];

const files = execSync('git ls-files "*.ts" "*.tsx"', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !EXCLUDE.some((re) => re.test(f)));

const oversized = {};
for (const f of files) {
  const n = readFileSync(join(root, f), 'utf8').split('\n').length;
  if (n > MAX_LINES) oversized[f] = n;
}

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(oversized).sort((a, b) => b[1] - a[1]));
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`Updated ${BASELINE.replace(root + '\\', '').replace(root + '/', '')}: ${Object.keys(sorted).length} files > ${MAX_LINES} lines.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const violations = [];
for (const [f, n] of Object.entries(oversized)) {
  if (!(f in baseline)) violations.push(`  ✘ NEW file over ${MAX_LINES} lines: ${f} (${n})`);
  else if (n > baseline[f]) violations.push(`  ✘ grew past its cap: ${f} (${n} > baseline ${baseline[f]})`);
}

// Grandfathered files that shrank (or vanished) — not a failure; nudge a ratchet.
const tightened = Object.entries(baseline).filter(
  ([f, cap]) => !(f in oversized) || oversized[f] < cap,
);

if (violations.length) {
  console.log(`\n✘ File-size gate — ${violations.length} violation(s) (limit ${MAX_LINES} lines):`);
  console.log(violations.join('\n'));
  console.log('\n  Fix: split the file into focused units. Only if genuinely unavoidable,');
  console.log('  bump scripts/file-size-baseline.json (a reviewed decision).');
  process.exit(1);
}

console.log(
  `✅ File-size gate — no new files over ${MAX_LINES} lines; ` +
    `${Object.keys(baseline).length} grandfathered (capped at current size).`,
);
if (tightened.length) {
  console.log(
    `   ${tightened.length} grandfathered file(s) shrank — run \`npm run lint:filesize -- --update\` to tighten the ratchet.`,
  );
}
process.exit(0);
