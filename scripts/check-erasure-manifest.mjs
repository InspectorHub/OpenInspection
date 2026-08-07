#!/usr/bin/env node
/**
 * Track I-a GDPR (spec §11) — erasure-manifest CI lint gate.
 *
 * Asserts the INTERNAL validity of the erasure manifest
 * (`server/lib/compliance/erasure-manifest.ts`) and HARD-FAILS when a PII
 * column appears anywhere in the Drizzle schema without either a covering
 * manifest rule or an explicit ERASURE_OUT_OF_SCOPE entry.
 *
 * ⚠️ READ `docs/compliance/erasure-heuristic-limits.md` BEFORE TRUSTING A GREEN
 * RUN. "PII column" here means a column matching PII_HEURISTIC below, and that
 * pattern is a list of shapes someone thought of — every column it was not told
 * about is invisible to this gate and reads as correct. The document names what
 * is structurally out of reach (free prose, addresses, anything whose
 * sensitivity is contextual rather than lexical) and carries a worked example
 * that is currently open. A limits document nobody finds next to the gate is
 * exactly the failure mode it describes, which is why this pointer is here.
 *
 * This guard is COMPLEMENTARY to:
 *   - tests/unit/privacy/erasure-manifest-coverage.spec.ts (manifest <->
 *     orchestrator binding drift) — that proves every rule is realized by the
 *     executor.
 *   - This lint proves every rule is well-formed AND that NO schema table
 *     grows an un-cataloged PII column unnoticed.
 *
 * History note (portal #88 / roadmap §7.5 item 2): this check originally
 * scanned only the manifest's OWN tables and exited 0 on findings — a probe
 * that looked conclusive while covering less than the thing it probed. Client
 * PII sat unlisted in invoices, concierge_confirm_tokens,
 * inspection_access_tokens, email_suppressions and inspections for months and
 * the gate could not see any of it. Every column is now in-manifest or
 * declared out of scope WITH a reason; silence is no longer evidence.
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
 *   - any ERASURE_OUT_OF_SCOPE entry missing a non-empty reason
 *   - a PII-heuristic column found in ANY schema table that is neither covered
 *     by a manifest rule nor declared in ERASURE_OUT_OF_SCOPE
 *
 * The heuristic deliberately includes `recipient` (automation_logs.recipient
 * holds emails and E.164 numbers — renamed from recipient_email, which is how
 * it escaped the original pattern) and bare `ip`.
 *
 * `address` was added only AFTER the address family was ruled on, and the order
 * was the point. Widening the pattern first would have turned the gate red on
 * twelve columns at once and made twelve out-of-scope entries the cheapest way
 * back to green — converting an open question into a recorded decision nobody
 * would revisit. `docs/compliance/erasure-heuristic-limits.md` says the same
 * thing at more length, and names what this gate still cannot see: read it
 * before treating a green run as coverage. Whatever the next widening is, rule
 * on the columns first, then widen.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
// The manifest and its out-of-scope register are two files and one document:
// a column is covered by a rule in the first or excused by an entry in the
// second, and neither array means anything without the other. They are read as
// one concatenated source so `arrayBody` finds whichever it is asked for, and
// so splitting the register out for line-count reasons could not quietly halve
// what this gate sees. A missing file throws here rather than parsing as empty.
const MANIFEST = join(ROOT, "server", "lib", "compliance", "erasure-manifest.ts");
const OUT_OF_SCOPE = join(ROOT, "server", "lib", "compliance", "erasure-out-of-scope.ts");
const SCHEMA_DIR = join(ROOT, "server", "lib", "db", "schema");

const VALID_ACTIONS = new Set(["delete", "null", "hash", "retain", "anonymize"]);
const REQUIRES_BASIS = new Set(["anonymize", "retain"]);
const VALID_ENFORCEMENT = new Set(["enforced", "pending"]);

/**
 * The ONLY rules allowed to say `enforcementStatus: 'pending'`.
 *
 * A `retain` rule that promises a bounded `retention` and has nothing to expire
 * it is not a bounded retain — it is a permanent one that reads as temporary,
 * which is the blanket exclusion this manifest exists to avoid. Existing
 * remediation is allowed to be in flight; ADDING another one is not a thing a
 * developer should be able to do by typing a keyword. Landing here is a diff
 * somebody has to approve.
 *
 * The check runs BOTH ways: a pending rule missing from this list fails, and a
 * list entry with no matching pending rule also fails. The second direction is
 * what stops the list decaying into a blanket permit after the rules it named
 * are gone.
 *
 * To remove an entry: build the enforcement, flip the rule to
 * `enforcementStatus: 'enforced'`, delete the line here.
 */
const PENDING_ENFORCEMENT = new Set([
  // The property address family. Retained under Art. 17(3)(e) for the tenant's
  // record window; `retention-sweep.ts` does not reach `inspections` yet, so
  // nothing expires them. See the NOT YET ENFORCED block in the manifest for
  // the two blockers and why the deadline is where it is.
  "inspections.property_address",
  "inspections.address_place_id",
  "inspections.address_street",
  "inspections.address_city",
  "inspections.address_state",
  "inspections.address_zip",
  "inspections.address_county",
  "inspections.address_lat",
  "inspections.address_lng",
  "inspection_requests.property_address",
]);
const PII_HEURISTIC = /(email|phone|ip_address|user_agent|signature|client_name|full_name|recipient|address)/;
const isPiiColumn = (col) => PII_HEURISTIC.test(col) || col === "ip";

