#!/usr/bin/env node
/**
 * Migration-reference hygiene guard.
 *
 * Fails (exit 1) when source code comments cite a migration SEQUENCE NUMBER
 * (`migration 0045`, `0052_inspector_slug.sql`, `pre-migration 0040`, …).
 *
 * Why: sequence numbers are an unstable, positional ordering token. Squash /
 * consolidation renumbers them, leaving the comment dangling at a file that no
 * longer exists — worse than no comment. The `0000_baseline.sql` consolidation
 * already orphaned every `migration 00NN` reference in the tree once.
 *
 * Annotate the durable artifact instead (see CLAUDE.md "Comment Rules"):
 *   - state the invariant next to the schema column/index it constrains,
 *   - cite a STABLE id for traceability — PR# / issue# (`see #144`),
 *   - the ONLY allowed migration reference is `0000_baseline.sql` (never renumbers).
 *
 * Escape hatch: a `migrefs-allow: <reason>` comment on the offending line or
 * within ALLOW_WINDOW lines above it (use sparingly, always state the reason).
 * Files under migrations/ are skipped — a migration may name its own siblings.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCAN_DIRS = ["app", "server", "tests", join("packages", "shared-ui", "src")];

/** How many lines above a violation a `migrefs-allow` comment still excuses it. */
const ALLOW_WINDOW = 5;

const RULES = [
  // "migration 0045", "pre-migration 0040", Chinese "迁移 0058"
  { name: "migration sequence number", re: /\b(?:pre-)?migration[ _]?00\d\d\b/gi },
  { name: "migration sequence number", re: /迁移\s?00\d\d\b/g },
  // "0052_inspector_slug.sql" filename refs — 0000_baseline.sql is the one
  // stable anchor and is exempted below.
  { name: "migration filename", re: /\b00\d\d_[a-z][\w-]*\.sql\b/gi },
];

/** The only migration reference that never renumbers. */
const ALLOWED = /\b0000_baseline\b/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // dir may not exist in every package
  }
  for (const entry of entries) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(entry)) yield p;
  }
}

const violations = [];

for (const scanDir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, scanDir))) {
    const rel = relative(ROOT, file);
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        rule.re.lastIndex = 0;
        const m = rule.re.exec(line);
        if (!m) continue;
        if (ALLOWED.test(m[0])) continue;
        const from = Math.max(0, i - ALLOW_WINDOW);
        const excused = lines.slice(from, i + 1).some((l) => l.includes("migrefs-allow"));
        if (!excused) {
          violations.push(`${rel.split(sep).join("/")}:${i + 1}  [${rule.name}]  ${m[0]}`);
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error("Migration-reference hygiene check FAILED.\n");
  console.error(
    "Migration sequence numbers renumber on squash/consolidation — comments that cite them go dangling.",
  );
  console.error(
    "State the invariant next to the schema definition, cite a PR#/issue# for history, or reference 0000_baseline.sql.",
  );
  console.error(
    "For a sanctioned exception add a `migrefs-allow: <reason>` comment on or just above the line.\n",
  );
  for (const v of violations) console.error("  " + v);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}

console.log("Migration-reference hygiene: OK");
