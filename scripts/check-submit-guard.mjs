#!/usr/bin/env node
/**
 * scripts/check-submit-guard.mjs — client submit-guard gate (#106).
 *
 * Every user-initiated mutation must leave the browser through
 * `useGuardedSubmit`, which contains the double click AND carries the
 * idempotency key the server-side guard reads. A raw `fetcher.submit()` does
 * neither: it disables nothing, does not flip `fetcher.state` before the handler
 * returns, and sends no key — so both halves of a double click reach the action
 * inside a single render and the server sees two genuinely distinct requests.
 *
 * ⚠️ THIS GATE BANS A CALL SHAPE, NEVER A LITERAL NAME. The obvious rule —
 * search for `fetcher.submit(` — sees 74 of the 157 call sites in `app/` and
 * reports green. The other 83 wear 53 distinct identifiers (`coverFetcher`,
 * `deleteFetcher`, `credFetcher`, `mappingFetcher`, …). The regex is therefore
 * `\w*[Ff]etcher\.submit\s*\(`, and the five-fetcher positive control in
 * tests/unit/platform/check-submit-guard.spec.ts asserts a COUNT so that a
 * literal-name implementation reads red rather than covering half the tree.
 *
 * KNOWN, WRITTEN-DOWN HOLE: a call split across lines (`fetcher\n  .submit(`)
 * does not match. No site in the tree is written that way today, and widening
 * the regex across newlines makes it match unrelated member chains.
 *
 * RULE B — `busy` (see findBusyViolations). The guard contains the double
 * click, but a button with no pending affordance still LOOKS live. Both
 * destructurings type-check identically, so this is the one half of the
 * conversion the compiler cannot see. Rule B is HARD: no baseline, because the
 * population is small and everything written after this gate lands is written
 * converted.
 *
 * ⚠️ FAILS CLOSED WHEN IT CANNOT SEE. Scanning too few files, or finding zero
 * call sites, is a FAILURE — "found nothing" and "looked at nothing" produce the
 * same empty result, and this repo has shipped that mistake before.
 *
 * Usage:
 *   node scripts/check-submit-guard.mjs            # verify (exit 1 on a new hit)
 *   node scripts/check-submit-guard.mjs --update   # rewrite the baseline, then
 *                                                  # exit 1 until every new entry
 *                                                  # carries a written reason
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enclosingSymbol, normalizeSignature, makeKey, diffBaseline } from './lib/symbol-baseline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASELINE_PATH = join(__dirname, 'submit-guard-baseline.json');

/** Client surfaces only. The posture is about what the BROWSER does. */
const SCAN_ROOTS = ['app'];
const EXT = /\.(ts|tsx)$/;
const SKIP_DIR = new Set(['node_modules', 'build', 'dist', '.types', 'paraglide', '__tests__']);
const SKIP_FILE = /\.(test|spec)\.(ts|tsx)$/;

/**
 * The floor. `app/` holds ~680 non-test sources; a scan that sees fewer than
 * this is looking at the wrong tree (a bad cwd, a renamed directory, a broken
 * walk) and must not be allowed to report success.
 */
const MIN_FILES = 300;

/**
 * The baseline holds two populations and they must not be confused:
 *
 *   EXEMPT   — this call is not a user-initiated mutation (a read, an effect, a
 *              poll, a queue drain), or the hook's `Record<string,string>`
 *              signature cannot carry its payload (FormData / JSON bodies).
 *              These stay forever, and the reason says which.
 *   AWAITING — a genuine user mutation that has not been converted to
 *              useGuardedSubmit yet. Frozen so the ratchet still catches NEW raw
 *              submits while the conversion lands directory by directory.
 *
 * They are told apart by this marker in the reason text, and BOTH counts are
 * printed on every run. A single undifferentiated number would let the debt sit
 * here indefinitely reading as "audited".
 */
const CONVERSION_DEBT = /AWAITING #106 CONVERSION/;

/**
 * Files excluded by path. Each needs a SENTENCE, not a name — a bare entry is
 * indistinguishable from a forgotten one.
 */
const ALLOW = new Map([
    [
        'app/hooks/useGuardedSubmit.ts',
        'the hook itself — this is the one legitimate raw fetcher.submit in the tree, ' +
        'at line 71, and it is the call every other site is being routed through.',
    ],
]);

