/**
 * Two source files whose paths differ ONLY by extension: one of them is invisible
 * to TypeScript.
 *
 * ── The mechanism ──
 * A tsconfig `include` glob does not name extensions. TypeScript expands the
 * directory and then keeps ONE file per base path, in a fixed extension priority
 * (`.ts` > `.tsx` > `.d.ts`). So when `foo.test.ts` and `foo.test.tsx` sit side by
 * side, the `.tsx` is dropped from the program — silently, with no diagnostic
 * anywhere, because from tsc's point of view nothing is wrong: it found a file for
 * that base path.
 *
 * ── Why this needs a gate and not a code review ──
 * Every other signal says the file is fine. It is tracked in git. vitest globs by
 * filename and collects it. Its tests run and pass, so coverage counts it. The one
 * and only thing that never happens is type-checking, and nothing announces the
 * absence of an error.
 *
 * Demonstrated on 2026-08-10, in `app/routes/public/`, with a deliberate
 * `const x: number = "string"` in the SAME file under two names:
 *
 *     portal-auth.redeem-destination.test.ts   →  TS2322, tsc exits 1
 *     portal-auth.test.tsx (colliding twin)    →  tsc exits 0, error not reported
 *
 * That file had been unchecked since it was written. `check-tests-tsconfig.mjs`
 * cannot see this class: that gate compares a DECLARED `exclude` array, and a
 * collided file is excluded by nothing — it loses a tiebreak.
 *
 * ── Fix, when this fires ──
 * Rename one of the two after what it actually covers. Do NOT "fix" it by adding
 * the file to an `include` list: the tiebreak happens during expansion, so an
 * explicit entry is the only thing that would work, and the next file to collide
 * would not have one.
 *
 * `.d.ts` participates in the same tiebreak and is scanned for the same reason.
 * Generated declaration output (`.types/`) is not scanned — it is gitignored,
 * regenerated, and its `.d.ts`/`.ts` pairing is the intended shape.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

/** Source trees that any tsconfig in this repo expands with a wildcard include. */
const ROOTS = ['app', 'server', 'workers', 'packages', 'tests', 'scripts'];
const SKIP_DIRS = new Set([
    'node_modules', 'build', 'dist', 'dist-check', '.types', '.react-router',
    '.wrangler', '.worktrees', 'paraglide',
]);

/** TypeScript's own tiebreak order — the winner is whichever appears first. */
const PRIORITY = ['.ts', '.tsx', '.d.ts'];

/** Split a filename into [basePath, extension] using PRIORITY, longest first. */
function splitExt(path) {
    // `.d.ts` must be tested before `.ts`, or `foo.d.ts` reads as base `foo.d`.
    for (const ext of ['.d.ts', '.tsx', '.ts']) {
        if (path.endsWith(ext)) return [path.slice(0, -ext.length), ext];
    }
    return null;
}

const byBase = new Map();
let scanned = 0;

function walk(dir) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
        // Fail closed: a directory we cannot read is not a directory we can clear.
        console.error(`extension-collisions: cannot read ${relative(root, dir)} — ${err.message}`);
        process.exit(1);
    }
    for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            walk(full);
            continue;
        }
        const split = splitExt(e.name);
        if (!split) continue;
        scanned++;
        const [base, ext] = split;
        const key = join(relative(root, dir), base).replace(/\\/g, '/');
        if (!byBase.has(key)) byBase.set(key, []);
        byBase.get(key).push(ext);
    }
}

for (const r of ROOTS) {
    const p = join(root, r);
    if (existsSync(p) && statSync(p).isDirectory()) walk(p);
}

// A gate that scanned nothing would pass forever. It has no business being green
// when it cannot see the thing it claims to check.
if (scanned === 0) {
    console.error(
        'extension-collisions: scanned 0 TypeScript files — the roots are wrong or ' +
        'the walk is broken. Refusing to report OK.',
    );
    process.exit(1);
}

const collisions = [];
for (const [base, exts] of byBase) {
    if (exts.length < 2) continue;
    const ordered = PRIORITY.filter((e) => exts.includes(e));
    const [winner, ...losers] = ordered;
    collisions.push(
        `${base}${losers.join('/')} — dropped from every TS program; ` +
        `'${base}${winner}' wins the extension tiebreak. Rename one after what it covers.`,
    );
}

// Both numbers, side by side, every run: a bare "OK" cannot be audited on the day
// it is wrong, and "0 collisions" means nothing without "out of how many".
console.log(
    `extension-collisions: ${collisions.length} collision(s) across ${scanned} TypeScript files ` +
    `in ${ROOTS.join(', ')}`,
);

if (collisions.length) {
    console.error('Files invisible to tsc:\n  ' + collisions.join('\n  '));
    process.exit(1);
}
