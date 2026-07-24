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