/**
 * Blanks comments rather than deleting them, so BOTH line numbers and character
 * offsets survive. (The idempotency gate deletes line comments, which is fine
 * there because it only keys by line; here `index` feeds `enclosingSymbol`, so a
 * shifted offset would name the wrong symbol.) `useGuardedSubmit.ts`'s own
 * docblock writes `fetcher.submit()` twice and must not count.
 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

function countNewlines(s) {
    return (s.match(/\n/g) ?? []).length;
}

/** The banned call shape. See the docblock: shape, not name. */
const CALL_SHAPE = /\w*[Ff]etcher\.submit\s*\(/g;

/**
 * Every raw fetcher-submit call site in one source file.
 *
 * @param {string} source
 * @returns {{ line: number, index: number, ident: string, context: string }[]}
 *   `index` is a character offset into `source` (comments are blanked, not
 *   removed, so the offset is valid against the original text) and `context` is
 *   the trimmed source line.
 */
export function findSubmitCallSites(source) {
    const stripped = stripComments(source);
    const lines = source.split('\n');
    const out = [];
    for (const m of stripped.matchAll(CALL_SHAPE)) {
        const line = countNewlines(stripped.slice(0, m.index)) + 1;
        out.push({
            line,
            index: m.index,
            ident: m[0].slice(0, m[0].indexOf('.')),
            context: (lines[line - 1] ?? '').trim(),
        });
    }
    return out;
}

// ---------------------------------------------------------------------------
// RULE B — a `useGuardedSubmit` consumer that drops `busy`.
// ---------------------------------------------------------------------------

/**
 * A file is in scope iff it imports the IDENTIFIER `useGuardedSubmit`, not
 * merely the module path. `app/routes/inspections.tsx` imports
 * `IDEMPOTENCY_FIELD` from the same module and is an action-side consumer, not
 * a hook consumer.
 */
const IMPORTS_HOOK = /import\s*(?:type\s*)?\{[^}]*\buseGuardedSubmit\b[^}]*\}\s*from/;

