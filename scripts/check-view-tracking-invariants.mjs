#!/usr/bin/env node
/**
 * Delivery-confirmation invariants gate.
 *
 * The conditions below are transcribed from section 5 ("What voids this
 * assessment") of the report-view Legitimate Interests Assessment,
 * `docs/compliance/report-view-lia.md`. They are restated here as engineering
 * invariants for one reason: whoever changes this code should be stopped HERE,
 * rather than being expected to have read a document that says the same thing
 * in prose, in another directory, at some earlier time.
 *
 * Each condition must appear as a comment anchor at the site it governs:
 *
 *     // view-invariant: <id> - <the condition, stated as an invariant>
 *
 * The check runs in both directions. A declared condition with no anchor means
 * the code moved out from under the assessment; an anchor whose id is not
 * declared means someone invented a condition, or renamed one, and the two
 * halves stopped agreeing.
 *
 * Both numbers print on every run, pass or fail. A gate that speaks only when
 * it is angry cannot be checked on the day it is quiet, and zero conditions or
 * zero scanned files is a FAILURE here, not a clean tree.
 *
 * Usage: node scripts/check-view-tracking-invariants.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/**
 * One entry per section-5 condition. `id` is what the anchor comment names;
 * `statement` is the condition as an invariant, so a reader who trips this gate
 * gets the rule and not just a slug.
 */
const CONDITIONS = [
    {
        id: 'no-per-section-tracking',
        statement:
            'No per-section or per-finding tracking: no dwell time, scroll depth, which sections were ' +
            'expanded, which photos were viewed. Its purpose is inference about the reader.',
    },
    {
        id: 'no-client-instrumentation',
        statement:
            'No client-side instrumentation, for any reason, including one added to improve the accuracy ' +
            'of the counters.',
    },
    {
        id: 'no-email-pixel',
        statement: 'No tracking pixel in the delivery email.',
    },
    {
        id: 'no-device-signals',
        statement:
            'No IP address, user agent, referrer or any other device signal recorded alongside the counters.',
    },
    {
        id: 'no-event-log',
        statement:
            'The counters are not an event log: one upserted row per (recipient, order), never a row per ' +
            'view, which would be a chronology of when a named person read a document.',
    },
    {
        id: 'no-secondary-use',
        statement:
            'No secondary use: no marketing, lead scoring, segmentation, ranking, or training anything.',
    },
    {
        id: 'report-id-is-a-report-id',
        statement:
            'A report identifier is never populated with something that is not a report identifier; the ' +
            'counter row is honestly order-scoped until per-report identity exists.',
    },
];

const ROOTS = ['server', 'app'];
const EXT = /\.(ts|tsx)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '.types', 'paraglide']);
const ANCHOR = /view-invariant:\s*([a-z0-9-]+)/g;

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (SKIP_DIR.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (EXT.test(name)) out.push(p);
    }
    return out;
}

const files = ROOTS.flatMap((r) => {
    try {
        return walk(join(ROOT, r));
    } catch {
        return [];
    }
});

/** id -> [file, ...] */
const found = new Map();
for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [, id] of text.matchAll(ANCHOR)) {
        const where = relative(ROOT, file).split(sep).join('/');
        const list = found.get(id) ?? [];
        if (!list.includes(where)) list.push(where);
        found.set(id, list);
    }
}

const declared = CONDITIONS.map((c) => c.id);
const anchored = declared.filter((id) => found.has(id));
const missing = CONDITIONS.filter((c) => !found.has(c.id));
const unknown = [...found.keys()].filter((id) => !declared.includes(id));

console.log(
    `[view-invariants] ${declared.length} condition(s) declared, ${anchored.length} anchored in code ` +
    `(${files.length} source file(s) scanned)`,
);

if (declared.length === 0) {
    console.error(
        '[view-invariants] FAIL - zero conditions declared. An empty list passes every check below ' +
        'while guarding nothing.',
    );
    process.exit(1);
}

if (files.length === 0) {
    console.error(
        '[view-invariants] FAIL - scanned zero files. The walker is broken, not the tree: ' +
        '"found nothing" and "looked at nothing" produce the same empty result.',
    );
    process.exit(1);
}

let failed = false;

if (missing.length > 0) {
    failed = true;
    console.error(`\n${missing.length} condition(s) have no anchor in the code they govern:\n`);
    for (const c of missing) {
        console.error(`  ${c.id}\n      ${c.statement}`);
    }
    console.error(
        '\nAdd `// view-invariant: <id> - <statement>` at the site the condition governs, ' +
        'or - if the condition genuinely no longer applies - a new assessment says so, not this file.',
    );
}

if (unknown.length > 0) {
    failed = true;
    console.error(`\n${unknown.length} anchor(s) name a condition this gate does not declare:\n`);
    for (const id of unknown) {
        console.error(`  ${id}  (in ${found.get(id).join(', ')})`);
    }
    console.error('\nEither the id is a typo, or a condition was invented outside the assessment.');
}

process.exit(failed ? 1 : 0);
