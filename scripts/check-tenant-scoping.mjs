#!/usr/bin/env node
/**
 * Tenant-scoping anti-drift gate — baseline-ratchet model.
 *
 * Fails (exit 1) when server/services/** or server/api/** contains a raw-drizzle
 * `.where(` call that references `<tenantScopedTable>.id` (via `eq(table.id, ...)`)
 * WITHOUT also referencing a `tenantId` or `tenant_id` token in the same
 * balanced `.where(...)` expression.
 *
 * Why: unscoped by-id queries on tenant-scoped tables are cross-tenant data-
 * leak vectors — a crafted id for another tenant's row bypasses isolation.
 *
 * Baseline-ratchet model:
 *   Current hits are frozen in `scripts/tenant-scoping-baseline.json` (a sorted
 *   JSON array of `relative/path.ts::symbol::signature` keys — the shared
 *   symbol-keyed scheme from scripts/lib/symbol-baseline.mjs). The key anchors a
 *   hit to its enclosing function, not a line number, so inserting an unrelated
 *   line above a frozen hit no longer renumbers it into a false failure; the
 *   `signature` keeps two hits in one function distinct. Normal run: any NEW hit
 *   not in the baseline → print it and exit 1. Baselined hits pass silently.
 *   Stale baseline entries that no longer hit do NOT cause a failure (run
 *   `--update` to clean them out).
 *
 *   node scripts/check-tenant-scoping.mjs            # gate (CI + pre-commit via `lint`)
 *   node scripts/check-tenant-scoping.mjs --update   # regenerate the baseline snapshot
 *
 * Verb-aware output: violations say whether the hit is a SELECT, UPDATE, or
 * DELETE so a reviewer triaging knows writes need hard scrutiny.
 *
 * KNOWN GAPS (tracked follow-ups):
 *   (a) The detector only matches `eq(TABLE.id, ...)`, so `inArray(TABLE.id, ids)`
 *       by-id queries without a tenant sibling are NOT caught.
 *   (b) `users` is excluded entirely (every users.id access is currently
 *       self-referential via JWT sub). An admin cross-tenant user lookup by id
 *       would not be caught.
 *
 * console.* is intentional — this is a build script, not server code (no-console
 * rule is server-only).
 */

import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  enclosingSymbol,
  normalizeSignature,
  makeKey,
  diffBaseline,
  loadBaseline,
  writeBaseline,
} from "./lib/symbol-baseline.mjs";

// Both halves are exported, and the second one is the lesson. Only the query
// matcher was testable when a bug in the TABLE CLASSIFIER silently widened the
// gate onto a global table for months: every test passed, because none of them
// could reach the function that was wrong.
export { findUnscopedByIdQueries, buildTenantTableIdents };

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCHEMA_DIR = join(ROOT, "server", "lib", "db", "schema");
const SCAN_DIRS = [
  join(ROOT, "server", "services"),
  join(ROOT, "server", "api"),
];
const BASELINE = join(ROOT, "scripts", "tenant-scoping-baseline.json");

// ---------------------------------------------------------------------------
// Schema walk: extract camelCase identifiers for tenant-scoped tables
// ---------------------------------------------------------------------------
function walkFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".mjs")) out.push(p);
  }
  return out;
}

function buildTenantTableIdents(schemaDir) {
  const idents = new Set();
  for (const file of walkFiles(schemaDir)) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    // Every table declaration in this file, in order. Collected first so each
    // one's body can be bounded by the NEXT declaration.
    const decls = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/const\s+(\w+)\s*=\s*sqliteTable/);
      if (m) decls.push({ at: i, name: m[1] });
    }
    for (let k = 0; k < decls.length; k++) {
      // ⚠️ Bounded by the next declaration, NOT by a fixed lookahead. This read
      // 80 lines forward and therefore ran PAST the end of a short table into
      // whatever followed it: `marketplace_libraries` is 71 lines of columns and
      // comments with no tenant_id, and `tenant_library_imports` — which starts
      // three lines later and declares one on its second column — was inside the
      // window. The catalogue was classified tenant-scoped by borrowing the next
      // table's column, and every by-id read of the platform catalogue came back
      // a cross-tenant leak.
      //
      // The direction of that error matters: a lookahead can only ever include
      // too much, so this fix removes false positives and can hide nothing.
      // Measured when it was made: 109 tables, 104 called tenant-scoped by the
      // lookahead and 96 by this boundary — 8 borrowed (`marketplaceLibraries`,
      // `tenants`, `syncOutbox`, `slugReservations`, `smsDisclosureVersions`,
      // `processedWebhookEvents`, `processedCmdEvents`, `parkedCmdEvents`, all
      // genuinely global) and ZERO newly missed.
      const { at, name } = decls[k];
      const end = k + 1 < decls.length ? decls[k + 1].at : lines.length;
      const block = lines.slice(at, end).join("\n");
      if (/['"]tenant_id['"]/.test(block)) idents.add(name);
    }
  }
  // tenant_destruction_records carries a tenant_id snapshot but is the durable
  // non-personal compliance proof — it MUST survive a tenant purge. Mirror the
  // same exclusion used in scoped-tables.ts.
  idents.delete("tenantDestructionRecords");
  // users: every user-row lookup is self-referential (authenticated JWT `sub`).
  // The authenticated user can only see their own row, so there is no
  // cross-tenant id-guess risk. Excluding avoids false-positives on the many
  // auth-layer `eq(users.id, user.sub)` / `eq(users.id, userId)` queries.
  // KNOWN GAP (b): an admin cross-tenant user lookup by id would not be caught.
  idents.delete("users");
  return idents;
}