/** `const { a, b: c } = useGuardedSubmit<T>(` — the destructuring to the call's left. */
const DESTRUCTURE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*useGuardedSubmit\s*(?:<[^>]*>)?\s*\(/g;

/**
 * `const install = useGuardedSubmit<T>(` — the WHOLE-OBJECT form.
 *
 * ⚠️ NOT a completeness nicety. `app/routes/settings-data.tsx` is written this
 * way today, so a rule that only reads destructuring patterns passes it
 * vacuously — the exact blindness this gate exists to stop. Here the pair to
 * check is `X.submit` against `X.busy`.
 */
const NAMESPACE = /(?:const|let|var)\s+(\w+)\s*=\s*useGuardedSubmit\s*(?:<[^>]*>)?\s*\(/g;

/** The escape hatch. The reason text after the colon must be non-empty. */
const ALLOW_NO_BUSY = /\/\/\s*submit-guard-allow-no-busy:\s*(\S.*)?$/;

export function isBusyRuleConsumer(source) {
    return IMPORTS_HOOK.test(stripComments(source));
}

/**
 * Consumers of `useGuardedSubmit` that bind `submit` without a usable `busy`.
 *
 * Two shapes, both invisible to `tsc` because the destructurings type-check
 * identically:
 *   1. `busy` is never bound at all;
 *   2. `busy` IS bound and its bound name appears exactly once in the file —
 *      the binding itself. `no-unused-vars` is only a `warn` here, so nothing
 *      else catches the half-converted state.
 *
 * @param {string} source
 * @returns {{ line: number, index: number, binding: string, reason: string }[]}
 */
export function findBusyViolations(source) {
    if (!isBusyRuleConsumer(source)) return [];
    const stripped = stripComments(source);
    const lines = source.split('\n');
    const out = [];
    for (const m of stripped.matchAll(DESTRUCTURE)) {
        const line = countNewlines(stripped.slice(0, m.index)) + 1;
        // The hatch may sit on the destructuring's own line or the one above it.
        const hatch = [lines[line - 2], lines[line - 1]]
            .map((l) => (l ?? '').match(ALLOW_NO_BUSY))
            .find(Boolean);
        if (hatch) {
            if (hatch[1] && hatch[1].trim()) continue;
            out.push({
                line,
                index: m.index,
                binding: m[1].trim(),
                reason:
                    'submit-guard-allow-no-busy carries no reason. A bare escape hatch is ' +
                    'indistinguishable from a forgotten one — say why this control needs no ' +
                    'pending affordance.',
            });
            continue;
        }

        /** bound name of each destructured property, honouring renames. */
        const bound = new Map();
        for (const part of m[1].split(',')) {
            const t = part.trim();
            if (!t) continue;
            const renamed = t.match(/^(\w+)\s*:\s*(\w+)$/);
            if (renamed) bound.set(renamed[1], renamed[2]);
            else if (/^\w+$/.test(t)) bound.set(t, t);
        }
        if (!bound.has('submit')) continue;

        const busyName = bound.get('busy');
        if (!busyName) {
            out.push({
                line,
                index: m.index,
                binding: bound.get('submit'),
                reason:
                    'submit is bound without busy. The guard contains the double click, but a ' +
                    'button with no pending affordance still looks live — thread busy into ' +
                    'disabled / aria-busy on the control this fires.',
            });
            continue;
        }
        const uses = (stripped.match(new RegExp(`\\b${busyName}\\b`, 'g')) ?? []).length;
        if (uses <= 1) {
            out.push({
                line,
                index: m.index,
                binding: busyName,
                reason:
                    `busy is bound as \`${busyName}\` and never referenced again — the same ` +
                    'half-converted state, and no-unused-vars is only a warn here.',
            });
        }
    }

    for (const m of stripped.matchAll(NAMESPACE)) {
        const name = m[1];
        if (!new RegExp(`\\b${name}\\.submit\\b`).test(stripped)) continue;
        if (new RegExp(`\\b${name}\\.busy\\b`).test(stripped)) continue;
        const line = countNewlines(stripped.slice(0, m.index)) + 1;
        const hatch = [lines[line - 2], lines[line - 1]]
            .map((l) => (l ?? '').match(ALLOW_NO_BUSY))
            .find(Boolean);
        if (hatch && hatch[1] && hatch[1].trim()) continue;
        out.push({
            line,
            index: m.index,
            binding: name,
            reason: hatch
                ? 'submit-guard-allow-no-busy carries no reason. A bare escape hatch is ' +
                  'indistinguishable from a forgotten one.'
                : `\`${name}.submit\` is called but \`${name}.busy\` is never read. The guard ` +
                  'contains the double click; the control still needs a pending affordance.',
        });
    }
    return out;
}

/**
 * The call text, from the identifier through its balanced closing paren, as one
 * whitespace-collapsed line.
 *
 * ⚠️ NOT the source line. Most sites in this tree wrap their arguments, so the
 * matched LINE is bare `fetcher.submit(` — identical for every wrapped call
 * inside the same function. Keying on that collapsed 156 real call sites into
 * 149 baseline keys, and a collapsed key is exactly the failure symbol-baseline
 * warns about: a NEW call added beside an already-frozen one inherits its key
 * and is never reported. Balancing forward to the closing paren gives each site
 * its own arguments, and therefore its own key.
 *
 * Bounded at 4000 characters — beyond that the expression is not a submit call
 * and the walk should stop rather than run to the end of the file.
 */
function callSignature(source, index) {
    const open = source.indexOf('(', index);
    if (open === -1) return normalizeSignature(source.slice(index, index + 120));
    let depth = 0;
    for (let i = open, end = Math.min(source.length, open + 4000); i < end; i++) {
        if (source[i] === '(') depth++;
        else if (source[i] === ')' && --depth === 0) return normalizeSignature(source.slice(index, i + 1));
    }
    return normalizeSignature(source.slice(index, index + 120));
}

/** Every `.ts`/`.tsx` under `dir`, recursively, skipping tests and generated trees. */
function walk(dir, acc) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return acc;
    }
    for (const entry of entries) {
        if (SKIP_DIR.has(entry.name)) continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p, acc);
        else if (EXT.test(entry.name) && !SKIP_FILE.test(entry.name)) acc.push(p);
    }
    return acc;
}

