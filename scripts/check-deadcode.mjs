#!/usr/bin/env node
/**
 * Dead-code anti-drift gate — baseline-ratchet model over `knip`.
 *
 * Runs `knip` (config: `knip.json`) and compares its findings against a frozen
 * snapshot in `scripts/knip-baseline.json`. Any NEW finding not in the baseline
 * fails the gate (exit 1); pre-existing findings pass silently. Stale baseline
 * entries that no longer hit are informational only (run `--update` to prune).
 *
 * Why a wrapper (and not plain `knip`): knip 6 has no native baseline file, and
 * the tree once carried a large residual of dead exports/files/deps (leftovers
 * the T9 deletion pass did not reach). Freezing that residual let the gate go
 * green while catching every NEW piece of dead code — the same baseline-ratchet
 * used by `check-tenant-scoping` and `check-file-size`.
 *
 * The ratchet has since reached zero: `scripts/knip-baseline.json` is `[]` and
 * MUST stay that way. An empty baseline means every knip finding is a failure,
 * which is the whole point — a baseline that only ever grows has stopped being
 * a ratchet.
 *
 *   node scripts/check-deadcode.mjs            # gate (CI + `npm run lint`)
 *   node scripts/check-deadcode.mjs --update   # regenerate the baseline snapshot
 *
 * When a NEW finding is legitimate, the fix is to declare WHY in `knip.json`,
 * not to grow the baseline. The three shapes that come up:
 *   - a file that is a graph root (a worker/config/route entry) -> `entry`
 *   - an export a NON-TypeScript tool consumes (a gate script that reads the
 *     source as text, so the module graph cannot see it) -> tag the export
 *     `@gateConsumed` (wired via `tags: ["-gateConsumed"]`); this is per-export,
 *     so the rest of the file stays under the gate. Example:
 *     `ERASURE_OUT_OF_SCOPE`, read by `scripts/check-erasure-manifest.mjs`.
 *   - an export that exists so the TYPE can be NAMED in emitted `.d.ts`.
 *     tsconfig.api.json is a composite project: an unexported alias that shows
 *     up in an exported member's inferred type is TS4053/TS4055, so the alias
 *     has to be exported even though no module imports it by name. Tag it
 *     `@declarationEmit` (wired via `tags: ["-declarationEmit"]`). Example:
 *     `RepairListEntry` in inspection-analytics.service.ts.
 *   - a dependency knip cannot resolve -> `ignoreDependencies`
 * `--update` is a last resort and needs review of every entry it adds.
 *
 * console.* is intentional — this is a build script, not server code (the
 * no-console rule is server-only).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { gateStamp, collectInputs } from "./lib/gate-stamp.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const KNIP_BIN = join(ROOT, "node_modules", "knip", "bin", "knip.js");
const BASELINE = join(ROOT, "scripts", "knip-baseline.json");

// ---------------------------------------------------------------------------
// Run knip and collect findings into stable, order-independent keys.
// ---------------------------------------------------------------------------
function runKnip() {
  // --no-exit-code: never let knip's own non-zero exit abort us — this wrapper
  // owns the pass/fail decision via the baseline diff.
  const stdout = execFileSync(
    process.execPath,
    [KNIP_BIN, "--reporter", "json", "--no-exit-code"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

const norm = (p) => String(p).replace(/\\/g, "/");

/**
 * Flatten a knip JSON report into a Set of stable keys.
 *
 * Dependency-family findings (dependencies/devDependencies/peer/unlisted/
 * binaries) are keyed by NAME only — a dependency is dead once, not once per
 * referencing file — so moving an already-known unlisted import to another file
 * does not trip the gate. File/export/type/duplicate findings are keyed by
 * `<category>:<file>:<name>` so each individual dead symbol is tracked.
 */