// ---------------------------------------------------------------------------
// Core heuristic (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Extracts the balanced content of the first `.where(` expression starting at
 * or after position `pos` in `source`.  Returns `{ start, content }` where
 * `start` is the index of `.where(` and `content` is everything from the
 * opening `(` to its matching `)` (inclusive).  Returns null if no `.where(`
 * is found at or after `pos`.
 */
function extractWhereExpr(source, pos) {
  const idx = source.indexOf(".where(", pos);
  if (idx === -1) return null;
  const openParen = idx + ".where".length; // points at '('
  let depth = 0;
  let i = openParen;
  while (i < source.length) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return { start: idx, content: source.slice(openParen, i + 1) };
    }
    i++;
  }
  return null; // unmatched — shouldn't happen in valid TS
}

/**
 * Scans `source` for `.where(...)` expressions that contain `eq(TABLE.id,`
 * for any table in `tenantTables` but do NOT also contain a `tenantId` /
 * `tenant_id` token in the same balanced expression.
 *
 * @param {string} source - TypeScript source code to scan.
 * @param {Set<string>} tenantTables - Set of camelCase table identifier names.
 * @returns {{ line: number, context: string }[]} Array of hit objects.
 */
function findUnscopedByIdQueries(source, tenantTables) {
  if (tenantTables.size === 0) return [];
  const tableAlt = [...tenantTables].join("|");
  // Matches eq(TABLE.id, or eq(schema.TABLE.id,
  const byIdRe = new RegExp(`eq\\((?:\\w+\\.)?(?:${tableAlt})\\.id[,\\s]`);
  const hits = [];
  let pos = 0;
  while (pos < source.length) {
    const result = extractWhereExpr(source, pos);
    if (!result) break;
    const { start, content } = result;
    if (byIdRe.test(content) && !/tenantId|tenant_id/.test(content)) {
      // Compute 1-based line number of the `.where(` token
      const line = source.slice(0, start).split("\n").length;
      // Context: the line containing `.where(`
      const lineStart = source.lastIndexOf("\n", start) + 1;
      const lineEnd = source.indexOf("\n", start);
      const context = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
      // `index` (char offset of `.where(`) lets the gate anchor each hit to its
      // enclosing symbol for a drift-immune baseline key.
      hits.push({ line, context, index: start });
    }
    pos = start + 1; // advance past this `.where(` to find next
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Verb detection helper — inspects the context line for SELECT/UPDATE/DELETE
// ---------------------------------------------------------------------------
function detectVerb(context) {
  const lc = context.toLowerCase();
  if (/\bupdate\b/.test(lc)) return "UPDATE";
  if (/\bdelete\b/.test(lc)) return "DELETE";
  return "SELECT";
}

// ---------------------------------------------------------------------------
// Main scan (only runs when executed directly, not when imported)
// ---------------------------------------------------------------------------
// Normalize both sides to forward-slash lowercase so Windows drive letters
// don't break the comparison.
const _scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1").toLowerCase();
const _argv1 = (process.argv[1] ?? "").replace(/\\/g, "/").toLowerCase();
if (_scriptPath === _argv1 || _argv1.endsWith("/check-tenant-scoping.mjs")) {
  const tenantTables = buildTenantTableIdents(SCHEMA_DIR);

  /** @type {Map<string, string>} key -> context */
  const currentHits = new Map();

  for (const scanDir of SCAN_DIRS) {
    for (const file of walkFiles(scanDir)) {
      if (!file.endsWith(".ts")) continue;
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const source = readFileSync(file, "utf8");
      const hits = findUnscopedByIdQueries(source, tenantTables);
      for (const hit of hits) {
        const key = makeKey(rel, enclosingSymbol(source, hit.index), normalizeSignature(hit.context));
        currentHits.set(key, hit.context);
      }
    }
  }

  if (process.argv.includes("--update")) {
    const count = writeBaseline(BASELINE, [...currentHits.keys()]);
    console.log(
      `Updated ${BASELINE.replace(ROOT + "\\", "").replace(ROOT + "/", "")}: ` +
        `${count} baseline entries.`,
    );
    process.exit(0);
  }

  const baseline = loadBaseline(BASELINE);
  const { violations, stale } = diffBaseline(currentHits, baseline);

  if (violations.length > 0) {
    console.error("\nTenant-scoping gate FAILED — new unscoped by-id queries detected:\n");
    console.error(
      "  These queries fetch/update a tenant-scoped table row by `id` alone, without\n" +
        "  a `tenantId` filter in the same .where() expression. This is a cross-tenant\n" +
        "  data-leak vector.\n\n" +
        "  Fix options:\n" +
        "    (a) Add `eq(table.tenantId, tenantId)` to the .where() clause.\n" +
        "    (b) Use `this.sdb.getById(table, id)` (auto-scopes by tenantId).\n" +
        "    (c) If provably safe (pk from prior scoped fetch, post-insert read-back,\n" +
        "        or truly global table), run `node scripts/check-tenant-scoping.mjs --update`\n" +
        "        after verifying each new entry — this freezes the new baseline.\n",
    );
    for (const key of violations) {
      const context = currentHits.get(key);
      console.error(`  [${detectVerb(context)}] ${key}\n      ${context.substring(0, 120)}`);
    }
    console.error(`\n${violations.length} violation(s).`);
    process.exit(1);
  }

  console.log(
    `Tenant-scoping gate: OK (${baseline.size} baselined, 0 new violations).`,
  );
  if (stale.length > 0) {
    console.log(
      `  ${stale.length} stale baseline entry(s) no longer hit — run \`node scripts/check-tenant-scoping.mjs --update\` to tighten.`,
    );
  }
  process.exit(0);
}