function main() {
    const update = process.argv.includes('--update');
    const files = [];
    for (const r of SCAN_ROOTS) walk(join(ROOT, r), files);

    let excluded = 0;
    let busyConsumers = 0;
    let rawSites = 0;
    /** baseline key -> "rel:line  context" */
    const hits = new Map();
    const busyViolations = [];
    for (const abs of files) {
        const rel = relative(ROOT, abs).split(sep).join('/');
        if (ALLOW.has(rel)) {
            excluded++;
            continue;
        }
        let src;
        try {
            src = readFileSync(abs, 'utf8');
        } catch {
            continue;
        }
        for (const hit of findSubmitCallSites(src)) {
            rawSites++;
            const base = makeKey(rel, enclosingSymbol(src, hit.index), callSignature(src, hit.index));
            // Two sites CAN be byte-identical inside one function — RequestDetail
            // fires the same `load-signers` submit from two effects, and
            // inspection-edit uploads through the same multipart call twice. An
            // ordinal keeps them distinct without reintroducing line numbers:
            // it moves only when one of the duplicates is added or removed,
            // which is precisely when the key SHOULD move.
            let key = base;
            for (let n = 2; hits.has(key); n++) key = `${base} #${n}`;
            hits.set(key, `${rel}:${hit.line}  ${hit.context}`);
        }
        if (!isBusyRuleConsumer(src)) continue;
        busyConsumers++;
        for (const v of findBusyViolations(src)) {
            busyViolations.push(`${rel}:${v.line}  { ${v.binding} }\n      ${v.reason}`);
        }
    }

    const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};
    const scannedCount = files.length - excluded;
    const result = evaluate({ hits, baseline, scannedCount, busyConsumers, busyViolations, rawSites });

    // Printed on EVERY run, pass or fail. A gate that only reports its verdict
    // cannot be checked on the day it is green.
    const baselineKeys = Object.keys(baseline);
    const awaiting = baselineKeys.filter((k) => CONVERSION_DEBT.test(baseline[k] ?? '')).length;
    console.log(
        `[submit-guard] scanned ${scannedCount} files (${excluded} excluded), ` +
        `${rawSites} call sites (${hits.size} baseline keys), ${baselineKeys.length} baselined ` +
        `(${baselineKeys.length - awaiting} exempt, ${awaiting} awaiting conversion), ` +
        `${result.violations.length} new`
    );
    console.log(`[submit-guard] busy rule: ${busyConsumers} consumer files checked, ${busyViolations.length} violations`);

    if (update) return runUpdate(hits, baseline);

    for (const failure of result.failures) console.error(`[submit-guard] FAIL — ${failure}`);

    if (busyViolations.length > 0) {
        console.error(`[submit-guard] FAIL — ${busyViolations.length} useGuardedSubmit consumer(s) drop \`busy\`:`);
        for (const v of busyViolations) console.error(`  x ${v}`);
        console.error('');
        console.error('WizardLayout (app/components/new-inspection/WizardLayout.tsx:111,112,120) is the');
        console.error('reference implementation: disabled={busy}, aria-busy={busy || undefined}, and the');
        console.error('spinner branch. Rule B has NO baseline — if a control genuinely needs no pending');
        console.error('affordance, write `// submit-guard-allow-no-busy: <reason>` above the destructuring.');
    }

    if (result.stale.length > 0) {
        console.warn(`[submit-guard] ${result.stale.length} stale baseline entr(ies) — no longer hit (not a failure):`);
        for (const key of result.stale) console.warn(`  - ${key}`);
    }

    if (result.reasonless.length > 0) {
        console.error('[submit-guard] FAIL — baseline entries with no written reason:');
        for (const key of result.reasonless) console.error(`  x ${key}`);
        console.error('  A bare entry is indistinguishable from a forgotten one. Say WHY this call');
        console.error('  is not a user mutation: the intent it carries, or the effect that drives it.');
    }

    if (result.violations.length > 0) {
        console.error(`[submit-guard] FAIL — ${result.violations.length} raw fetcher.submit call site(s) outside the hook:`);
        for (const key of result.violations) {
            console.error(`  x ${hits.get(key)}`);
            console.error(`      ${key}`);
        }
        console.error('');
        console.error('Route the call through useGuardedSubmit (app/hooks/useGuardedSubmit.ts) and');
        console.error('thread its `busy` into the control it fires. If this call is genuinely not a');
        console.error('user mutation, run --update and write the reason into');
        console.error(`${BASELINE_PATH}.`);
    }

    process.exit(result.ok ? 0 : 1);
}

