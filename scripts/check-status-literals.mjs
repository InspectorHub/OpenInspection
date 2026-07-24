#!/usr/bin/env node
/**
 * Status-literal anti-drift gate — baseline-ratchet model.
 *
 * The inspection and report lifecycles each declare a single source of truth
 * (`server/lib/status/{inspection,report}-status.ts`): a frozen member list plus
 * `INSPECTION_STATUS.*` / `REPORT_STATUS.*` constants. Both files require every
 * consumer to derive from those constants — "no bare status string literals".
 * Nothing enforced that discipline, so member values were typed by hand in
 * several places; a hand-typed value is exactly how a ghost value like the
 * never-defined `'delivered'` slips in at runtime while the type layer, bypassed
 * by the literal, stays silent.
 *
 * This gate makes the discipline executable. It flags a member value written as
 * a BARE literal directly bound to a status key — an assignment
 * (`status: 'completed'`, `.set({ status: 'confirmed' })`) or a comparison
 * (`status === 'completed'`, `reportStatus === 'published'`). Using the derived
 * constant (`INSPECTION_STATUS.COMPLETED`) passes.
 *
 * Baseline-ratchet model (shared with the tenant-scoping gate via
 * scripts/lib/symbol-baseline.mjs): the current hits are frozen in
 * `scripts/status-literal-baseline.json` as `relpath::symbol::signature` keys.
 * A NEW hit not in the baseline fails (exit 1); baselined hits pass silently;
 * stale entries are informational.
 *
 *   node scripts/check-status-literals.mjs            # gate (CI + pre-commit via `lint`)
 *   node scripts/check-status-literals.mjs --update   # regenerate the baseline snapshot
 *
 * The member VALUES are ordinary English words reused by unrelated axes (an
 * erasure job's status, an outbox row's delivery status). Those over-inclusive
 * hits are frozen in the baseline; only genuinely new literals fail. When a new
 * hit is on a legitimately different axis, add it via `--update` after review —
 * the same escape hatch the tenant-scoping gate uses.
 *
 * console.* is intentional — this is a build script, not server code.
 */
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
    enclosingSymbol,
    normalizeSignature,
    makeKey,
    diffBaseline,
    loadBaseline,
    writeBaseline,
} from './lib/symbol-baseline.mjs';

export { findStatusLiterals };

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCAN_DIRS = [join(ROOT, 'server'), join(ROOT, 'app')];
const BASELINE = join(ROOT, 'scripts', 'status-literal-baseline.json');

// Identifiers that denote a status column/field. The member words themselves
// are generic, so binding to one of these keys is what makes a literal a status
// write rather than an unrelated string.
const STATUS_KEYS = ['status', 'reportStatus', 'conciergeStatus', 'inspectionStatus'];

// Files whose whole job is to DEFINE the status axes — the one place bare
// member literals are legitimate.
const WHITELIST = new Set([
    'server/lib/status/inspection-status.ts',
    'server/lib/status/report-status.ts',
]);

// ---------------------------------------------------------------------------
// Core heuristic (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Scans `source` for member values written as bare literals bound to a status
 * key. Returns hits with the char offset, the trimmed source line (context),
 * and a normalized signature of the matched snippet (drift-immune, keeps two
 * distinct hits in one symbol distinct).
 *
 * @param {string} source
 * @param {{ statusKeys: string[], members: string[] }} opts
 * @returns {{ index: number, context: string, signature: string }[]}
 */
function findStatusLiterals(source, { statusKeys, members }) {
    if (!statusKeys.length || !members.length) return [];
    const keyAlt = statusKeys.join('|');
    const memAlt = members.join('|');
    const patterns = [
        // KEY: 'member'  (assignment / object property)
        new RegExp(`\\b(?:${keyAlt})\\s*:\\s*(['"])(?:${memAlt})\\1`, 'g'),
        // KEY === 'member'  (key-first comparison)
        new RegExp(`\\b(?:${keyAlt})\\s*(?:===|!==|==|!=)\\s*(['"])(?:${memAlt})\\1`, 'g'),
        // 'member' === KEY  (value-first comparison)
        new RegExp(`(['"])(?:${memAlt})\\1\\s*(?:===|!==|==|!=)\\s*(?:${keyAlt})\\b`, 'g'),
    ];

    const hits = [];
    const seen = new Set();
    for (const re of patterns) {
        let m;
        while ((m = re.exec(source)) !== null) {
            const index = m.index;
            if (seen.has(index)) continue;

            // Comment guard: ignore hits on `//` or `*`/`/*` comment lines.
            const lineStart = source.lastIndexOf('\n', index) + 1;
            const prefix = source.slice(lineStart, index);
            const leftTrimmed = prefix.replace(/^\s+/, '');
            if (prefix.includes('//') || leftTrimmed.startsWith('*') || leftTrimmed.startsWith('/*')) {
                continue;
            }

            // Union-type guard: `status: 'a' | 'b'` is a type declaration, not a
            // status write — skip when the literal is immediately followed by `|`.
            const after = source.slice(index + m[0].length);
            if (/^\s*\|/.test(after)) continue;

            const lineEnd = source.indexOf('\n', index);
            const context = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();
            seen.add(index);
            hits.push({ index, context, signature: normalizeSignature(m[0]) });
        }
    }
    hits.sort((a, b) => a.index - b.index);
    return hits;
}

