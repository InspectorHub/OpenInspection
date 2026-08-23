#!/usr/bin/env node
/**
 * OI #276 — retention-manifest CI lint gate.
 *
 * Asserts the internal validity of `server/lib/compliance/retention-manifest.ts`
 * and HARD-FAILS when a LEDGER-SHAPED table appears in the Drizzle schema
 * without a retention rule, a reasoned exclusion, or a dated open entry.
 *
 * ── Why the in-scope set is a NAME pattern, not a column heuristic ──────────
 * The obvious predicate is structural: "has a created_at / received_at and no
 * updated_at, therefore append-only". It was measured before being written, and
 * it fails in both directions at once. Of the 93 tables in the schema it flags
 * 50 — 43 of them tables no one intends to expire, which guarantees the gate
 * gets loosened within a release. And it is blind to half the surface this gate
 * exists for: `processed_cmd_events` (`processed_at`), `automation_logs`
 * (`send_at`), `integration_test_results` (`tested_at`) all carry a differently
 * named timestamp and read as "not append-only". A gate that fires on 43
 * correct tables while staying silent on the dead-letter queue is worse than no
 * gate: the 43 are the pressure to relax it, and relaxing it makes the silence
 * permanent.
 *
 * So the in-scope set is a NARROW NAME pattern plus a short explicit list. It
 * is a smaller claim, and unlike the heuristic it is a claim that is true: a
 * table named `*_log`, `*_logs`, `*_events`, `processed_*` or `parked_*` is a
 * ledger, and the named exceptions are ledgers whose names do not say so.
 *
 * ── Where the scope line is drawn ───────────────────────────────────────────
 * This gate governs the PLATFORM-OPERATIONAL record surface. Product data — a
 * report, a message to a counterparty, a marketplace import history — is a
 * business record whose lifetime is answered by the erasure manifest and by the
 * inspection record window, not by an operational log window. `reports`,
 * `inspection_messages` and `tenant_marketplace_import_history` are therefore
 * deliberately NOT in scope here. That is a scope statement, not an oversight;
 * if the inspection record window later needs them, they join THAT rule, not
 * this catalogue.
 *
 * HARD failures (exit 1):
 *   - a rule missing a non-empty table / timestampColumn / action / purpose
 *   - an action outside {delete, anonymize}
 *   - a rule whose `window` declares no unit
 *   - an out-of-scope entry with no reason
 *   - an open entry with no reason, or with a `decideBy` that is not a real
 *     YYYY-MM-DD date, or whose `decideBy` has passed
 *   - a table declared in more than one of the three arrays
 *   - an EXPLICIT_LEDGER_TABLES entry that no longer exists in the schema
 *   - a ledger-shaped schema table in none of the three arrays
 *
 * Usage:
 *   node scripts/check-retention-manifest.mjs
 *   node scripts/check-retention-manifest.mjs --schema-dir <path>
 *   node scripts/check-retention-manifest.mjs --manifest <path> --schema-dir <path>
 *
 * `--schema-dir` and `--manifest` exist so the gate can be proven against a
 * FIXTURE (`scripts/fixtures/retention-gate-probe/`) rather than by editing a
 * tracked schema or catalogue file and reverting it. A probe that mutates
 * tracked source is one interrupted run away from being committed.
 *
 * console.* is intentional — this is a build script, not server code.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const argv = process.argv.slice(2);
const schemaDirArg = argv.indexOf("--schema-dir");
const manifestArg = argv.indexOf("--manifest");
const SCHEMA_DIR = schemaDirArg === -1
    ? join(ROOT, "server", "lib", "db", "schema")
    : join(ROOT, argv[schemaDirArg + 1] ?? "");
const MANIFEST = manifestArg === -1
    ? join(ROOT, "server", "lib", "compliance", "retention-manifest.ts")
    : join(ROOT, argv[manifestArg + 1] ?? "");

/**
 * A table whose NAME says it is a ledger.
 *
 * `_events$` also matches `inspection_events`, which is not a log — that is
 * fine and slightly useful: it is in the manifest's out-of-scope list with the
 * reason, so the one table the issue got wrong is the one table the gate keeps
 * saying out loud.
 */
