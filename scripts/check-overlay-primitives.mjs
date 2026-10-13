#!/usr/bin/env node
/**
 * No hand-written full-screen overlay: a dialog must go through the shared stack.
 *
 * A `fixed` + `inset-0` element is the tell. A dialog written this way brings its
 * own idea of Escape (none, or one document listener per instance, so two stacked
 * dialogs both close), has no Tab trap or scroll lock, and does not hand focus back
 * to the control that opened it. The shared pieces in packages/shared-ui/src own all
 * of that: `Modal`, `Drawer`, `Popover`, the layer stack in `layers.ts`, and
 * `useDialogBehavior` for a layout that cannot be a centred panel.
 *
 * The rule: a source file under app/ or packages/<pkg>/src/ that has a class string
 * holding the token `fixed` plus `inset-0` (or both `inset-x-0` and `inset-y-0`), in
 * any order, with any variant or `!` prefix, or JSX carrying role="dialog" /
 * aria-modal="true", must be one of the shared primitives (HOME_FILES) or must really
 * CALL `useDialogBehavior(` / `useLayer(` (comments and string contents do not count).
 * Tests are skipped.
 *
 * Files that predate this gate are grandfathered in scripts/overlay-primitives-baseline.json
 * as { file: number of offending lines }. The baseline is a ratchet: a NEW offender, or
 * a grandfathered file with MORE offending lines, fails; a file that improves prints a
 * "tighten" note. Fix a violation by using the shared component; never grow the baseline.
 *
 * Usage: node scripts/check-overlay-primitives.mjs [--self-test] [--update]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'overlay-primitives-baseline.json');

const SHARED = 'packages/shared-ui/src';
/** The shared primitives. They legitimately hold the raw markup; each must exist. */
const HOME_FILES = [
    `${SHARED}/Modal.tsx`,
    `${SHARED}/Drawer.tsx`,
    `${SHARED}/Popover.tsx`,
    `${SHARED}/layers.ts`,
    `${SHARED}/useDialogBehavior.ts`,
    `${SHARED}/useCloseShield.tsx`,
];
/** Homes that must be SEEN as overlays by the detector (they hold real overlay markup). */
const MUST_DETECT = [`${SHARED}/Modal.tsx`, `${SHARED}/Drawer.tsx`];