// ---------------------------------------------------------------------------
// Member derivation — read the two axes' source of truth so the gate stays in
// sync with them automatically (no hand-maintained member list).
// ---------------------------------------------------------------------------
function readMembers() {
    const grab = (relPath, constName) => {
        const src = readFileSync(join(ROOT, relPath), 'utf8');
        const m = src.match(new RegExp(`${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
        if (!m) return [];
        return [...m[1].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1]);
    };
    return [
        ...new Set([
            ...grab('server/lib/status/inspection-status.ts', 'INSPECTION_STATUSES'),
            ...grab('server/lib/status/report-status.ts', 'REPORT_STATUSES'),
        ]),
    ];
}

// ---------------------------------------------------------------------------
// File walk
// ---------------------------------------------------------------------------
function walkFiles(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry === 'paraglide' || entry === 'node_modules') continue; // generated / deps
        const p = join(dir, entry);
        const st = statSync(p);
        if (st.isDirectory()) walkFiles(p, out);
        else if (/\.tsx?$/.test(p) && !/\.(test|spec)\.tsx?$/.test(p)) out.push(p);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Main scan (only when executed directly, not when imported by the test)
// ---------------------------------------------------------------------------
const _scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').toLowerCase();
const _argv1 = (process.argv[1] ?? '').replace(/\\/g, '/').toLowerCase();
if (_scriptPath === _argv1 || _argv1.endsWith('/check-status-literals.mjs')) {
    const members = readMembers();
    if (members.length === 0) {
        console.error('Status-literal gate: could not read status members from source of truth.');
        process.exit(1);
    }

    /** @type {Map<string, string>} key -> context */
    const currentHits = new Map();
    for (const scanDir of SCAN_DIRS) {
        for (const file of walkFiles(scanDir)) {
            const rel = relative(ROOT, file).replace(/\\/g, '/');
            if (WHITELIST.has(rel)) continue;
            const source = readFileSync(file, 'utf8');
            for (const hit of findStatusLiterals(source, { statusKeys: STATUS_KEYS, members })) {
                const key = makeKey(rel, enclosingSymbol(source, hit.index), hit.signature);
                currentHits.set(key, hit.context);
            }
        }
    }

    if (process.argv.includes('--update')) {
        const count = writeBaseline(BASELINE, [...currentHits.keys()]);
        console.log(`Updated status-literal baseline: ${count} entries.`);
        process.exit(0);
    }

    const baseline = loadBaseline(BASELINE);
    const { violations, stale } = diffBaseline(currentHits, baseline);

    if (violations.length > 0) {
        console.error('\nStatus-literal gate FAILED — new bare status literals detected:\n');
        console.error(
            '  These write or compare a status value as a hand-typed string instead of the\n' +
                '  derived constant. That bypasses the type layer (the path by which ghost\n' +
                '  values reach runtime).\n\n' +
                '  Fix options:\n' +
                '    (a) Use the constant: INSPECTION_STATUS.* or REPORT_STATUS.*\n' +
                "    (b) If the hit is on a genuinely different status axis, run\n" +
                '        `node scripts/check-status-literals.mjs --update` after review to\n' +
                '        freeze it into the baseline.\n',
        );
        for (const key of violations) {
            console.error(`  ${key}\n      ${currentHits.get(key)}`);
        }
        console.error(`\n${violations.length} violation(s).`);
        process.exit(1);
    }

    console.log(`Status-literal gate: OK (${baseline.size} baselined, 0 new violations).`);
    if (stale.length > 0) {
        console.log(
            `  ${stale.length} stale baseline entry(s) no longer hit — run ` +
                '`node scripts/check-status-literals.mjs --update` to tighten.',
        );
    }
    process.exit(0);
}
