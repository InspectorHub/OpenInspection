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
 * ⚠️ THAT PARAGRAPH WAS HALF TRUE, AND THE HALF THAT WAS NOT COST FIVE SITES.
 * `\w*[Ff]etcher\.submit` covers 53 identifiers, and every one of them ENDS IN
 * "fetcher" — so it is still a name rule, just a generous one. A fetcher called
 * `write`, `send` or `resend` was invisible: not reported, not baselined, not
 * counted in the awaiting ceiling, and therefore not even visible as debt.
 * `findSubmitCallSites` now runs a SECOND pass over the names each file
 * DECLARES with `useFetcher` (see FETCHER_DECL), which is what the source
 * actually says a fetcher is. Five real call sites arrived that way the day it
 * landed, across StaffNoticeBell, CommunicationSection and messages.tsx.
 *
 * KNOWN, WRITTEN-DOWN HOLE: a call split across lines (`fetcher\n  .submit(`)
 * does not match. No site in the tree is written that way today, and widening
 * the regex across newlines makes it match unrelated member chains.
 *
 * SECOND KNOWN HOLE: a fetcher obtained without a `const x = useFetcher()`
 * declaration — destructured, returned from a helper hook, or handed in as a
 * prop under a name that does not say fetcher — is still invisible to both
 * passes. No site in the tree is written that way today.
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
 * RULE C — the AWAITING ratchet (see evaluateAwaitingRatchet). The baseline's
 * two populations are not equal: an EXEMPT entry is a decision, an AWAITING one
 * is a debt. The key ratchet above stops a raw submit arriving SILENTLY, and
 * nothing else — "new" means "not in the baseline", and the baseline is written
 * by a flag, so the honest way to add debt was always `--update` plus an
 * AWAITING reason — and the awaiting count went UP over the gate's first months
 * while every run reported `0 new`. Rule C freezes the awaiting TOTAL in
 * `submit-guard-awaiting-ceiling.json` and fails when it moves in either
 * direction: upward is new debt, downward is a ceiling that has gone slack and
 * is holding free slots open for it. `--update` may only ever LOWER the
 * ceiling, so a new AWAITING entry cannot be laundered by re-running the flag —
 * raising it takes a hand edit of a committed file, which is a diff that says
 * "I am adding debt" out loud.
 *
 * The ceiling is stored PER FILE, and the per-file numbers are diagnosis, not
 * enforcement: the verdict is on the total (so moving a component between files
 * is not a false alarm), while the message NAMES the files that went over or
 * under (so a failure points somewhere rather than reporting an integer).
 *
 * Usage:
 *   node scripts/check-submit-guard.mjs            # verify (exit 1 on a new hit)
 *   node scripts/check-submit-guard.mjs --update   # rewrite the baseline and
 *                                                  # TIGHTEN the awaiting ceiling,
 *                                                  # then exit 1 until every new
 *                                                  # entry carries a written reason
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enclosingSymbol, normalizeSignature, makeKey, diffBaseline } from './lib/symbol-baseline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASELINE_PATH = join(__dirname, 'submit-guard-baseline.json');
/**
 * The frozen awaiting count, per file. Committed, and seeded BY HAND — there is
 * deliberately no `--seed` flag, because every automatic path that can create
 * this file is also a path that can reset it, and a ratchet you can reset by
 * running a command is not a ratchet.
 */
const AWAITING_CEILING_PATH = join(__dirname, 'submit-guard-awaiting-ceiling.json');

/**
 * ⚠️ THE CEILING IS NOW `{}` — ZERO, AND THAT WAS A HAND EDIT. The burn-down
 * finished: all 94 AWAITING entries were converted, and the 51 that remain are
 * exemptions with written reasons. `--update` REFUSED to write the zero (see
 * updateCeiling: a zero written from a marker that may simply have stopped
 * matching would retire the ratchet by accident), which is the correct refusal
 * and the reason this is a hand edit rather than a flag.
 *
 * What that costs, said out loud: the `awaitingTotal === 0 && ceilingTotal > 0`
 * detector-broke branch below can no longer fire, because both numbers are now
 * zero. The marker's own liveness is instead pinned in
 * tests/unit/platform/check-submit-guard.spec.ts, where `awaitingByFile` is
 * handed a genuine `AWAITING #106 CONVERSION` reason and must count it — a
 * positive control that does not depend on any debt still existing in the tree.
 *
 * What it buys: the ratchet is now at its strictest. Any new AWAITING entry is
 * `1 > 0` and fails on the spot, so debt can only be added by hand-raising this
 * file again — a diff that says "I am adding debt" out loud.
 */

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

