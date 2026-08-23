#!/usr/bin/env node
/**
 * lint:platform-defaults — the defaults we ship, and the ones we admit we cannot see.
 *
 * `compliance/platform-defaults.jsonc` records, for every default this engine
 * ships to a fresh workspace: who owns the value, what kind of decision it is,
 * and whether the controller must be able to override it.
 *
 * ── Why this is a SEPARATE, WEAKER gate than lint:processing-stores ──────────
 * The store registry has a complete input: both wrangler configs declare every
 * store the worker can reach, so "declared" is a real denominator and a missing
 * entry is a provable omission. There is no such table for "every default we
 * ship". Defaults live in Drizzle `.default()` declarations, in module constants,
 * and in `??` / `if` branches inside services. This gate can enumerate exactly
 * one of those three: the `tenant_configs` `.default()` set. It cannot see a
 * hard-coded branch, and nothing about a green run says otherwise.
 *
 * So the numbers below are printed as a PARTIAL denominator, out loud, on every
 * run: the anchored set, plus a count of the `.default()` declarations in the
 * rest of the schema that are deliberately out of scope. Merging this register
 * into the store registry and gating them alike would make it look as complete
 * as that one — which is the exact failure this program exists to fix.
 *
 * ── What it does check, hard ────────────────────────────────────────────────
 *  1. Every `tenant_configs` `.default()` has an entry (and no entry names a
 *     column that no longer exists).
 *  2. The entry's recorded `default_value` still matches the literal in the
 *     schema. A default changing from 7 years to 10 without a re-review is the
 *     failure mode a register of static prose cannot catch.
 *  3. The entry's `property` still matches the Drizzle property for that column,
 *     so a rename on either side is visible.
 *  4. `decision_type` is on the taxonomy below, and anything not yet classified
 *     is `unreviewed` with a null basis — COUNTED and printed every run, never
 *     silently absent. An unreviewed default that reads as reviewed is worse
 *     than one openly marked open.
 *  5. A retention-shaped column is `controller_choice` with
 *     `controller_override: required`. How long client data is kept is not ours
 *     to decide quietly, so that rule is executable
 *     here rather than prose in a header nobody re-reads.
 *  6. Where an override is claimed, `override_surface` names a file that exists
 *     and mentions the column or property. A claimed override pointing at a
 *     moved file is a claim the register can no longer support.
 *
 * Zero parsed declarations, zero entries, or a table body it cannot find are all
 * HARD FAILURES: a gate that scanned nothing must not be mistakable for a gate
 * that found nothing.
 *
 * Usage: node scripts/check-platform-defaults.mjs [--self-test]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTER = join(ROOT, 'compliance', 'platform-defaults.jsonc');
const SCHEMA_DIR = join('server', 'lib', 'db', 'schema');
/** The one input with a real denominator. Everything else is out of scope. */
const ANCHOR_FILE = join(SCHEMA_DIR, 'tenant', 'core.ts');
const ANCHOR_TABLE = 'tenant_configs';

const REQUIRED_FIELDS = [
    'column', 'property', 'default_value', 'default_owner', 'decision_type',
    'basis', 'controller_override',
];
/** The three classified values, plus the honest fourth. `unreviewed` is counted. */
const DECISION_TYPES = ['technical', 'service_safeguard', 'controller_choice', 'unreviewed'];
/**
 * Who can change the value a fresh workspace receives WITHOUT a code change to
 * this repository. `engine` is the common case and says so; the distribution is
 * printed so a register that quietly became all-one-value is visible.
 */
const DEFAULT_OWNERS = ['engine', 'deployment', 'platform-write'];
const OVERRIDE_STATES = ['required', 'available', 'none', 'unreviewed'];
/**
 * Retention-shaped column names. `reserve_term_years` is NOT one: it is a
 * projection horizon in a report table, not a period anything is kept for —
 * which is why this matches on the word and not merely on a `_years` suffix.
 */