// Widened 2026-08-13, after every table the widening newly demands was already
// registered — so it costs nothing today and starts earning on the next one.
//
// The four original patterns covered nine tables. Sixteen of ninety-five had a
// decision, which means the other seven that DID were volunteered by whoever
// wrote them; the gate was not what got them there. `tenant_destruction_records`
// is the proof: a compliance ledger that grows per purge, named `_records`,
// invisible to this line, and it went a year with no retention decision while
// this gate reported green. `ai_call_provenance` and `ai_content_reviews` were
// in the same position.
//
// `_versions?$` is the one to be careful with — it also catches reference
// tables whose rows are CITED by longer-lived evidence. Those still need a
// decision; the decision is usually a window plus a "not still cited" predicate
// rather than an exemption, and having the gate ask is the point.
const LEDGER_NAME = /_log(s)?$|^processed_|^parked_|_events$|_records?$|_history$|_versions?$|_provenance$|_reviews?$/;

/**
 * Ledgers whose names do not say so. Each line is a claim that this table
 * accumulates one row per event on the platform-operational surface, so the
 * storage-limitation question applies to it and somebody has to answer.
 *
 * Keep this list short and keep the reason in the manifest, not here.
 */
const EXPLICIT_LEDGER_TABLES = [
    // Replay store: one row per (tenant, idempotency key), holding the verbatim
    // success response of the call it replays.
    "idempotency_keys",
    // Notice headers: one row per recipient per notice.
    "notifications",
    // QuickBooks sync failures: one row per (entity, error code).
    "qbo_sync_errors",
    // Provider delivery states: one row per outbound message.
    "sms_delivery_status",
    // Settings "Test connection" history: one row per probe.
    "integration_test_results",
    // The portal user-sync outbox: one row per published CloudEvent.
    "sync_outbox",
];

// See check-erasure-manifest.mjs — `erase_in_place` replaced `anonymize`.
// Source has one vocabulary; the wire keeps both.
const VALID_ACTIONS = new Set(["delete", "erase_in_place"]);

/**
 * How a rule obeys the legal-hold invariant.
 *
 * `not_applicable` is the only value that needs an argument attached, and that
 * asymmetry is deliberate: it is the only one that opts a table OUT of
 * preservation, so it is the only one a reviewer has to be able to disagree
 * with. The other two describe a mechanism that either exists in the executor
 * or is enforced by the driver, and the behavioural spec proves both.
 */
const VALID_LEGAL_HOLD = new Set(["tenant_scoped", "suspend_all", "not_applicable"]);

const errors = [];
const src = readFileSync(MANIFEST, "utf8");

/**
 * Extract the body of a top-level `export const NAME = [ ... ];` array.
 *
 * The declaration is matched LINE-ANCHORED and with a trailing negative
 * lookahead rather than by `indexOf`. Both were live holes here, each found by
 * breaking this manifest and watching this gate give the wrong answer:
 *
 *  - Without the lookahead, `indexOf('export const RETENTION_MANIFEST')` also
 *    matches `RETENTION_MANIFEST_V2`. Renaming the catalogue away left this gate
 *    parsing the renamed copy and printing "OK (6 rules, 7 out-of-scope, 2
 *    open)" — the coarsest possible sabotage, reported as health.
 *  - Without the `^` anchor the match lands inside PROSE. A doc comment that
 *    quotes the declaration it describes (`export const RETENTION_MANIFEST:
 *    RetentionRule[] = []`) was enough to make the gate parse from the middle of
 *    a sentence and report ZERO rules while all 6 sat intact below it — a
 *    different wrong answer, and a more confusing one, because it accuses the
 *    manifest of being empty rather than the parser of being lost. Top-level
 *    exports start at column 0; a mention of one does not.
 *
 * Kept deliberately identical to `check-non-translatable.mjs` and
 * `check-erasure-manifest.mjs` — these three parsers are one shape, and a fix
 * in one has to land in all three. Asserted by
 * `tests/unit/tooling/manifest-gate-parsing.spec.ts`.
 */