/**
 * Rewrite the baseline: keep every reason already written, drop keys no longer
 * hit, seed new keys with an EMPTY reason — and then exit 1, printing them, so
 * a bare entry can never be landed by running --update and committing.
 */
function runUpdate(hits, baseline) {
    const next = {};
    const fresh = [];
    for (const key of [...hits.keys()].sort()) {
        const reason = baseline[key];
        if (typeof reason === 'string' && reason.trim()) next[key] = reason;
        else {
            next[key] = '';
            fresh.push(key);
        }
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 4) + '\n', 'utf8');
    console.log(`[submit-guard] wrote ${Object.keys(next).length} entries to ${BASELINE_PATH}`);
    if (fresh.length === 0) {
        console.log('[submit-guard] every entry carries a reason.');
        process.exit(0);
    }
    console.error(`[submit-guard] ${fresh.length} entr(ies) need a written reason before this gate can pass:`);
    for (const key of fresh) console.error(`  ? ${key}\n      ${hits.get(key)}`);
    console.error('');
    console.error('Open each site, decide whether it is a user-initiated mutation (convert it) or');
    console.error('not (keep it here), and write the reason AS YOU DECIDE. A reason written later');
    console.error('is a reconstruction.');
    process.exit(1);
}

/**
 * The verdict, as a pure function so it can be tested without a file tree.
 *
 * @param {{ hits: Map<string,string>, baseline: Record<string,string>, scannedCount: number, minFiles?: number }} input
 * @returns {{ ok: boolean, violations: string[], stale: string[], reasonless: string[], failures: string[] }}
 */
export function evaluate({
    hits,
    baseline,
    scannedCount,
    minFiles = MIN_FILES,
    busyConsumers = 0,
    busyViolations = [],
    rawSites = null,
}) {
    const failures = [];
    // A key that two different call sites share is a hole, not a tidy number:
    // the second site inherits the first's baseline entry and is never reported.
    if (rawSites !== null && rawSites !== hits.size) {
        failures.push(
            `${rawSites} call sites collapsed into ${hits.size} baseline keys. Two sites sharing ` +
            'one key means the second inherits the first\'s exemption and is never reported. ' +
            'Widen callSignature() until every site is distinct.'
        );
    }
    if (scannedCount < minFiles) {
        failures.push(
            `scanned only ${scannedCount} files under ${SCAN_ROOTS.join(', ')}; that is too few to be ` +
            'this application, so the gate is looking at the wrong tree. ' +
            'Refusing to report success on a scan that examined nothing.'
        );
    }
    if (hits.size === 0) {
        failures.push(
            'found ZERO fetcher.submit call sites. The baseline is non-empty by construction, so ' +
            'either the detector broke or the walk saw nothing. ' +
            'Refusing to report success on a scan that examined nothing.'
        );
    }
    // Rule B's own fail-closed floor. Zero consumers means the hook was renamed
    // or moved and the rule is scanning nothing — which reads exactly like a
    // clean tree.
    if (busyConsumers === 0) {
        failures.push(
            'the busy rule checked ZERO useGuardedSubmit consumer files. The hook was renamed, ' +
            'moved, or is imported under another name, so rule B is scanning nothing. ' +
            'Refusing to report success on a scan that examined nothing.'
        );
    }
    const { violations, stale } = diffBaseline(hits, new Set(Object.keys(baseline)));
    const reasonless = Object.keys(baseline)
        .filter((k) => !String(baseline[k] ?? '').trim())
        .sort();
    return {
        ok:
            failures.length === 0 &&
            violations.length === 0 &&
            reasonless.length === 0 &&
            busyViolations.length === 0,
        violations,
        stale,
        reasonless,
        failures,
    };
}

// Run only when invoked directly (the gate is also imported by run-gates.mjs and
// by its spec). The Windows drive letter is normalized, as check-tenant-scoping
// does.
const invokedDirectly =
    process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase();
if (invokedDirectly) main();