const RETENTION_SHAPED = /retention/;

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Strip comments and trailing commas from JSONC, leaving parseable JSON.
 *
 * A scanner, not a regex: a regex cannot tell a comment from the same characters
 * inside a string, and both appear in these files.
 */
function stripJsonc(text) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            out += c;
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') { inString = true; out += c; continue; }
        if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i++;
            continue;
        }
        out += c;
    }
    return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Blank out TypeScript comments while preserving line numbering and string
 * contents. Load-bearing: this schema's prose says things like "null = use the
 * built-in default", and a commented-out declaration must not be counted as one
 * that ships. Template literals count as strings here because `.default(sql`…`)`
 * is a real shape in this table and its contents contain braces and quotes.
 */
function blankTsComments(text) {
    let out = '';
    let quote = null;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            out += c;
            if (escaped) escaped = false;
            else if (c === '\\') escaped = true;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
        if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                if (text[i] === '\n') out += '\n';
                i++;
            }
            i++;
            continue;
        }
        out += c;
    }
    return out;
}

/**
 * The body of one `sqliteTable('name', { … })` call, comments blanked.
 *
 * Brace-counted rather than terminated by a `});` at column zero: the latter is
 * a formatting convention, and a gate anchored on formatting fails silently the
 * day somebody reformats.
 */
function tableBody(source, table) {
    const clean = blankTsComments(source);
    const marker = new RegExp(`sqliteTable\\(\\s*'${table}'`);
    const at = clean.search(marker);
    if (at < 0) return null;
    const open = clean.indexOf('{', at);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < clean.length; i++) {
        if (clean[i] === '{') depth++;
        else if (clean[i] === '}') {
            depth--;
            if (depth === 0) return clean.slice(open + 1, i);
        }
    }
    return null;
}

/** The text of one balanced `(...)` starting at the given `(` index. */
function balancedParen(text, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) return text.slice(openIdx + 1, i);
        }
    }
    return null;
}

const COLUMN_DECL = /^\s*(\w+)\s*:\s*(?:integer|text|real|blob|numeric)\(\s*'([^']+)'/;

/**
 * Every `.default(…)` in a table body, attributed to its column.
 *
 * Attribution walks BACKWARDS to the nearest column declaration because six of
 * this table's declarations put the `.default()` on a later line than the
 * property name:
 *
 *     bookingConflictPolicy: text('booking_conflict_policy', {
 *         enum: ['advisory', 'block'],
 *     }).notNull().default('advisory'),
 *
 * A line-local regex sees `.notNull().default('advisory')` with no column in
 * sight and either skips it or, worse, attributes it to whatever was above.
 */
function parseDefaults(body) {
    // Blanked here as well as in `tableBody`, which is idempotent, so that the
    // parser cannot be wired up in a way that lets a commented-out declaration
    // through. The self-test feeds it raw source for exactly that reason.
    const lines = blankTsComments(body).split(/\r?\n/);
    const found = [];
    let current = null;
    for (const line of lines) {
        const decl = COLUMN_DECL.exec(line);
        if (decl) current = { property: decl[1], column: decl[2] };
        const at = line.indexOf('.default(');
        if (at < 0 || !current) continue;
        const inner = balancedParen(line, line.indexOf('(', at));
        found.push({
            ...current,
            default_value: (inner ?? '').replace(/\s+/g, ' ').trim(),
        });
    }
    return found;
}

function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

/**
 * `.default(` occurrences in the schema OUTSIDE the anchored table. Not a
 * denominator and not gated — printed so nobody mistakes the anchored count for
 * "every default we ship".
 */
