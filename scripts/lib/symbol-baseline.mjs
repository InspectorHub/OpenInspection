/**
 * Shared symbol-keyed baseline helpers for anti-drift gates.
 *
 * Both the tenant-scoping gate and the status-literal gate freeze the current
 * set of hits and fail only on NEW ones. The baseline key decides how a hit is
 * identified across edits:
 *
 *   `relpath::symbol::signature`
 *
 * - `symbol` is the nearest enclosing named declaration (function / const /
 *   class / method), so a hit is anchored to WHERE it lives, not to a line
 *   number. Inserting or deleting an unrelated line above the hit does not
 *   renumber it, so the baseline stays green (the pain the older line-keyed
 *   baseline caused — every edit above a frozen line forced a mass --update
 *   that masked real new hits).
 * - `signature` is a normalized snippet of the matched code, so two distinct
 *   hits inside the same function stay distinct keys. A NEW hit added to an
 *   already-baselined function is therefore still caught — symbol-only keys
 *   would collapse them and silently let it through.
 *
 * console.* is intentional — these are build scripts, not server code (the
 * no-console rule is server-only).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'do', 'else', 'typeof',
    'await', 'new', 'function', 'const', 'let', 'var', 'class', 'throw', 'try',
    'yield', 'delete', 'void', 'in', 'of', 'case', 'break', 'continue',
]);

// Declarations that name a scope the hit lives INSIDE (function / class), valid
// on any preceding line including the hit's own.
const SCOPE_PATTERNS = [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+(\w+)/,
    /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/,
];

// A variable declaration that OPENS a function scope — an arrow body
// (`const foo = () => {`) or a function expression (`const foo = function`).
// Only these name a scope the hit lives inside. A plain local like
// `const x = 5` is NOT a scope: anchoring to it would drift when the local is
// renamed, so it is skipped and the walk continues to the real function/method.
const SCOPE_VAR_PATTERN =
    /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|\w+)\s*=>)/;

// A class method signature line: indented, optional modifiers, `name(...)`,
// optional return type, ending with `{`. Requiring the trailing `{` avoids
// matching ordinary call expressions like `this.foo(...)`.
const METHOD_PATTERN =
    /^\s{2,}(?:(?:public|private|protected|static|readonly|async|get|set|override|\*)\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[^={;]+)?\{\s*$/;

// The SAME declaration when its parameter list WRAPS — the line ends at the
// open paren and the params live below.
//
// ⚠️ THIS IS NOT A COMPLETENESS NICETY. Without it the backward walk sails past
// the declaration and names the PREVIOUS method, so a hit keeps its position
// but changes its baseline key — and a key that moved is reported as a NEW
// violation. Merely widening a return type until Prettier wraps the signature
// is therefore enough to fail this gate, pointing at a method that contains no
// query at all. That happened: `ai.service.ts::generateInspectionSummary` grew
// `Promise<{ summary: string; aiCallId: string | null }>`, wrapped, and its
// unscoped select was re-reported under `generateProfessionalComment`.
//
// The whole point of the symbol scheme over line numbers is that unrelated
// edits must not move a key. A formatting-sensitive resolver gives that up
// quietly, in the direction of false alarms — which is the direction that
// teaches people to run `--update` without reading.
//
// ⚠️ THE LINE SHAPE ALONE IS NOT ENOUGH, and assuming it was made this worse
// before it made it better. `and(` / `or(` on their own line — drizzle
// predicates with wrapped arguments — match this pattern perfectly, so a
// regex-only version renamed a dozen baseline keys to `::and::` and `::or::`.
// Every candidate is therefore confirmed by `opensMethodBody`, which reads
// forward to the matching `)` and requires a `{` after it. A call closes with
// `)`, `),` or `);` and is rejected there.
const METHOD_OPEN_PATTERN =
    /^\s{2,}(?:(?:public|private|protected|static|readonly|async|get|set|override|\*)\s+)*(\w+)\s*\(\s*$/;

/**
 * Confirms the wrapped parameter list opening at `lines[i]` belongs to a
 * DECLARATION: balance parens forward and require the closing line to end in
 * `{`. A call closes with `)`, `),` or `);` and is rejected.
 *
 * ⚠️ THE TEST IS "ENDS WITH `{`", NOT A RETURN-TYPE PATTERN. The obvious
 * `(?::\s*[^={;]+)?\{$` refuses a `{` inside the return type — and this
 * codebase returns inline object types constantly
 * (`): Promise<{ annotatedKey: string }> {`), so that version rejected real
 * signatures and the walk fell back to naming the `constructor`. Keywords are
 * filtered by the caller, which is what keeps `if (`/`for (`/`while (` from
 * matching here; nothing else at this indent both wraps and ends in `{`.
 *
 * Only ever called for lines before the hit, so the closing paren is always
 * inside the slice. Bounded at 40 lines — beyond that it is not a signature.
 */
function opensMethodBody(lines, i) {
    let depth = 0;
    for (let j = i; j < lines.length && j < i + 40; j++) {
        const line = lines[j];
        for (let k = 0; k < line.length; k++) {
            if (line[k] === '(') depth++;
            else if (line[k] === ')' && --depth === 0) {
                return line.slice(k + 1).trimEnd().endsWith('{');
            }
        }
    }
    return false;
}

/**
 * Returns the name of the nearest declaration at or before `index`, or
 * `<module>` if the hit precedes any declaration. Deterministic and
 * position-relative (line insertions elsewhere never change the answer for a
 * given hit).
 *
 * @param {string} source
 * @param {number} index - character offset of the hit within `source`
 * @returns {string}
 */
export function enclosingSymbol(source, index) {
    const before = source.slice(0, index);
    const lines = before.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const isHitLine = i === lines.length - 1;
        for (const re of SCOPE_PATTERNS) {
            const m = line.match(re);
            if (m) return m[1];
        }
        if (!isHitLine) {
            const v = line.match(SCOPE_VAR_PATTERN);
            if (v) return v[1];
        }
        const mm = line.match(METHOD_PATTERN);
        if (mm && !KEYWORDS.has(mm[1])) return mm[1];
        const mo = line.match(METHOD_OPEN_PATTERN);
        if (mo && !KEYWORDS.has(mo[1]) && opensMethodBody(lines, i)) return mo[1];
    }
    return '<module>';
}

/** Collapses runs of whitespace, trims, and caps length so the key is compact. */
export function normalizeSignature(text) {
    return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Composes the drift-immune baseline key. */
export function makeKey(relpath, symbol, signature) {
    return `${relpath}::${symbol}::${signature}`;
}

/**
 * Splits current hits against a frozen baseline.
 *
 * @param {Map<string, string>} current - key -> context
 * @param {Set<string>} baseline
 * @returns {{ violations: string[], stale: string[] }}
 *   violations: current keys not in the baseline (sorted) — a gate failure.
 *   stale: baseline keys no longer hit (sorted) — informational only.
 */
export function diffBaseline(current, baseline) {
    const violations = [];
    for (const key of current.keys()) {
        if (!baseline.has(key)) violations.push(key);
    }
    const stale = [];
    for (const key of baseline) {
        if (!current.has(key)) stale.push(key);
    }
    violations.sort();
    stale.sort();
    return { violations, stale };
}

/** Reads a baseline JSON array into a Set (empty if the file is absent). */
export function loadBaseline(path) {
    return new Set(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []);
}

/** Writes a sorted baseline JSON array. */
export function writeBaseline(path, keys) {
    const sorted = [...keys].sort();
    writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n');
    return sorted.length;
}
