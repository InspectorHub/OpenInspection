#!/usr/bin/env node
/**
 * lint:processing-stores — every store this worker can reach has a registry entry.
 *
 * `compliance/processing-stores.jsonc` only means something if something reads
 * it. Left unread it is a document, and a document goes stale the first time
 * somebody adds a binding — which is precisely the failure it was written to
 * end, since the existing compliance gates read one filesystem input (the
 * Drizzle table directory) and so could only ever see database columns.
 *
 * ── Why this parses JSONC instead of grepping it ────────────────────────────
 * The first draft of this gate matched bindings with two regexes:
 *
 *     "binding"\s*:\s*"([A-Z_][A-Z0-9_]*)"
 *     "name"\s*:\s*"([a-z0-9-]+)"[^}]*"class_name"
 *
 * Run against the real configs they returned 14 names. Seventeen exist. The
 * four Durable Objects were missed because their binding is declared under
 * `name` in UPPER_SNAKE, which the second pattern's character class excludes;
 * RATE_LIMITER was missed because it lives in `unsafe.bindings` and has no
 * `class_name`; and two of the fourteen were not bindings at all but the
 * `name` field of the workflow whose binding had already been counted.
 *
 * A gate that undercounts its own input is the exact shape this repository
 * keeps rediscovering: it prints a confident number, the number is wrong, and
 * nothing about a green run says which. INSPECTION_DOC — the store with no
 * deletion path, the reason this program exists — was one of the five it
 * silently dropped. So the configs are parsed as JSON with comments stripped
 * and the whole tree is walked, which cannot miss a binding table nobody
 * remembered to enumerate. `stream` was such a table.
 *
 * ── Four inputs, four pairs of numbers, never merged ────────────────────────
 * Bindings, consumed queues and external processors are counted separately
 * because they fail differently: a platform binding count reading "complete"
 * while the email and AI sub-processors stayed invisible is a full-looking
 * registry that omits everyone data actually leaves the estate to. Env vars
 * are the fourth and are checked by ATTRIBUTION rather than by their own
 * entries — STREAM_CUSTOMER_SUBDOMAIN configures the STREAM store and does not
 * deserve a second row of its own.
 *
 * Usage: node scripts/check-processing-stores.mjs [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'compliance', 'processing-stores.jsonc');
const CONFIGS = ['wrangler.jsonc', 'wrangler.saas.jsonc'];
const ADAPTER_DIRS = [
    join('server', 'lib', 'email', 'providers'),
    join('server', 'lib', 'ai', 'providers'),
];
/** Not a processor: the shared call-recording helper both provider families import. */
const ADAPTER_SKIP = /recording\.ts$/;
/** Vars naming an external endpoint or model. Each must be attributed to an entry. */
const TRACKED_VARS = ['AI_MODEL', 'SENDER_EMAIL', 'STREAM_CUSTOMER_SUBDOMAIN'];

const REQUIRED_FIELDS = [
    'store_type', 'modes', 'role', 'lifecycle_owner', 'data_categories',
    'subjects', 'purpose', 'retention_rule', 'deletion_mechanism',
    'export_mechanism', 'tenant_scope', 'evidence_level',
];
const COORDINATES = ['EU', 'US_CA', 'US_CO', 'CA'];
const EVIDENCE_LEVELS = ['E0', 'E1', 'E2', 'E3', 'E4'];
/**
 * A retention_rule is either a POINTER into the manifest (`engine:NAME`) or one
 * of these, which each say WHO holds the clock. Free text is refused: it is how
 * a window gets restated in a second place and the two drift.
 */
const RETENTION_VOCAB = [
    'none', 'none-at-rest', 'not-applicable', 'unknown', 'connection-bounded',
    'window-bounded', 'queue-managed', 'workflow-managed', 'provider-managed',
    'vendor-managed',
];
/** Values of deletion_mechanism that mean "there isn't one". Counted, not tolerated. */
const DELETION_GAPS = ['none', 'unknown', 'partial'];

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Strip comments and trailing commas, leaving parseable JSON.
 *
 * A scanner rather than a regex, because a regex cannot tell a comment from a
 * URL or from the same characters inside a string, and both appear in these
 * files: a comment reading `// the "Deploy to Cloudflare" target` defeats any
 * pattern that stops at a quote, and `"https://…"` defeats any that does not.
 * Tracking string state is the only thing that gets both right.
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
 * Every binding name declared anywhere in a wrangler config.
 *
 * Two shapes, and the second only when the first is absent: an object with a
 * `binding` key declares one, and an object with `name` plus either
 * `class_name` (Durable Objects) or `type: 'ratelimit'` declares one too. The
 * "only when absent" clause is load-bearing — a workflow carries BOTH a
 * `binding` and a `name`, and counting the latter invents a store.
 */