function outOfScopeDefaults() {
    let count = 0;
    let files = 0;
    for (const f of walk(join(ROOT, SCHEMA_DIR))) {
        if (!/\.ts$/.test(f)) continue;
        files++;
        const rel = relative(ROOT, f).split('\\').join('/');
        let text = blankTsComments(readFileSync(f, 'utf8'));
        if (rel === ANCHOR_FILE.split('\\').join('/')) {
            const body = tableBody(readFileSync(f, 'utf8'), ANCHOR_TABLE);
            if (body) text = text.split(body).join('');
        }
        count += (text.match(/\.default\(/g) ?? []).length;
    }
    return { count, files };
}

// ── Predicates ──────────────────────────────────────────────────────────────

const findMissing = (declared, entries) =>
    declared.filter((d) => !entries.some((e) => e.column === d.column))
        .map((d) => `${d.column} (${d.property}) = ${d.default_value}`);

const findStale = (declared, entries) =>
    entries.filter((e) => !declared.some((d) => d.column === e.column))
        .map((e) => `${e.column} — no such .default() in ${ANCHOR_TABLE}`);

/**
 * One column, one entry. A copy-pasted entry whose classification was only
 * half-edited leaves two contradictory answers for one default, and every count
 * above still adds up — `findMissing` is satisfied by either copy.
 */
function findDuplicates(entries) {
    const seen = new Map();
    for (const e of entries) seen.set(e.column, (seen.get(e.column) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([c, n]) => `${c} — ${n} entries for one column`);
}

/** Zero parsed declarations means the parse broke, not that the table has none. */
const parseIsImplausible = (declared) => declared.length === 0;

/** The recorded value and the shipped value must still agree. */
function findValueDrift(declared, entries) {
    const out = [];
    for (const d of declared) {
        const e = entries.find((x) => x.column === d.column);
        if (!e) continue;
        if (e.default_value !== d.default_value) {
            out.push(`${d.column}: register says ${e.default_value} · schema ships ${d.default_value}`);
        }
        if (e.property !== d.property) {
            out.push(`${d.column}: register says property '${e.property}' · schema declares '${d.property}'`);
        }
    }
    return out;
}

function fieldProblems(entry) {
    const id = entry.column ?? '?';
    const problems = [];
    for (const f of REQUIRED_FIELDS) {
        if (!(f in entry)) problems.push(`${id}: '${f}' is absent — say it, do not omit it`);
    }
    if (!DECISION_TYPES.includes(entry.decision_type)) {
        problems.push(`${id}: decision_type '${entry.decision_type}' is not on the taxonomy (${DECISION_TYPES.join(' · ')})`);
    }
    if (!DEFAULT_OWNERS.includes(entry.default_owner)) {
        problems.push(`${id}: default_owner '${entry.default_owner}' is not in the vocabulary (${DEFAULT_OWNERS.join(' · ')})`);
    }
    if (!OVERRIDE_STATES.includes(entry.controller_override)) {
        problems.push(`${id}: controller_override '${entry.controller_override}' is not in the vocabulary (${OVERRIDE_STATES.join(' · ')})`);
    }
    if (entry.decision_type === 'unreviewed') {
        if (entry.basis !== null) problems.push(`${id}: unreviewed carries a basis — an unreviewed default has no reasoning to cite`);
        if (entry.controller_override !== 'unreviewed') {
            problems.push(`${id}: decision_type is unreviewed but controller_override claims '${entry.controller_override}' — the override question follows the classification`);
        }
    } else if (!entry.basis) {
        problems.push(`${id}: decision_type '${entry.decision_type}' asserted with no basis`);
    }
    if (RETENTION_SHAPED.test(id) && (entry.decision_type !== 'controller_choice' || entry.controller_override !== 'required')) {
        problems.push(`${id}: retention-shaped defaults are controller_choice with controller_override 'required' — this says '${entry.decision_type}' / '${entry.controller_override}'`);
    }
    return problems;
}

/**
 * An override the register CLAIMS must point at a file that exists and mentions
 * the column or the property. `readFile` is the caller's, so the self-test can
 * drive this without touching disk.
 *
 * `unreviewed` MAY still carry a surface, and deliberately: whether a settings
 * screen exists is a fact about the code, while whether an override is legally
 * required is a judgement about the default. Forcing the first to null while the
 * second is open would throw away the verified half.
 */
function overrideSurfaceProblems(entry, exists, readFile) {
    const id = entry.column ?? '?';
    const surface = entry.override_surface ?? null;
    if (entry.controller_override === 'required' || entry.controller_override === 'available') {
        if (!surface) return [`${id}: claims an override with no override_surface naming where`];
    } else if (entry.controller_override === 'none' && surface) {
        return [`${id}: controller_override 'none' but an override_surface is named — one of the two is wrong`];
    }
    if (!surface) return [];
    if (!exists(surface)) return [`${id}: override_surface '${surface}' does not exist`];
    const text = readFile(surface);
    if (!text.includes(entry.column) && !text.includes(entry.property)) {
        return [`${id}: override_surface '${surface}' exists but mentions neither '${entry.column}' nor '${entry.property}'`];
    }
    return [];
}

// ── Self-test ───────────────────────────────────────────────────────────────

const baseEntry = (over) => ({
    column: 'x_col', property: 'xCol', default_value: "'a'", default_owner: 'engine',
    decision_type: 'technical', basis: 'b', controller_override: 'none',
    override_surface: null, ...over,
});

/**
 * Positive controls are real shapes from THIS repository — the six multi-line
 * declarations, the `sql` template default, the extra-whitespace declaration,
 * and a comment that talks about defaults. A self-test assembled from shapes the
 * parser already handles proves nothing about the ones it does not.
 */
function selfTest() {
    const checks = [];
    const t = (name, ok) => checks.push([name, ok]);

    // The real single-line shape.
    const oneLine = parseDefaults("    reportPdfRetentionYears: integer('report_pdf_retention_years').notNull().default(7),");
    t('a single-line default is attributed to its column',
        oneLine.length === 1 && oneLine[0].column === 'report_pdf_retention_years' && oneLine[0].default_value === '7');

    // The real multi-line shape — six of these exist, and a line-local regex
    // cannot see the column name from the line carrying `.default(`.
    const multi = parseDefaults([
        "    bookingConflictPolicy: text('booking_conflict_policy', {",
        "        enum: ['advisory', 'block'],",
        "    }).notNull().default('advisory'),",
    ].join('\n'));
    t('a multi-line declaration is attributed to its own column',
        multi.length === 1 && multi[0].column === 'booking_conflict_policy'
        && multi[0].property === 'bookingConflictPolicy' && multi[0].default_value === "'advisory'");

    // The real `sql` template shape, whose value contains quotes and braces.
    const sqlDefault = parseDefaults([
        "    attentionThresholds: text('attention_thresholds', { mode: 'json' })",
        '        .notNull()',
        '        .default(sql`\'{"agreement_unsigned_h":72}\'`),',
    ].join('\n'));
    t('a sql-template default is captured whole',
        sqlDefault.length === 1 && sqlDefault[0].column === 'attention_thresholds'
        && sqlDefault[0].default_value.includes('agreement_unsigned_h'));

    // The real aligned-whitespace shape.
    const padded = parseDefaults("    teamModeDefault:          integer('is_team_mode_default',          { mode: 'boolean' }).notNull().default(false),");
    t('an aligned declaration with padded whitespace is parsed',
        padded.length === 1 && padded[0].column === 'is_team_mode_default');

    // Real prose from this schema. A comment is not a shipped default.
    const commented = parseDefaults([
        "    reinspectionStatuses: text('reinspection_statuses'),",
        '    // null = use the built-in default',
        "    // was: .default('resolved'),",
    ].join('\n'));
    t('a commented-out default is not counted', commented.length === 0);

    // A nullable column contributes nothing.
    t('a column with no default is not counted',
        parseDefaults("    logoUrl: text('logo_url'),").length === 0);

    // Table isolation: brace-counted, not formatting-anchored.
    const body = tableBody([
        "export const other = sqliteTable('other', { a: integer('a').default(1) });",
        "export const tenantConfigs = sqliteTable('tenant_configs', { b: integer('b').notNull().default(2) });",
    ].join('\n'), 'tenant_configs');
    t('the anchored table body excludes its neighbours',
        body !== null && body.includes("integer('b')") && !body.includes("integer('a')"));
    t('a table that is not there returns null, not an empty body',
        tableBody('export const x = 1;', 'tenant_configs') === null);

    // Missing / stale, both directions.
    const declared = [{ column: 'a', property: 'aa', default_value: '1' }, { column: 'b', property: 'bb', default_value: '2' }];
    t('a default present in code but missing from the register is reported',
        findMissing(declared, [{ column: 'a' }]).length === 1);
    t('a register entry naming a column that no longer exists is reported',
        findStale(declared, [{ column: 'a' }, { column: 'gone' }]).length === 1);
    t('zero parsed declarations is a failure', parseIsImplausible([]));
    t('two entries for one column are reported',
        findDuplicates([{ column: 'a' }, { column: 'a' }, { column: 'b' }]).length === 1);
    t('one entry per column is silent',
        findDuplicates([{ column: 'a' }, { column: 'b' }]).length === 0);

    // Value drift, in both fields.
    t('a changed default value is reported', findValueDrift(
        [{ column: 'a', property: 'aa', default_value: '10' }], [{ column: 'a', property: 'aa', default_value: '7' }],
    ).length === 1);
    t('a renamed property is reported', findValueDrift(
        [{ column: 'a', property: 'renamed', default_value: '7' }], [{ column: 'a', property: 'aa', default_value: '7' }],
    ).length === 1);
    t('an agreeing entry is silent', findValueDrift(
        [{ column: 'a', property: 'aa', default_value: '7' }], [{ column: 'a', property: 'aa', default_value: '7' }],
    ).length === 0);

    // The taxonomy, and the honest fourth value.
    t('a fully recorded entry passes', fieldProblems(baseEntry({})).length === 0);
    t('an off-taxonomy decision_type is refused',
        fieldProblems(baseEntry({ decision_type: 'obvious' })).some((p) => p.includes('taxonomy')));
    t('an asserted classification with no basis is refused',
        fieldProblems(baseEntry({ basis: null })).some((p) => p.includes('with no basis')));
    t('unreviewed with a null basis passes',
        fieldProblems(baseEntry({ decision_type: 'unreviewed', basis: null, controller_override: 'unreviewed' })).length === 0);
    t('unreviewed carrying a basis is refused',
        fieldProblems(baseEntry({ decision_type: 'unreviewed', basis: 'we think so', controller_override: 'unreviewed' }))
            .some((p) => p.includes('no reasoning to cite')));
    t('unreviewed with a decided override is refused',
        fieldProblems(baseEntry({ decision_type: 'unreviewed', basis: null, controller_override: 'none' }))
            .some((p) => p.includes('follows the classification')));
    t('an absent field is reported rather than read as false',
        fieldProblems({ column: 'y', decision_type: 'technical', basis: 'b', default_owner: 'engine', controller_override: 'none' })
            .some((p) => p.includes("'default_value' is absent")));

    // The retention rule, on the real column names.
    t('a retention default classified technical is refused', fieldProblems(baseEntry({
        column: 'report_pdf_retention_years', decision_type: 'technical', controller_override: 'available',
    })).some((p) => p.includes('retention-shaped defaults are controller_choice')));
    t('a retention default as controller_choice with a required override passes', fieldProblems(baseEntry({
        column: 'agreement_retention_years', decision_type: 'controller_choice', controller_override: 'required',
    })).length === 0);
    // The near-miss that made this a word match and not a `_years$` match.
    t('reserve_term_years is not treated as retention-shaped', fieldProblems(baseEntry({
        column: 'reserve_term_years', decision_type: 'technical', controller_override: 'available',
    })).length === 0);

    // Override surfaces, driven through injected readers.
    const yes = () => true;
    const no = () => false;
    t('a claimed override with no surface is refused', overrideSurfaceProblems(
        baseEntry({ controller_override: 'required', decision_type: 'controller_choice' }), yes, () => '',
    ).some((p) => p.includes('no override_surface')));
    t('an override_surface that does not exist is refused', overrideSurfaceProblems(
        baseEntry({ controller_override: 'available', override_surface: 'app/routes/gone.tsx' }), no, () => '',
    ).some((p) => p.includes('does not exist')));
    t('an override_surface that never mentions the field is refused', overrideSurfaceProblems(
        baseEntry({ controller_override: 'available', override_surface: 'app/routes/settings-inspection.tsx' }),
        yes, () => 'unrelated file contents',
    ).some((p) => p.includes('mentions neither')));
    t('an override_surface mentioning the property passes', overrideSurfaceProblems(
        baseEntry({ controller_override: 'available', override_surface: 'app/routes/settings-inspection.tsx' }),
        yes, () => 'const { xCol } = data;',
    ).length === 0);
    t('a surface named where no override exists is refused', overrideSurfaceProblems(
        baseEntry({ controller_override: 'none', override_surface: 'app/routes/settings-inspection.tsx' }), yes, () => '',
    ).some((p) => p.includes('an override_surface is named')));
    // An unreviewed classification keeps the code fact and is still verified.
    t('an unreviewed entry may keep a verified surface', overrideSurfaceProblems(
        baseEntry({
            decision_type: 'unreviewed', basis: null, controller_override: 'unreviewed',
            override_surface: 'app/routes/settings-inspection.tsx',
        }), yes, () => 'const { xCol } = data;',
    ).length === 0);
    t('an unreviewed entry\'s surface is still checked for rot', overrideSurfaceProblems(
        baseEntry({
            decision_type: 'unreviewed', basis: null, controller_override: 'unreviewed',
            override_surface: 'app/routes/moved.tsx',
        }), no, () => '',
    ).some((p) => p.includes('does not exist')));

    const failed = checks.filter(([, ok]) => !ok);
    for (const [name] of failed) console.error(`  WRONG: ${name}`);
    console.log(`  self-test: ${checks.length} checks, ${failed.length} wrong`);
    return failed.length === 0;
}

// ── Driver ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
if (!selfTest()) {
    console.error('\n✘ platform-defaults gate: its own self-test failed. Fix the gate before trusting it.');
    process.exit(1);
}

let failed = false;
const die = (msg) => { console.error(`\n✘ ${msg}`); failed = true; };

const anchorPath = join(ROOT, ANCHOR_FILE);
let declared = [];
let bodyFound = false;
if (!existsSync(anchorPath)) {
    die(`${ANCHOR_FILE.split('\\').join('/')} is not there — the schema moved and this gate did not notice.`);
} else {
    const body = tableBody(readFileSync(anchorPath, 'utf8'), ANCHOR_TABLE);
    if (body === null) {
        die(`Could not find the '${ANCHOR_TABLE}' table in ${ANCHOR_FILE.split('\\').join('/')} — that is a parse failure, not a table with no defaults.`);
    } else {
        bodyFound = true;
        declared = parseDefaults(body);
    }
}

const register = existsSync(REGISTER)
    ? JSON.parse(stripJsonc(readFileSync(REGISTER, 'utf8')))
    : null;
if (!register) die('compliance/platform-defaults.jsonc is not there.');
const entries = register?.defaults ?? [];

const missing = findMissing(declared, entries);
const stale = findStale(declared, entries);
const drift = findValueDrift(declared, entries);
const duplicates = findDuplicates(entries);
const problems = entries.flatMap((e) => fieldProblems(e));
const surfaceProblems = entries.flatMap((e) => overrideSurfaceProblems(
    e,
    (p) => existsSync(join(ROOT, p)),
    (p) => readFileSync(join(ROOT, p), 'utf8'),
));

const unreviewed = entries.filter((e) => e.decision_type === 'unreviewed');
const byType = Object.fromEntries(DECISION_TYPES.map((k) => [k, 0]));
const byOwner = Object.fromEntries(DEFAULT_OWNERS.map((k) => [k, 0]));
const byOverride = Object.fromEntries(OVERRIDE_STATES.map((k) => [k, 0]));
for (const e of entries) {
    if (e.decision_type in byType) byType[e.decision_type]++;
    if (e.default_owner in byOwner) byOwner[e.default_owner]++;
    if (e.controller_override in byOverride) byOverride[e.controller_override]++;
}
const outOfScope = outOfScopeDefaults();

// Both numbers, side by side, every run. "0 problems" alone cannot be told from
// a gate that scanned nothing.
console.log(`\nplatform defaults — anchored on ${ANCHOR_TABLE} in ${ANCHOR_FILE.split('\\').join('/')}`);
console.log(`  .default() declarations : ${declared.length} declared / ${declared.length - missing.length} registered`);
console.log(`  register entries        : ${entries.length} total / ${unreviewed.length} unreviewed`);
console.log(`  value agreement        : ${declared.length - missing.length} compared / ${drift.length} drifted`);
console.log(`  decision_type          : ${DECISION_TYPES.map((k) => `${k} ${byType[k]}`).join(' · ')}`);
console.log(`  default_owner          : ${DEFAULT_OWNERS.map((k) => `${k} ${byOwner[k]}`).join(' · ')}`);
console.log(`  controller_override    : ${OVERRIDE_STATES.map((k) => `${k} ${byOverride[k]}`).join(' · ')}`);
const surfacesNamed = entries.filter((e) => e.override_surface).length;
console.log(`  override surfaces      : ${surfacesNamed} named / ${surfaceProblems.length} unsupported`);
console.log('  OUT OF SCOPE, uncounted by design:');
console.log(`      · ${outOfScope.count} further .default() declarations across ${outOfScope.files} schema file(s) outside ${ANCHOR_TABLE}`);
console.log('      · every default that lives in a module constant or a code branch — this gate cannot enumerate those at all,');
console.log('        so the denominator above is PARTIAL and a green run is not a claim of completeness.');
for (const u of unreviewed) console.log(`  still unreviewed: ${u.column}`);

if (bodyFound && parseIsImplausible(declared)) {
    die(`Parsed zero .default() declarations from '${ANCHOR_TABLE}' — that is a parse failure, not a table with no defaults.`);
}
if (register && entries.length === 0) {
    die('The register has zero entries — an empty register cannot pass; it has not been written yet.');
}

const report = (label, list, hint) => {
    if (list.length === 0) return;
    failed = true;
    console.error(`\n✘ ${label}:`);
    for (const x of list) console.error(`    ${x}`);
    if (hint) console.error(`  ${hint}`);
};

report('Shipped defaults with no register entry', missing,
    'A default nobody classified is one we cannot say who decided.');
report('Register entries naming a column that no longer ships a default', stale);
report('More than one entry for the same column', duplicates,
    'Two answers for one default is no answer. Delete the copy.');
report('Recorded value no longer matches the schema', drift,
    'Re-review the default, then update the register. A silently changed default is an unreviewed one.');
report('Entry field problems', problems);
report('Unsupported override claims', surfaceProblems);

if (failed) {
    console.error('\n  compliance/platform-defaults.jsonc is the file to fix.\n');
    process.exit(1);
}

console.log(`\n✓ Every ${ANCHOR_TABLE} default is classified — and the limit above is stated, not hidden.\n`);