function arrayBody(text, name) {
    const decl = text.search(new RegExp(`^export const ${name}(?![A-Za-z0-9_$])`, "m"));
    if (decl === -1) return null;
    // Skip past the `=` so a type annotation like `: RetentionRule[]` (whose
    // `[]` would otherwise be mistaken for the array) is not matched.
    const eq = text.indexOf("=", decl);
    if (eq === -1) return null;
    const open = text.indexOf("[", eq);
    if (open === -1) return null;
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

/**
 * Pull `key: 'value'` string-literal pairs out of one object literal, ignoring
 * anything inside a NESTED literal so a rule's `window: { unit: 'days' }` does
 * not overwrite a top-level key of the same name.
 */
function parseEntry(literal) {
    const inner = literal.replace(/\{[^{}]*\}/g, (m, offset) => (offset === 0 ? m : " "));
    const entry = {};
    const re = /(\w+)\s*:\s*'((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(inner)) !== null) entry[m[1]] = m[2];
    // The window's unit lives one level down; read it separately.
    const unit = /window\s*:\s*\{[^{}]*unit\s*:\s*'(\w+)'/.exec(literal);
    if (unit) entry.__windowUnit = unit[1];
    return entry;
}

function readArray(name) {
    const body = arrayBody(src, name);
    if (body === null) {
        console.error(`retention-manifest lint: could not locate ${name} array (must be exported).`);
        process.exit(1);
    }
    return objectLiterals(body).map(parseEntry);
}

const rules = readArray("RETENTION_MANIFEST");
const outOfScope = readArray("RETENTION_OUT_OF_SCOPE");
const open = readArray("RETENTION_OPEN");

if (rules.length === 0) {
    console.error("retention-manifest lint: parsed ZERO rules — parser drift or empty manifest.");
    process.exit(1);
}

// ── Structural validity ──────────────────────────────────────────────────────
rules.forEach((rule, i) => {
    const label = `rule #${i + 1} (${rule.table ?? "?"})`;
    for (const field of ["table", "timestampColumn", "action", "purpose", "legalHold"]) {
        if (!rule[field] || rule[field].trim() === "") {
            errors.push(`${label}: missing/empty '${field}'.`);
        }
    }
    if (rule.action && !VALID_ACTIONS.has(rule.action)) {
        errors.push(`${label}: invalid action '${rule.action}' (allowed: ${[...VALID_ACTIONS].join(", ")}).`);
    }
    if (rule.legalHold && !VALID_LEGAL_HOLD.has(rule.legalHold)) {
        errors.push(
            `${label}: invalid legalHold '${rule.legalHold}' ` +
            `(allowed: ${[...VALID_LEGAL_HOLD].join(", ")}).`,
        );
    }
    if (rule.legalHold === "not_applicable" && (!rule.legalHoldNote || rule.legalHoldNote.trim() === "")) {
        errors.push(
            `${label}: legalHold 'not_applicable' needs a 'legalHoldNote' saying why a preservation ` +
            `order cannot reach anything in this table. Without one it is an opt-out nobody reviewed.`,
        );
    }
    if (rule.legalHold && rule.legalHold !== "not_applicable" && rule.legalHoldNote) {
        errors.push(
            `${label}: 'legalHoldNote' belongs only on a 'not_applicable' rule — on any other value ` +
            `it reads as a caveat on enforcement that is not actually implemented.`,
        );
    }
    if (!rule.__windowUnit) {
        errors.push(
            `${label}: no 'window: { unit, value }'. A period with no unit is a number somebody ` +
            `multiplied — months and days are not interchangeable here.`,
        );
    }
});

outOfScope.forEach((e, i) => {
    if (!e.table) errors.push(`RETENTION_OUT_OF_SCOPE #${i + 1}: missing 'table'.`);
    if (!e.reason || e.reason.trim() === "") {
        errors.push(
            `RETENTION_OUT_OF_SCOPE #${i + 1} (${e.table ?? "?"}): missing/empty 'reason'. An ` +
            `exclusion without one is a shrug that reads like a decision.`,
        );
    }
});

// ── Open entries: bounded by a date, or 'open' becomes 'never' ───────────────
open.forEach((e, i) => {
    const label = `RETENTION_OPEN #${i + 1} (${e.table ?? "?"})`;
    if (!e.table) errors.push(`${label}: missing 'table'.`);
    if (!e.reason || e.reason.trim() === "") {
        errors.push(`${label}: missing/empty 'reason' — say what accumulates and why the answer is not obvious.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.decideBy ?? "")) {
        errors.push(`${label}: 'decideBy' must be YYYY-MM-DD. Without a date, 'open' becomes permanent.`);
        return;
    }
    const due = Date.parse(`${e.decideBy}T23:59:59Z`);
    if (Number.isNaN(due)) {
        errors.push(`${label}: decideBy '${e.decideBy}' is not a real date.`);
    } else if (Date.now() > due) {
        errors.push(
            `${label}: decideBy ${e.decideBy} has PASSED and the table still has no retention ` +
            `decision. Decide it, or move the date deliberately and say why.`,
        );
    }
});

// ── A table belongs to exactly one array ─────────────────────────────────────
const seen = new Map();
for (const [arrName, entries] of [
    ["RETENTION_MANIFEST", rules],
    ["RETENTION_OUT_OF_SCOPE", outOfScope],
    ["RETENTION_OPEN", open],
]) {
    for (const e of entries) {
        if (!e.table) continue;
        if (seen.has(e.table)) {
            errors.push(
                `'${e.table}' appears in both ${seen.get(e.table)} and ${arrName}. A table has one ` +
                `answer; two answers means a reader picks whichever they found first.`,
            );
        } else {
            seen.set(e.table, arrName);
        }
    }
}

// ── Schema coverage ──────────────────────────────────────────────────────────
function* schemaFiles(dir) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) yield* schemaFiles(p);
        else if (/\.ts$/.test(entry)) yield p;
    }
}

if (!existsSync(SCHEMA_DIR)) {
    console.error(`retention-manifest lint: schema dir not found: ${SCHEMA_DIR}`);
    process.exit(1);
}

const schemaTables = new Set();
/**
 * Tables that actually carry a `tenant_id` column.
 *
 * Read from the schema rather than trusted from the manifest, because the whole
 * point of the `legalHold` field is to be checkable. A rule that CLAIMS
 * `tenant_scoped` on a table with no tenant column would compile, pass every
 * type check, and quietly delete under a hold; a rule that claims
 * `suspend_all` on a table that HAS one is over-preserving for no reason and
 * would never be noticed, because over-preservation looks like nothing.
 *
 * The table's body is taken as the text up to the next `sqliteTable(`, and the
 * column is matched as the literal declaration `text('tenant_id')` rather than
 * as the bare string — a comment or an index that merely mentions the name must
 * not be able to answer this question.
 */
const tenantScopedSchemaTables = new Set();
const tableRe = /sqliteTable\(\s*'([^']+)'/g;
for (const file of schemaFiles(SCHEMA_DIR)) {
    const text = readFileSync(file, "utf8");
    let m;
    const hits = [];
    while ((m = tableRe.exec(text)) !== null) hits.push({ name: m[1], at: m.index });
    hits.forEach((hit, i) => {
        schemaTables.add(hit.name);
        const body = text.slice(hit.at, i + 1 < hits.length ? hits[i + 1].at : text.length);
        if (/text\('tenant_id'\)/.test(body)) tenantScopedSchemaTables.add(hit.name);
    });
}

// ── legalHold classification vs the schema ───────────────────────────────────
for (const rule of rules) {
    if (!rule.table || !schemaTables.has(rule.table)) continue;
    const hasTenant = tenantScopedSchemaTables.has(rule.table);
    if (rule.legalHold === "tenant_scoped" && !hasTenant) {
        errors.push(
            `rule '${rule.table}': legalHold 'tenant_scoped', but the table declares no ` +
            `text('tenant_id') column — the executor has nothing to filter a held tenant on.`,
        );
    }
    if (rule.legalHold !== "tenant_scoped" && hasTenant) {
        errors.push(
            `rule '${rule.table}': legalHold '${rule.legalHold}', but the table DOES carry ` +
            `text('tenant_id'). A hold can be expressed here, so it must be — suspending or ` +
            `exempting a tenant-scoped table preserves either too much or nothing.`,
        );
    }
}

const explicit = new Set(EXPLICIT_LEDGER_TABLES);
const inScope = [...schemaTables].filter((t) => LEDGER_NAME.test(t) || explicit.has(t)).sort();

for (const table of inScope) {
    if (seen.has(table)) continue;
    errors.push(
        `'${table}' is a ledger-shaped table with no retention decision. Add a rule to ` +
        `RETENTION_MANIFEST, an exclusion to RETENTION_OUT_OF_SCOPE, or a dated entry to ` +
        `RETENTION_OPEN in server/lib/compliance/retention-manifest.ts.`,
    );
}

// An explicit inclusion that no longer exists is a line nobody will ever remove
// otherwise, and it quietly shrinks what the gate covers.
if (schemaDirArg === -1) {
    for (const table of EXPLICIT_LEDGER_TABLES) {
        if (!schemaTables.has(table)) {
            errors.push(
                `EXPLICIT_LEDGER_TABLES names '${table}', which is not in the schema. If the table ` +
                `was renamed or dropped, update this list in the same change.`,
            );
        }
    }
    // A declared table that vanished from the schema leaves a rule acting on
    // nothing, which reads exactly like a rule that works.
    for (const [table, arrName] of seen) {
        if (!schemaTables.has(table)) {
            errors.push(`${arrName} names '${table}', which is not in the schema. Stale entry.`);
        }
    }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (errors.length > 0) {
    console.error("\nRetention manifest lint FAILED:\n");
    for (const e of errors) console.error("  " + e);
    console.error(`\n${errors.length} error(s).`);
    process.exit(1);
}

const byHold = { tenant_scoped: 0, suspend_all: 0, not_applicable: 0 };
for (const rule of rules) {
    if (rule.legalHold in byHold) byHold[rule.legalHold] += 1;
}

// A count of zero enforcing rules is not a pass. Every rule could be classified,
// every note could be present, and the legal-hold invariant could still be
// enforced nowhere — which is exactly what this file looked like before the
// field existed, and it printed OK then too.
if (byHold.tenant_scoped === 0) {
    console.error(
        "retention-manifest lint: ZERO rules declare legalHold 'tenant_scoped'. " +
        "Nothing enforces the hold invariant, so a green run here would mean nothing.",
    );
    process.exit(1);
}

console.log(
    `retention-manifest lint: OK (${rules.length} rules, ${outOfScope.length} out-of-scope, ` +
    `${open.length} open; ${inScope.length} ledger tables in scope of ${schemaTables.size} total).`,
);
console.log(
    `  legal hold: ${byHold.tenant_scoped} enforced by tenant filter · ` +
    `${byHold.suspend_all} suspended while any hold is in force · ` +
    `${byHold.not_applicable} declared unreachable (each with a stated reason).`,
);
