#!/usr/bin/env node
/**
 * Track I-a GDPR (spec §11) — erasure-manifest CI lint gate.
 *
 * Asserts the INTERNAL validity of the erasure manifest
 * (`server/lib/compliance/erasure-manifest.ts`) and softly warns when a PII
 * column appears in a manifest-listed table without a covering rule.
 *
 * This guard is COMPLEMENTARY to:
 *   - tests/unit/erasure-manifest-coverage.spec.ts (manifest <-> orchestrator
 *     binding drift) — that proves every rule is realized by the executor.
 *   - This lint proves every rule is well-formed AND that the manifest's own
 *     tables don't grow an un-cataloged PII column unnoticed.
 *
 * Approach (robustness over cleverness): the manifest is TypeScript, so instead
 * of transpiling we parse the rule object literals out of the source text. Each
 * rule is a single-line `{ ... }` entry inside the `ERASURE_MANIFEST` array; we
 * extract the `key: 'value'` pairs with a tolerant regex. The set of fields the
 * manifest uses is small and stable, and the structural assertions don't depend
 * on formatting beyond "one rule per object literal".
 *
 * HARD failures (exit 1):
 *   - any rule missing a non-empty table / column / category / action
 *   - any action not in {delete,null,hash,retain,anonymize}
 *   - any anonymize/retain rule missing a legalBasis
 *
 * SOFT warning (exit 0, printed): a PII-heuristic column
 *   (email|phone|ip_address|user_agent|signature|client_name|full_name) found
 *   in a manifest-listed table's Drizzle schema that is NOT covered by any rule
 *   AND not declared in ERASURE_OUT_OF_SCOPE. Catches "added a PII column,
 *   forgot the manifest" without blocking unrelated work.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const MANIFEST = join(ROOT, "server", "lib", "compliance", "erasure-manifest.ts");
const SCHEMA_DIR = join(ROOT, "server", "lib", "db", "schema");

const VALID_ACTIONS = new Set(["delete", "null", "hash", "retain", "anonymize"]);
const REQUIRES_BASIS = new Set(["anonymize", "retain"]);
const PII_HEURISTIC = /(email|phone|ip_address|user_agent|signature|client_name|full_name)/;

const errors = [];
const warnings = [];

const src = readFileSync(MANIFEST, "utf8");

/** Extract the body of a top-level `export const NAME = [ ... ];` array. */
function arrayBody(text, name) {
  const decl = text.indexOf(`export const ${name}`);
  if (decl === -1) return null;
  // Skip past the `=` so a type annotation like `: ErasureRule[]` (whose `[]`
  // would otherwise be mistaken for the array) is not matched.
  const eq = text.indexOf("=", decl);
  if (eq === -1) return null;
  const open = text.indexOf("[", eq);
  if (open === -1) return null;
  // Balanced-bracket scan from the opening `[`.
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** Pull `key: 'value'` string-literal pairs from one `{ ... }` object literal. */
function parseRule(literal) {
  const rule = {};
  const re = /(\w+)\s*:\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(literal)) !== null) {
    rule[m[1]] = m[2];
  }
  return rule;
}

/** Split an array body into its top-level `{ ... }` object literals. */
function objectLiterals(body) {
  const out = [];
  let depth = 0;
  let buf = "";
  for (const ch of body) {
    if (ch === "{") {
      depth++;
      buf += ch;
    } else if (ch === "}") {
      depth--;
      buf += ch;
      if (depth === 0) {
        out.push(buf);
        buf = "";
      }
    } else if (depth > 0) {
      buf += ch;
    }
  }
  return out;
}

const manifestBody = arrayBody(src, "ERASURE_MANIFEST");
if (manifestBody === null) {
  console.error("erasure-manifest lint: could not locate ERASURE_MANIFEST array.");
  process.exit(1);
}
const rules = objectLiterals(manifestBody).map(parseRule);

if (rules.length === 0) {
  console.error("erasure-manifest lint: parsed ZERO rules — parser drift or empty manifest.");
  process.exit(1);
}

// ── Structural validity ──────────────────────────────────────────────────────
rules.forEach((rule, i) => {
  const label = `rule #${i + 1} (${rule.table ?? "?"}.${rule.column ?? "?"})`;
  for (const field of ["table", "column", "category", "action"]) {
    if (!rule[field] || rule[field].trim() === "") {
      errors.push(`${label}: missing/empty '${field}'.`);
    }
  }
  if (rule.action && !VALID_ACTIONS.has(rule.action)) {
    errors.push(`${label}: invalid action '${rule.action}' (allowed: ${[...VALID_ACTIONS].join(", ")}).`);
  }
  if (rule.action && REQUIRES_BASIS.has(rule.action) && !rule.legalBasis) {
    errors.push(`${label}: action '${rule.action}' requires a 'legalBasis' (Art. 17(3) exemption).`);
  }
});

// ── Out-of-scope set (table.column the manifest deliberately skips) ───────────
const outBody = arrayBody(src, "ERASURE_OUT_OF_SCOPE") ?? "";
const outOfScope = new Set(
  objectLiterals(outBody)
    .map(parseRule)
    .map((r) => `${r.table}.${r.column}`),
);

// Tables the manifest claims to cover, and the (table.column) pairs it covers.
const manifestTables = new Set(rules.map((r) => r.table).filter(Boolean));
const coveredCols = new Set(rules.map((r) => `${r.table}.${r.column}`));

// ── Heuristic schema coverage warning ────────────────────────────────────────
// Map each `sqliteTable('db_name', { ... })` block to the snake_case column
// names it declares (the string arg of each `text('col')` / `integer('col')`).
function* schemaFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* schemaFiles(p);
    else if (/\.ts$/.test(entry)) yield p;
  }
}

const tableRe = /sqliteTable\(\s*'([^']+)'\s*,\s*\{/g;
for (const file of schemaFiles(SCHEMA_DIR)) {
  const text = readFileSync(file, "utf8");
  let tm;
  while ((tm = tableRe.exec(text)) !== null) {
    const tableName = tm[1];
    if (!manifestTables.has(tableName)) continue;
    // Slice the table body by balanced braces from the matched `{`.
    const open = text.indexOf("{", tm.index);
    let depth = 0;
    let end = open;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = text.slice(open, end);
    const colRe = /\b(?:text|integer|real|blob)\(\s*'([^']+)'/g;
    let cm;
    while ((cm = colRe.exec(body)) !== null) {
      const col = cm[1];
      if (!PII_HEURISTIC.test(col)) continue;
      const key = `${tableName}.${col}`;
      if (coveredCols.has(key)) continue;
      if (outOfScope.has(key)) continue;
      warnings.push(`${key} matches the PII heuristic but has no manifest rule and is not in ERASURE_OUT_OF_SCOPE.`);
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
for (const w of warnings) console.warn("  WARNING: " + w);

if (errors.length > 0) {
  console.error("\nErasure manifest lint FAILED:\n");
  for (const e of errors) console.error("  " + e);
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}

console.log(
  `erasure-manifest lint: OK (${rules.length} rules validated${
    warnings.length ? `, ${warnings.length} heuristic warning(s)` : ""
  }).`,
);