/**
 * Source split into lines with no carriage return left on the end.
 *
 * ⚠️ NOT tidiness. `ALLOW_NO_BUSY` ends in `$`, and in JavaScript `.` does not
 * match `\r` — so on a worktree checked out with CRLF (`core.autocrlf=true`,
 * the default on Windows) the escape hatch never matched and the gate reported
 * a violation against a file that carries one. Same bytes in git, opposite
 * answers on two machines: a gate whose verdict depends on how the file was
 * checked out is not reporting on the file.
 *
 * Line NUMBERS are still counted against the unsplit source, so they stay
 * valid for both line endings.
 */
function splitLines(source) {
    return source.split(/\r?\n/);
}

/** The banned call shape. See the docblock: shape, not name. */
const CALL_SHAPE = /\w*[Ff]etcher\.submit\s*\(/g;

/**
 * `const write = useFetcher<T>()` — a fetcher whose NAME does not say fetcher.
 *
 * ⚠️ THE SHAPE RULE ABOVE IS STILL A NAME RULE, and this closes it. The docblock
 * at the top of this file argues the regex is name-independent because it covers
 * 53 distinct identifiers — but every one of those 53 ENDS IN "fetcher", so the
 * rule is `*fetcher.submit(` and nothing else. A fetcher called `write`, `send`,
 * `resend` or `payload` was invisible to it: not reported, not baselined, not
 * counted in the awaiting ceiling. Measured the day this was added: FIVE such
 * call sites across three files (`StaffNoticeBell`'s `write`,
 * `CommunicationSection`'s `send` and `resend`, `messages.tsx`'s `send`), none
 * of which the gate had ever seen.
 *
 * The fix is NOT a wider member expression. `\w+\.submit\s*\(` would match
 * `form.submit()`, `element.submit()` and every unrelated `.submit` in the tree,
 * which trades one blind spot for a flood of false hits. It is to read the
 * file's own `useFetcher` DECLARATIONS and treat those names as fetchers —
 * which is what the source itself says they are.
 */
const FETCHER_DECL = /(?:const|let|var)\s+(\w+)\s*=\s*useFetcher\b/g;

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
    const lines = splitLines(source);
    /** char offset -> hit, so the two passes can never report one call twice. */
    const byIndex = new Map();
    const record = (index) => {
        if (byIndex.has(index)) return;
        const line = countNewlines(stripped.slice(0, index)) + 1;
        const head = stripped.slice(index, stripped.indexOf('(', index) + 1);
        byIndex.set(index, {
            line,
            index,
            ident: head.slice(0, head.indexOf('.')),
            context: (lines[line - 1] ?? '').trim(),
        });
    };

    for (const m of stripped.matchAll(CALL_SHAPE)) record(m.index);

    // Second pass: the names this file DECLARES as fetchers. Only names the
    // first pass cannot already see, so nothing is counted twice and the total
    // does not move when a fetcher is renamed into or out of the `*Fetcher`
    // convention.
    const declared = new Set();
    for (const m of stripped.matchAll(FETCHER_DECL)) {
        if (!/[Ff]etcher/.test(m[1])) declared.add(m[1]);
    }
    for (const name of declared) {
        for (const m of stripped.matchAll(new RegExp(`\\b${name}\\.submit\\s*\\(`, 'g'))) {
            record(m.index);
        }
    }

    return [...byIndex.values()].sort((a, b) => a.index - b.index);
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
    const lines = splitLines(source);
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

// ---------------------------------------------------------------------------
// RULE C — the AWAITING ratchet.
// ---------------------------------------------------------------------------

/**
 * The declared conversion debt, counted per source file.
 *
 * Read from the BASELINE, not from the hits: converting a call site leaves its
 * baseline entry behind as a stale key until someone runs `--update`, and the
 * debt is what the file DECLARES. Counting hits instead would make every
 * conversion red until the flag was run, which is the friction that teaches
 * people to run `--update` without reading it.
 *
 * @param {Record<string,string>} baseline
 * @returns {Map<string, number>} relpath -> awaiting entries in that file
 */
export function awaitingByFile(baseline) {
    const out = new Map();
    for (const [key, reason] of Object.entries(baseline)) {
        if (!CONVERSION_DEBT.test(String(reason ?? ''))) continue;
        const file = key.split('::')[0];
        out.set(file, (out.get(file) ?? 0) + 1);
    }
    return out;
}

function sum(values) {
    let t = 0;
    for (const v of values) t += v;
    return t;
}

/**
 * The ratchet's verdict, as a pure function.
 *
 * @param {{ awaiting: Map<string,number>, ceiling: Record<string,number> | null }} input
 *   `ceiling` is null when the file is missing or unparseable — which is a
 *   FAILURE, never "nothing to check". A gate that cannot read its own frozen
 *   copy knows nothing, and knowing nothing must not read as green.
 * @returns {{ ok: boolean, awaitingTotal: number, ceilingTotal: number,
 *             over: string[], under: string[], failures: string[] }}
 */
export function evaluateAwaitingRatchet({ awaiting, ceiling }) {
    const failures = [];
    const awaitingTotal = sum(awaiting.values());
    if (ceiling === null || typeof ceiling !== 'object' || Array.isArray(ceiling)) {
        return {
            ok: false,
            awaitingTotal,
            ceilingTotal: 0,
            over: [],
            under: [],
            failures: [
                `the awaiting ceiling at ${AWAITING_CEILING_PATH} is missing or is not a JSON object. ` +
                'It is committed and seeded by hand; restore it from git rather than regenerating it, ' +
                'because a regenerated ceiling freezes whatever debt happens to be there today. ' +
                'Refusing to report success on a ratchet whose frozen copy could not be read.',
            ],
        };
    }

    const bad = Object.entries(ceiling).filter(
        ([, n]) => !Number.isInteger(n) || n < 0,
    );
    if (bad.length > 0) {
        failures.push(
            'the awaiting ceiling holds values that are not non-negative integers: ' +
            bad.map(([f, n]) => `${f} = ${JSON.stringify(n)}`).join(', ') +
            '. An unreadable entry is a failure, not a zero.',
        );
    }

    const ceilingTotal = sum(Object.values(ceiling).filter((n) => Number.isInteger(n) && n >= 0));
    const files = [...new Set([...awaiting.keys(), ...Object.keys(ceiling)])].sort();
    const over = files.filter((f) => (awaiting.get(f) ?? 0) > (ceiling[f] ?? 0));
    const under = files.filter((f) => (awaiting.get(f) ?? 0) < (ceiling[f] ?? 0));

    // The detector-broke check, and the reason it is not folded into the
    // `under` branch: a marker that stops matching reads as a completed
    // burn-down, and "the debt is gone" is the single most attractive wrong
    // answer this gate can give.
    if (awaitingTotal === 0 && ceilingTotal > 0) {
        failures.push(
            `the AWAITING marker matched ZERO baseline entries while the ceiling still holds ${ceilingTotal}. ` +
            'Either every site was converted — in which case delete this ratchet by hand, deliberately — ' +
            `or the marker text (${CONVERSION_DEBT.source}) no longer matches what the baseline says. ` +
            'Refusing to read an empty result as a finished burn-down.',
        );
    } else if (awaitingTotal > ceilingTotal) {
        failures.push(
            `the conversion backlog GREW: ${awaitingTotal} awaiting against a ceiling of ${ceilingTotal}. ` +
            'A new baseline entry may be exempt with a stated reason; it may not be AWAITING. ' +
            `Over their frozen count: ${over.map((f) => `${f} (${awaiting.get(f) ?? 0} > ${ceiling[f] ?? 0})`).join(', ')}.`,
        );
    } else if (awaitingTotal < ceilingTotal) {
        failures.push(
            `the awaiting ceiling has gone slack: ${awaitingTotal} awaiting against a ceiling of ${ceilingTotal}, ` +
            `so ${ceilingTotal - awaitingTotal} free slot(s) are being held open for new debt. ` +
            'Run `npm run lint:submit-guard -- --update` to tighten it. Below their frozen count: ' +
            `${under.map((f) => `${f} (${awaiting.get(f) ?? 0} < ${ceiling[f] ?? 0})`).join(', ')}.`,
        );
    }

    return { ok: failures.length === 0, awaitingTotal, ceilingTotal, over, under, failures };
}

/** The frozen ceiling, or null when it cannot be read or parsed. */
function readCeiling() {
    try {
        const parsed = JSON.parse(readFileSync(AWAITING_CEILING_PATH, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
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

    const awaitingFiles = awaitingByFile(baseline);
    const ceiling = readCeiling();
    const ratchet = evaluateAwaitingRatchet({ awaiting: awaitingFiles, ceiling });

    // Printed on EVERY run, pass or fail. A gate that only reports its verdict
    // cannot be checked on the day it is green.
    const baselineKeys = Object.keys(baseline);
    const awaiting = ratchet.awaitingTotal;
    console.log(
        `[submit-guard] scanned ${scannedCount} files (${excluded} excluded), ` +
        `${rawSites} call sites (${hits.size} baseline keys), ${baselineKeys.length} baselined ` +
        `(${baselineKeys.length - awaiting} exempt, ${awaiting} awaiting conversion), ` +
        `${result.violations.length} new`
    );
    console.log(`[submit-guard] busy rule: ${busyConsumers} consumer files checked, ${busyViolations.length} violations`);
    console.log(
        `[submit-guard] awaiting ratchet: ${awaiting} awaiting across ${awaitingFiles.size} file(s), ` +
        `ceiling ${ratchet.ceilingTotal} across ${ceiling === null ? 'UNREADABLE' : Object.keys(ceiling).length} file(s) ` +
        `(${ratchet.over.length} over, ${ratchet.under.length} under)`
    );

    if (update) return runUpdate(hits, baseline, ceiling);

    for (const failure of [...result.failures, ...ratchet.failures]) {
        console.error(`[submit-guard] FAIL — ${failure}`);
    }

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

    process.exit(result.ok && ratchet.ok ? 0 : 1);
}

/**
 * Rewrite the baseline: keep every reason already written, drop keys no longer
 * hit, seed new keys with an EMPTY reason — and then exit 1, printing them, so
 * a bare entry can never be landed by running --update and committing.
 *
 * Then TIGHTEN the awaiting ceiling, and only tighten it. `--update` is the one
 * automatic writer of that file, so if it could also raise the number, the
 * whole ratchet would be one command away from being undone: add a raw submit,
 * run `--update`, write `AWAITING #106 CONVERSION` into the fresh entry, run
 * `--update` again, and the debt is frozen at its new, larger size with nothing
 * in the diff that reads as a decision. It refuses instead, and names the files.
 */
function runUpdate(hits, baseline, ceiling) {
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

    const tightened = updateCeiling(next, ceiling);
    if (!tightened) {
        process.exit(1);
    }
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
 * Rewrite the awaiting ceiling from the freshly written baseline — downward
 * only. Returns false (having printed why) when the write is refused.
 *
 * @param {Record<string,string>} nextBaseline the baseline just written
 * @param {Record<string,number> | null} ceiling the frozen copy as read
 */
function updateCeiling(nextBaseline, ceiling) {
    const awaiting = awaitingByFile(nextBaseline);
    const verdict = evaluateAwaitingRatchet({ awaiting, ceiling });

    if (ceiling === null) {
        console.error(`[submit-guard] FAIL — ${verdict.failures[0]}`);
        return false;
    }
    if (verdict.awaitingTotal > verdict.ceilingTotal) {
        console.error(
            `[submit-guard] FAIL — refusing to RAISE the awaiting ceiling from ${verdict.ceilingTotal} ` +
            `to ${verdict.awaitingTotal}. This flag tightens the ratchet; it does not loosen it. ` +
            `Over their frozen count: ${verdict.over.map((f) => `${f} (${awaiting.get(f) ?? 0} > ${ceiling[f] ?? 0})`).join(', ')}.`
        );
        console.error('  Convert the site instead, or mark it exempt with a reason that says why it is');
        console.error(`  not a user mutation. If the debt genuinely must grow, edit ${AWAITING_CEILING_PATH}`);
        console.error('  by hand — that diff is the decision, and it should be argued for in review.');
        return false;
    }
    if (verdict.awaitingTotal === 0 && verdict.ceilingTotal > 0) {
        console.error(`[submit-guard] FAIL — ${verdict.failures[0]}`);
        console.error('  Not written: a ceiling of 0 written from a marker that may simply have stopped');
        console.error('  matching would freeze "no debt" as the truth and retire the ratchet by accident.');
        return false;
    }

    const nextCeiling = {};
    for (const file of [...awaiting.keys()].sort()) nextCeiling[file] = awaiting.get(file);
    writeFileSync(AWAITING_CEILING_PATH, JSON.stringify(nextCeiling, null, 4) + '\n', 'utf8');
    console.log(
        `[submit-guard] awaiting ceiling ${verdict.ceilingTotal} -> ${verdict.awaitingTotal} ` +
        `across ${Object.keys(nextCeiling).length} file(s) in ${AWAITING_CEILING_PATH}`
    );
    return true;
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