const OVERLAY_RE = /fixed\s+inset-0/g;
const DIALOG_RE = /\brole\s*=\s*(?:\{\s*)?["']dialog["']|\baria-modal\s*=\s*(?:\{\s*true\s*\}|["']true["'])/g;
// A call, not a definition: `function useLayer(` declares, it does not use.
const SHARED_CALL_RE = /(?<!\bfunction\s+)(?<![.\w$])use(?:DialogBehavior|Layer)\s*\(/;

/**
 * One pass over the source. Returns the source with comments removed and string
 * contents intact (`text`), the same with string and template contents blanked
 * (`code`), and every string/template literal (`literals`, with offsets into `text`).
 * Quote-delimited strings end at a newline, so an apostrophe in JSX prose cannot
 * swallow the rest of the file.
 */
export function scan(source) {
    let text = '';
    let code = '';
    const literals = [];
    let i = 0;
    const n = source.length;
    while (i < n) {
        const c = source[i];
        const next = source[i + 1];
        if (c === '/' && next === '/') {
            while (i < n && source[i] !== '\n') i += 1;
            continue;
        }
        if (c === '/' && next === '*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end < 0 ? n : end + 2;
            // Keep newlines so line numbers stay true; blank everything else.
            for (let k = i; k < stop; k += 1) if (source[k] === '\n') { text += '\n'; code += '\n'; }
            i = stop;
            continue;
        }
        // An apostrophe right after a letter is prose ("won't"), not a string opener.
        const prose = c === "'" && /[A-Za-z0-9]/.test(source[i - 1] ?? '');
        if (!prose && (c === '"' || c === "'" || c === '`')) {
            let j = i + 1;
            while (j < n) {
                if (source[j] === '\\') { j += 2; continue; }
                if (source[j] === c) break;
                if (c !== '`' && source[j] === '\n') break;
                j += 1;
            }
            const body = source.slice(i + 1, Math.min(j, n));
            const closed = source[j] === c;
            literals.push({ body, start: text.length, end: text.length + 1 + body.length + (closed ? 1 : 0) });
            const raw = source.slice(i, closed ? j + 1 : j);
            text += raw;
            // Keep newlines inside template literals so line numbers in `code` stay true.
            code += c + raw.slice(1, closed ? -1 : undefined).replace(/[^\n]/g, ' ') + (closed ? c : '');
            i = closed ? j + 1 : j;
            continue;
        }
        text += c;
        code += c;
        i += 1;
    }
    return { text, code, literals };
}

/** Joins literals separated only by `+` ("fixed " + "inset-0 z-50") into one class string. */
function classStrings(text, literals) {
    const out = [];
    for (const lit of literals) {
        const prev = out[out.length - 1];
        if (prev && /^\s*\+\s*$/.test(text.slice(prev.end, lit.start))) {
            prev.body += ` ${lit.body}`;
            prev.end = lit.end;
        } else {
            out.push({ ...lit });
        }
    }
    return out;
}

function isOverlayClassString(body) {
    // Drop template placeholders, then normalise `md:`/`hover:` prefixes and `!`.
    const tokens = new Set(
        body
            .replace(/\$\{[^}]*\}/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map((t) => t.replace(/^.*:/, '').replace(/^!/, '')),
    );
    const inset = tokens.has('inset-0') || (tokens.has('inset-x-0') && tokens.has('inset-y-0'));
    return tokens.has('fixed') && inset;
}

/** 1-based lines (distinct, ascending) that carry overlay or dialog markup. */
export function overlayLines(source) {
    const { text, literals } = scan(source);
    const offsets = [];
    for (const re of [OVERLAY_RE, DIALOG_RE]) {
        for (const m of text.matchAll(re)) offsets.push(m.index);
    }
    for (const l of classStrings(text, literals)) if (isOverlayClassString(l.body)) offsets.push(l.start);
    const lineOf = (off) => {
        let line = 1;
        for (let k = 0; k < off; k += 1) if (text[k] === '\n') line += 1;
        return line;
    };
    return [...new Set(offsets.map(lineOf))].sort((a, b) => a - b);
}

/** Returns 'none' (no overlay), 'ok' (a shared primitive, or wired to the stack) or 'violation'. */
export function classify(path, source) {
    if (overlayLines(source).length === 0) return 'none';
    if (HOME_FILES.includes(path) || SHARED_CALL_RE.test(scan(source).code)) return 'ok';
    return 'violation';
}

// A scanner that reports absence is the failure mode, so it must catch every planted
// violation shape and pass every planted compliant shape before it may report a clean tree.
const probes = [
    // Violations: each must be flagged.
    ['app/x/Bad.tsx', '<div className="fixed inset-0 z-50">', 'violation'],
    ['app/x/Order.tsx', '<div className="inset-0 fixed z-50">', 'violation'],
    ['app/x/Between.tsx', '<div className="fixed z-50 inset-0 bg-black/50">', 'violation'],
    ['app/x/Axes.tsx', '<div className="fixed inset-x-0 inset-y-0 z-50">', 'violation'],
    ['app/x/Important.tsx', '<div className="!fixed inset-0 z-50">', 'violation'],
    ['app/x/Variant.tsx', '<div className="md:fixed md:inset-0 z-50">', 'violation'],
    ['app/x/Concat.tsx', 'const c = "fixed " + "inset-0 z-50";', 'violation'],
    ['app/x/Template.tsx', 'const c = `fixed z-50 ${a} inset-0`;', 'violation'],
    ['app/x/Role.tsx', '<div role="dialog" aria-label="x">', 'violation'],
    ['app/x/Modal.tsx', '<div aria-modal="true">', 'violation'],
    ['app/x/ModalExpr.tsx', '<div aria-modal={true}>', 'violation'],
    ['app/x/LineComment.tsx', '// useDialogBehavior(open, ref)\n<div className="fixed inset-0 z-50">', 'violation'],
    ['app/x/BlockComment.tsx', '/* useLayer(true) */\n<div className="fixed inset-0 z-50">', 'violation'],
    ['app/x/InString.tsx', 'const s = "useLayer(";\n<div className="fixed inset-0 z-50">', 'violation'],
    ['app/x/Definition.tsx', 'function useLayer(open) {}\n<div className="fixed inset-0 z-50">', 'violation'],
    ['app/x/Apostrophe.tsx', "<p>won't</p><div className=\"fixed inset-0 z-50\">", 'violation'],
    ['packages/other/src/Pkg.tsx', '<div className="fixed inset-0 z-50">', 'violation'],
    ['app/x/Crlf.tsx', 'const a = 1;\r\n<div className="fixed inset-0 z-50">\r\n', 'violation'],
    // Compliant: each must pass.
    ['app/x/Good.tsx', 'useDialogBehavior(true, ref); <div className="fixed inset-0">', 'ok'],
    ['app/x/GoodLayer.tsx', 'const h = useLayer(open, {}); <div className="inset-0 fixed">', 'ok'],
    ['app/x/GoodRole.tsx', 'useDialogBehavior(true, ref); <div role="dialog">', 'ok'],
    [HOME_FILES[0], '<div className="fixed inset-0 z-[200]" role="dialog">', 'ok'],
    ['app/x/Plain.tsx', '<div className="flex items-center">', 'none'],
    ['app/x/Banner.tsx', '<div className="fixed inset-x-0 bottom-0 z-50">', 'none'],
    ['app/x/Toast.tsx', '<div className="fixed bottom-6 right-6 z-[210]">', 'none'],
    ['app/x/Relative.tsx', '<div className="relative inset-0 z-50">', 'none'],
    ['app/x/Absolute.tsx', '<div className="absolute inset-0 h-full">', 'none'],
    ['app/x/Separate.tsx', '<div className="fixed bottom-0"/><div className="inset-0 z-50"/>', 'none'],
    ['app/x/Commented.tsx', '// <div className="fixed inset-0 z-50">\n/* role="dialog" */', 'none'],
];
// Line numbers are part of the baseline contract, so they are probed too.
const lineProbes = [
    ['fixed inset-0 on line 3', 'a\nb\n<div className="fixed inset-0">', [3]],
    ['block comment keeps lines', '/* a\nb */\n<div role="dialog">', [3]],
    ['CRLF line count', 'a\r\nb\r\n<div role="dialog">', [3]],
];
const broken = probes.filter(([p, s, want]) => classify(p, s) !== want);
const brokenLines = lineProbes.filter(([, s, want]) => JSON.stringify(overlayLines(s)) !== JSON.stringify(want));
if (broken.length || brokenLines.length) {
    console.error('\n[overlay-primitives] BROKEN - the scanner failed its own self-test:');
    for (const [p, s, want] of broken) {
        console.error(`   ${p}: expected ${want}, got ${classify(p, s)}   ${JSON.stringify(s).slice(0, 70)}`);
    }
    for (const [name, s, want] of brokenLines) {
        console.error(`   line probe "${name}": expected ${JSON.stringify(want)}, got ${JSON.stringify(overlayLines(s))}`);
    }
    console.error('Until this is fixed, a clean scan means nothing.\n');
    process.exit(1);
}
const args = process.argv.slice(2);
if (args.includes('--self-test')) {
    const bad = probes.filter(([, , w]) => w === 'violation').length;
    console.log(`\n[overlay-primitives] self-test OK - ${bad} planted violation shape(s) flagged, `
        + `${probes.length - bad} compliant/unrelated shape(s) passed, ${lineProbes.length} line-number probe(s) held.\n`);
    process.exit(0);
}

const isTest = (p) => /\.(?:test|spec)\.(?:tsx|jsx|ts)$/.test(p) || p.includes('/__tests__/')
    || p.includes('/node_modules/') || p.endsWith('.d.ts');
const lsFiles = (...specs) => execFileSync('git', ['ls-files', '-z', '--', ...specs], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
}).toString('utf8').split('\0').filter((p) => p !== '');

// ":(glob)" so `**/` also matches files directly under app/ (root.tsx, entry.*.tsx).
const globbed = [...new Set(lsFiles(
    ':(glob)app/**/*.tsx', ':(glob)app/**/*.jsx', ':(glob)app/**/*.ts',
    ':(glob)packages/*/src/**/*.tsx', ':(glob)packages/*/src/**/*.ts',
))].filter((p) => !isTest(p)).sort();
// Independent count: everything git tracks under app/ and packages/, filtered in JS.
const counted = lsFiles('app', 'packages').filter((p) =>
    (p.startsWith('app/') ? /\.(?:tsx|jsx|ts)$/.test(p) : /^packages\/[^/]+\/src\/.*\.(?:tsx|ts)$/.test(p)) && !isTest(p));
const files = globbed;

let overlays = 0;
let ok = 0;
let unreadable = 0;
const violations = new Map(); // path -> { lines, src }
for (const path of files) {
    let src;
    try {
        src = readFileSync(join(ROOT, path), 'utf8');
    } catch {
        unreadable += 1;
        continue;
    }
    const verdict = classify(path, src);
    if (verdict === 'none') continue;
    overlays += 1;
    if (verdict === 'ok') ok += 1;
    else violations.set(path, { lines: overlayLines(src), src });
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};

if (args.includes('--update')) {
    const next = {};
    for (const [p, v] of [...violations].sort(([a], [b]) => (a < b ? -1 : 1))) next[p] = v.lines.length;
    writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
    console.log(`Updated scripts/overlay-primitives-baseline.json: ${Object.keys(next).length} grandfathered file(s).`);
    process.exit(0);
}

const fresh = []; // not in baseline
const grew = [];
const tightened = [];
for (const [p, v] of violations) {
    if (!(p in baseline)) fresh.push(p);
    else if (v.lines.length > baseline[p]) grew.push(p);
    else if (v.lines.length < baseline[p]) tightened.push(p);
}
const cleared = Object.keys(baseline).filter((p) => !violations.has(p));
const grandfathered = [...violations.keys()].filter((p) => p in baseline).length;

// Every number, always: "no violation" and "looked at nothing" must not read the same.
console.log(`\n[overlay-primitives] ${files.length} source file(s) scanned (${counted.length} by independent count) | `
    + `${overlays} with a full-screen overlay or dialog markup | ${ok} wired to the stack | `
    + `${violations.size} violation(s) | ${grandfathered} grandfathered | ${fresh.length + grew.length} new | `
    + `${unreadable} unreadable`);

let failed = false;
if (files.length === 0) {
    console.error('[overlay-primitives] scanned ZERO files. A scan of nothing is not a clean scan.');
    failed = true;
}
if (files.length !== counted.length) {
    console.error(`[overlay-primitives] file listing disagrees with the independent count `
        + `(${files.length} vs ${counted.length}): the pathspec is missing files.`);
    failed = true;
}
if (unreadable > 0) {
    console.error(`[overlay-primitives] ${unreadable} file(s) could not be read; they were not checked.`);
    failed = true;
}
for (const home of HOME_FILES) {
    if (!files.includes(home)) {
        console.error(`[overlay-primitives] ${home} was not scanned. The floor of this gate is missing.`);
        failed = true;
    }
}
for (const home of MUST_DETECT) {
    let homeSrc = '';
    try { homeSrc = readFileSync(join(ROOT, home), 'utf8'); } catch { /* counted above */ }
    if (classify(home, homeSrc) !== 'ok') {
        console.error(`[overlay-primitives] ${home} was not classified as an overlay: the detector no longer sees a`
            + ' file that must always be seen.');
        failed = true;
    }
}
if (fresh.length || grew.length) {
    console.error(`\n${fresh.length + grew.length} file(s) hand-write a full-screen overlay or dialog beyond the baseline:\n`);
    for (const p of [...fresh, ...grew]) {
        const base = p in baseline ? ` (baseline ${baseline[p]})` : '';
        console.error(`   ${p}: line(s) ${violations.get(p).lines.join(', ')}${base}`);
    }
    console.error('\nUse Modal / Drawer / Popover from shared-ui. If the layout cannot be a');
    console.error('centred panel, call useDialogBehavior(open, ref, { onClose }) from the component.');
    console.error('Do not add to the baseline: it only ever shrinks.\n');
    failed = true;
}
if (tightened.length || cleared.length) {
    console.log(`   ${tightened.length + cleared.length} grandfathered file(s) improved - run `
        + '`npm run lint:overlays -- --update` to tighten the ratchet.');
}
if (failed) process.exit(1);
console.log('[overlay-primitives] OK - no new hand-written overlay; every other overlay goes through the shared stack.\n');