function collectKeys(report) {
  const keys = new Set();
  const add = (k) => keys.add(k);

  for (const it of report.issues ?? []) {
    const file = norm(it.file ?? "");

    for (const f of it.files ?? []) add(`files:${norm(f.name)}`);

    // Name-only dependency axes.
    for (const d of it.dependencies ?? []) add(`dependencies:${d.name}`);
    for (const d of it.devDependencies ?? []) add(`devDependencies:${d.name}`);
    for (const d of it.optionalPeerDependencies ?? [])
      add(`optionalPeerDependencies:${d.name}`);
    for (const d of it.unlisted ?? []) add(`unlisted:${d.name}`);
    for (const d of it.binaries ?? []) add(`binaries:${d.name}`);
    for (const d of it.catalog ?? []) add(`catalog:${d.name}`);

    // File-scoped symbol axes.
    for (const e of it.exports ?? []) add(`exports:${file}:${e.name}`);
    for (const t of it.types ?? []) add(`types:${file}:${t.name}`);
    for (const u of it.unresolved ?? []) add(`unresolved:${file}:${u.name}`);

    // Duplicates: each group is an array of same-symbol exports; key by the
    // sorted member names so ordering churn is stable.
    for (const group of it.duplicates ?? []) {
      const names = group.map((g) => g.name).sort().join("|");
      add(`duplicates:${file}:${names}`);
    }

    // Member-level axes are keyed objects: { ownerName: [{ name }] }.
    for (const [owner, members] of Object.entries(it.enumMembers ?? {}))
      for (const m of members) add(`enumMembers:${file}:${owner}.${m.name}`);
    for (const [owner, members] of Object.entries(it.namespaceMembers ?? {}))
      for (const m of members) add(`namespaceMembers:${file}:${owner}.${m.name}`);
    for (const [owner, members] of Object.entries(it.classMembers ?? {}))
      for (const m of members) add(`classMembers:${file}:${owner}.${m.name}`);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// knip is the one gate here whose cost is real work rather than node startup
// (~8.7s against ~0.6s for the conformance gates). Its verdict is a pure
// function of the source tree, knip.json and the baseline, so a run whose
// inputs are unchanged can only reach the same verdict. `--update` bypasses
// the cache: that run has a side effect.
const stamp = gateStamp(
  "deadcode",
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  collectInputs(
    ["server", "app", "workers", "packages", "scripts", "tests"].map((d) => join(ROOT, d)),
    [join(ROOT, "knip.json"), join(ROOT, "package.json"), join(ROOT, "tsconfig.json"), BASELINE],
  ),
);
if (stamp.hit) process.exit(0);

const report = runKnip();
const current = collectKeys(report);

if (process.argv.includes("--update")) {
  const sorted = [...current].sort();
  writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Updated scripts/knip-baseline.json: ${sorted.length} baseline entries.`);
  process.exit(0);
}

const baseline = new Set(
  existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : [],
);

const violations = [...current].filter((k) => !baseline.has(k)).sort();
const stale = [...baseline].filter((k) => !current.has(k));

if (violations.length > 0) {
  console.error("\nDead-code gate FAILED — new knip findings not in the baseline:\n");
  console.error(
    "  These exports / files / dependencies appear unused. Either remove the dead\n" +
      "  code (preferred), or — if it is intentionally retained (e.g. a public API\n" +
      "  surface, a plugin-loaded entry) — mark it in knip.json (entry/ignore/\n" +
      "  ignoreDependencies) or, as a last resort, run\n" +
      "  `node scripts/check-deadcode.mjs --update` after verifying each new entry.\n",
  );
  for (const v of violations) console.error(`  + ${v}`);
  console.error(`\n${violations.length} new finding(s).`);
  process.exit(1);
}

stamp.save();
console.log(
  `Dead-code gate: OK (${baseline.size} baselined, 0 new findings).`,
);
if (stale.length > 0) {
  console.log(
    `  ${stale.length} stale baseline entry(s) no longer hit — run ` +
      `\`node scripts/check-deadcode.mjs --update\` to tighten.`,
  );
}
process.exit(0);