function bindingsFromConfig(node, out = new Set()) {
    if (Array.isArray(node)) {
        for (const v of node) bindingsFromConfig(v, out);
    } else if (node && typeof node === 'object') {
        if (typeof node.binding === 'string') out.add(node.binding);
        else if (typeof node.name === 'string'
            && (typeof node.class_name === 'string' || node.type === 'ratelimit')) out.add(node.name);
        for (const v of Object.values(node)) bindingsFromConfig(v, out);
    }
    return out;
}

/** Queues this worker CONSUMES. They carry payloads and have no binding name. */
function consumedQueues(node, out = new Set()) {
    for (const q of node?.queues?.consumers ?? []) if (q?.queue) out.add(q.queue);
    return out;
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

function adapterModules() {
    return ADAPTER_DIRS
        .flatMap((d) => walk(join(ROOT, d)))
        .filter((f) => /\.ts$/.test(f) && !ADAPTER_SKIP.test(f))
        .map((f) => relative(ROOT, f).split('\\').join('/'));
}

// ── Predicates ──────────────────────────────────────────────────────────────

/**
 * Both take `declared` as a Set OR an Array and normalize. The first draft
 * required a Set, every self-test control handed it one, and the array call
 * site (the adapter list) threw on the first real run — a self-test whose
 * positive controls all share one shape proves the gate works on that shape.
 */
const findMissing = (declared, entries, key = 'binding') =>
    [...declared].filter((d) => !entries.some((e) => (
        e[key] === d || (Array.isArray(e[key]) && e[key].includes(d))
    )));

const findStale = (declared, entries, key = 'binding') => {
    const set = declared instanceof Set ? declared : new Set(declared);
    return entries.flatMap((e) => {
        const named = Array.isArray(e[key]) ? e[key] : (e[key] ? [e[key]] : []);
        return named.filter((n) => !set.has(n));
    });
};

/** Zero declared surfaces means the parse failed, not that the worker has none. */
const surfacesAreImplausible = (declared) => declared.size === 0;

/** Every tracked var must be named by some entry's env_vars. */
const findUnattributedVars = (vars, entries) =>
    vars.filter((v) => !entries.some((e) => (e.env_vars ?? []).includes(v)));

function fieldProblems(entry, manifestExports) {
    const id = entry.binding ?? entry.external_processor ?? (entry.queues ?? []).join(',') ?? '?';
    const problems = [];
    for (const f of REQUIRED_FIELDS) {
        const v = entry[f];
        if (v === undefined || v === null || v === '') problems.push(`${id}: '${f}' is empty`);
    }
    const role = entry.role ?? {};
    for (const c of COORDINATES) {
        if (!role[c]) problems.push(`${id}: role coordinate '${c}' is missing — say unclassified, do not omit`);
        else if (!('legal_role' in role[c]) || !('basis' in role[c])) {
            problems.push(`${id}: role.${c} is not an object carrying its basis`);
        } else if (role[c].legal_role !== 'unclassified' && !role[c].basis) {
            problems.push(`${id}: role.${c} asserts '${role[c].legal_role}' with no basis`);
        }
    }
    if (entry.evidence_level && !EVIDENCE_LEVELS.includes(entry.evidence_level)) {
        problems.push(`${id}: evidence_level '${entry.evidence_level}' is not on the E0–E4 ladder`);
    }
    const rr = entry.retention_rule;
    if (typeof rr === 'string' && !RETENTION_VOCAB.includes(rr)) {
        if (!rr.startsWith('engine:')) {
            problems.push(`${id}: retention_rule '${rr}' is neither a pointer nor in the vocabulary`);
        } else if (!manifestExports.has(rr.slice('engine:'.length))) {
            problems.push(`${id}: retention_rule points at '${rr}', which retention-manifest.ts does not export`);
        }
    }
    return problems;
}

// ── Self-test ───────────────────────────────────────────────────────────────

/**
 * Positive controls are real shapes from this repository — including the two
 * the regex draft got wrong, because a self-test built from shapes the gate
 * already handles proves nothing about the ones it does not.
 */
function selfTest() {
    const checks = [];
    checks.push(['an unregistered binding is reported', findMissing(
        ['DB', 'PHOTOS'], [{ binding: 'DB' }],
    ).length === 1]);
    checks.push(['a stale entry is reported', findStale(
        new Set(['DB']), [{ binding: 'DB' }, { binding: 'GONE' }],
    ).length === 1]);
    checks.push(['zero bindings parsed is a failure', surfacesAreImplausible(new Set())]);
    // The adapter list arrives as an Array, not a Set. This threw on the first
    // real run precisely because every control above hands findStale a Set.
    checks.push(['findStale accepts an array of declared names', findStale(
        ['a.ts'], [{ external_processor: 'a.ts' }, { external_processor: 'gone.ts' }], 'external_processor',
    ).length === 1]);

    // The real durable_objects shape: binding declared under `name`, UPPER_SNAKE.
    const dos = bindingsFromConfig({ durable_objects: { bindings: [
        { name: 'INSPECTION_DOC', class_name: 'InspectionDocDO' },
    ] } });
    checks.push(['a Durable Object binding is found under `name`', dos.has('INSPECTION_DOC')]);

    // The real unsafe shape: no class_name, so a class_name-anchored rule misses it.
    const rl = bindingsFromConfig({ unsafe: { bindings: [
        { type: 'ratelimit', name: 'RATE_LIMITER', namespace_id: '1001' },
    ] } });
    checks.push(['a ratelimit binding is found without a class_name', rl.has('RATE_LIMITER')]);

    // The real workflows shape: a workflow's `name` is not a second binding.
    const wf = bindingsFromConfig({ workflows: [
        { binding: 'SIGN_COMPLETION_WORKFLOW', name: 'sign-completion-workflow', class_name: 'SignCompletionWorkflow' },
    ] });
    checks.push(['a workflow contributes one binding, not two', wf.size === 1 && wf.has('SIGN_COMPLETION_WORKFLOW')]);

    // A binding table nobody enumerated — `stream` was exactly this.
    const st = bindingsFromConfig({ some_future_table: { binding: 'NEW_THING' } });
    checks.push(['a binding table nobody listed is still walked', st.has('NEW_THING')]);

    // A queue named by an entry's `queues` array counts as registered.
    checks.push(['an entry may cover a queue through its queues array', findMissing(
        ['q-a'], [{ binding: 'B', queues: ['q-a'] }], 'queues',
    ).length === 0]);

    // An asserted role with no basis is refused; unclassified with none is fine.
    const bad = fieldProblems(baseEntry({ role: coord('processor', null) }), new Set());
    checks.push(['an asserted role with no basis is refused',
        bad.some((p) => p.includes('with no basis'))]);
    const ok = fieldProblems(baseEntry({}), new Set());
    checks.push(['a fully unclassified role passes', ok.length === 0]);

    // A dangling manifest pointer is refused.
    const dangling = fieldProblems(baseEntry({ retention_rule: 'engine:NO_SUCH' }), new Set(['RETENTION_MANIFEST']));
    checks.push(['a dangling retention pointer is refused',
        dangling.some((p) => p.includes('does not export'))]);

    // An unattributed var is reported.
    checks.push(['an unattributed env var is reported', findUnattributedVars(
        ['AI_MODEL'], [{ binding: 'X', env_vars: [] }],
    ).length === 1]);

    const failed = checks.filter(([, ok2]) => !ok2);
    for (const [name] of failed) console.error(`  WRONG: ${name}`);
    console.log(`  self-test: ${checks.length} checks, ${failed.length} wrong`);
    return failed.length === 0;
}

const coord = (legal_role, basis) => Object.fromEntries(
    COORDINATES.map((c) => [c, { legal_role, basis, determined_at: null, source: null }]),
);
const baseEntry = (over) => ({
    store_type: 'kv', binding: 'X', modes: ['saas'], role: coord('unclassified', null),
    lifecycle_owner: 'engine', data_categories: [], subjects: [], purpose: 'p',
    retention_rule: 'none', deletion_mechanism: 'none', export_mechanism: 'none',
    tenant_scope: 'per-tenant', evidence_level: 'E2', ...over,
});

// ── Driver ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
if (!selfTest()) {
    console.error('\n✘ processing-stores gate: its own self-test failed. Fix the gate before trusting it.');
    process.exit(1);
}

const bindings = new Set();
const queues = new Set();
let configsRead = 0;
for (const name of CONFIGS) {
    let raw;
    try { raw = readFileSync(join(ROOT, name), 'utf8'); } catch { continue; }
    const cfg = JSON.parse(stripJsonc(raw));
    bindingsFromConfig(cfg, bindings);
    consumedQueues(cfg, queues);
    configsRead++;
}

const adapters = adapterModules();
const registry = JSON.parse(stripJsonc(readFileSync(REGISTRY, 'utf8')));
const entries = registry.stores ?? [];

const manifestExports = new Set(
    [...readFileSync(join(ROOT, 'server', 'lib', 'compliance', 'retention-manifest.ts'), 'utf8')
        .matchAll(/export const ([A-Z_]+)/g)].map((m) => m[1]),
);

const missingBindings = findMissing(bindings, entries);
const staleBindings = findStale(bindings, entries);
const missingQueues = findMissing(queues, entries, 'queues');
const staleQueues = findStale(queues, entries, 'queues');
const missingAdapters = findMissing(adapters, entries, 'external_processor');
const staleAdapters = findStale(adapters, entries, 'external_processor');
const unattributed = findUnattributedVars(TRACKED_VARS, entries);
const problems = entries.flatMap((e) => fieldProblems(e, manifestExports));

let coordsTotal = 0;
let coordsUnclassified = 0;
for (const e of entries) {
    for (const c of COORDINATES) {
        coordsTotal++;
        if ((e.role?.[c]?.legal_role ?? 'unclassified') === 'unclassified') coordsUnclassified++;
    }
}
const gaps = entries.filter((e) => DELETION_GAPS.includes(e.deletion_mechanism));

// Every pair side by side. A single total would let a complete binding sweep
// read as a complete registry while every sub-processor stayed invisible.
console.log(`\nprocessing stores — ${configsRead} config(s) read`);
console.log(`  bindings            : ${bindings.size} declared / ${bindings.size - missingBindings.length} registered`);
console.log(`  consumed queues     : ${queues.size} declared / ${queues.size - missingQueues.length} registered`);
console.log(`  external processors : ${adapters.length} declared / ${adapters.length - missingAdapters.length} registered`);
console.log(`  tracked env vars    : ${TRACKED_VARS.length} declared / ${TRACKED_VARS.length - unattributed.length} attributed`);
console.log(`  entries             : ${entries.length}`);
console.log(`  role coordinates    : ${coordsTotal} total / ${coordsUnclassified} unclassified`);
console.log(`  deletion gaps       : ${gaps.length} of ${entries.length} entries have no deletion mechanism`);
for (const g of gaps) console.log(`      · ${g.binding ?? g.external_processor ?? (g.queues ?? []).join(',')} — ${g.deletion_mechanism}`);

let failed = false;
const report = (label, list, hint) => {
    if (list.length === 0) return;
    failed = true;
    console.error(`\n✘ ${label}:`);
    for (const x of list) console.error(`    ${x}`);
    if (hint) console.error(`  ${hint}`);
};

if (configsRead === 0) {
    console.error('\n✘ Read zero wrangler configs — the gate is looking in the wrong place, not passing.');
    failed = true;
}
if (surfacesAreImplausible(bindings)) {
    console.error('\n✘ Parsed zero bindings — that is a parse failure, not a worker with no stores.');
    failed = true;
}
if (adapters.length === 0) {
    console.error('\n✘ Found zero provider adapters — the directories moved, and this gate did not notice.');
    failed = true;
}
report('Declared bindings with no registry entry', missingBindings,
    'A store nobody registered is a store compliance cannot see.');
report('Registry entries naming a binding that no longer exists', staleBindings);
report('Consumed queues with no registry entry', missingQueues);
report('Registry entries naming a queue that no longer exists', staleQueues);
report('Provider adapters with no registry entry', missingAdapters,
    'Sub-processors are not bindings; they are where data leaves the estate.');
report('Registry entries naming an adapter that no longer exists', staleAdapters);
report('Tracked env vars attributed to no entry', unattributed,
    'Name the var in the env_vars of the store it configures.');
report('Entry field problems', problems);

if (failed) {
    console.error('\n  compliance/processing-stores.jsonc is the file to fix.\n');
    process.exit(1);
}

console.log('\n✓ Every reachable store has an entry.\n');