const errors = [];

const src = `${readFileSync(MANIFEST, "utf8")}\n${readFileSync(OUT_OF_SCOPE, "utf8")}`;

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

// ── Enforcement of bounded retention ─────────────────────────────────────────
// A `retain` rule that names a period is a promise the data goes away when the
// period elapses. Nothing in this repo can prove a sweep actually runs, so what
// is checked instead is that somebody SAID which it is, and that "not yet" is
// bounded by a list and a date rather than by nobody looking.
const seenPending = new Set();
rules.forEach((rule, i) => {
  const key = `${rule.table}.${rule.column}`;
  const label = `rule #${i + 1} (${key})`;

  if (rule.enforcementStatus && !VALID_ENFORCEMENT.has(rule.enforcementStatus)) {
    errors.push(
      `${label}: invalid enforcementStatus '${rule.enforcementStatus}' (allowed: ${[...VALID_ENFORCEMENT].join(", ")}).`,
    );
    return;
  }

  // The default is REFUSAL, not "enforced". A new bounded retain has to declare
  // what expires it; that is the whole point of this block.
  if (rule.action === "retain" && rule.retention && !rule.enforcementStatus) {
    errors.push(
      `${label}: 'retain' with retention '${rule.retention}' must declare enforcementStatus ` +
        `('enforced' if a sweep expires it, 'pending' if that is not built yet). A bounded ` +
        `retain nothing enforces is an unbounded retain.`,
    );
  }

  if (rule.enforcementStatus !== "pending") return;
  seenPending.add(key);

  if (!PENDING_ENFORCEMENT.has(key)) {
    errors.push(
      `${label}: NEW unenforced retain rule. '${key}' is marked pending but is not in ` +
        `PENDING_ENFORCEMENT in this script. Existing remediation may be in flight; adding ` +
        `another one is a reviewed decision, so put it on that list in the same change or ` +
        `build the enforcement instead.`,
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.enforcementDeadline ?? "")) {
    errors.push(
      `${label}: pending rules require an 'enforcementDeadline' as YYYY-MM-DD. Without a date, ` +
        `'pending' becomes permanent.`,
    );
    return;
  }
  // Deadline in the past → FAIL. A deadline that cannot act is not a deadline;
  // this is the same "expiry acts" principle the rule itself is about, applied
  // to our own promise about it. Moving the date is allowed and visible.
  const due = Date.parse(`${rule.enforcementDeadline}T23:59:59Z`);
  if (Number.isNaN(due)) {
    errors.push(`${label}: enforcementDeadline '${rule.enforcementDeadline}' is not a real date.`);
  } else if (Date.now() > due) {
    errors.push(
      `${label}: enforcement deadline ${rule.enforcementDeadline} has PASSED and the retention ` +
        `is still not enforced. Build it, or move the date deliberately and say why — an ` +
        `expired "pending" is the unbounded retain this check exists to prevent.`,
    );
  }
});

// The list must not outlive the rules it names, or it quietly becomes a blanket
// permit for whatever lands on it next.
for (const key of PENDING_ENFORCEMENT) {
  if (!seenPending.has(key)) {
    errors.push(
      `PENDING_ENFORCEMENT lists '${key}', but no manifest rule is marked pending for it. ` +
        `If the enforcement shipped, delete the line; if the rule moved, update it.`,
    );
  }
}

// ── Out-of-scope set (table.column the manifest deliberately skips) ───────────
// Every entry MUST carry a reason — an out-of-scope declaration without one is
// indistinguishable from a shrug, and the reason is what a DSAR audit reads.
const outBody = arrayBody(src, "ERASURE_OUT_OF_SCOPE");
if (outBody === null) {
  console.error("erasure-manifest lint: could not locate ERASURE_OUT_OF_SCOPE array (must be exported).");
  process.exit(1);
}
const outEntries = objectLiterals(outBody).map(parseRule);
outEntries.forEach((e, i) => {
  if (!e.reason || e.reason.trim() === "") {
    errors.push(`ERASURE_OUT_OF_SCOPE #${i + 1} (${e.table ?? "?"}.${e.column ?? "?"}): missing/empty 'reason'.`);
  }
});
const outOfScope = new Set(outEntries.map((r) => `${r.table}.${r.column}`));

// The (table.column) pairs the manifest covers.
const coveredCols = new Set(rules.map((r) => `${r.table}.${r.column}`));

// ── Heuristic schema coverage — HARD, whole schema ───────────────────────────
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
      if (!isPiiColumn(col)) continue;
      const key = `${tableName}.${col}`;
      if (coveredCols.has(key)) continue;
      if (outOfScope.has(key)) continue;
      errors.push(`${key} matches the PII heuristic but has no manifest rule and is not in ERASURE_OUT_OF_SCOPE.`);
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error("\nErasure manifest lint FAILED:\n");
  for (const e of errors) console.error("  " + e);
  console.error(`\n${errors.length} error(s).`);
  process.exit(1);
}

console.log(
  `erasure-manifest lint: OK (${rules.length} rules, ${outOfScope.size} out-of-scope declarations).`,
);
