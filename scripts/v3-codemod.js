/**
 * v3-codemod.js — Sub-spec B Task 8 (B-7)
 *
 * Sweeps src/templates/pages, src/templates/components, public/js for v1
 * residual classes (font-black / tracking-tightest / rounded-2xl / text-7xl
 * / text-5xl / inline atmospheric blob …) and rewrites them to the canonical
 * v3 design-system tokens.
 *
 * Usage:
 *   node scripts/v3-codemod.js --dry-run    # preview changes only
 *   node scripts/v3-codemod.js              # apply changes
 *
 * Caveats:
 *   - Lines containing the literal `codemod-keep` are preserved (used for
 *     stat-number font-black retention etc.).
 *   - report.template.tsx is fully exempt — Sub-spec D handles its cover hero
 *     separately and may legitimately use larger weights / sizes.
 *   - The codemod is line-oriented so that `codemod-keep` markers work. Each
 *     line is processed independently against every regex.
 */

import fs from 'fs';
import path from 'path';

const TARGETS = ['src/templates/pages', 'src/templates/components', 'public/js'];
const EXTS = ['.tsx', '.ts', '.js'];

const REPLACEMENTS = [
    [/\brounded-2xl\b/g,                            'rounded-md',         'rounded-2xl → rounded-md'],
    [/\brounded-3xl\b/g,                            'rounded-lg',         'rounded-3xl → rounded-lg'],
    [/\brounded-\[3rem\]/g,                         'rounded-md',         'rounded-[3rem] → rounded-md'],
    [/\bfont-black\b/g,                             'font-bold',          'font-black → font-bold'],
    [/\btracking-tightest\b/g,                      'tracking-tight',     'tracking-tightest → tracking-tight'],
    [/\btracking-\[0\.04em\]/g,                     'tracking-tight',     'tracking-[0.04em] → tracking-tight'],
    [/\btext-7xl\b/g,                               'text-4xl',           'text-7xl → text-4xl'],
    [/\btext-5xl\b/g,                               'text-3xl',           'text-5xl → text-3xl'],
    [/\bspace-y-32\b/g,                             'space-y-12',         'space-y-32 → space-y-12'],
    [/\bspace-y-24\b/g,                             'space-y-10',         'space-y-24 → space-y-10'],
    [/\bbg-indigo-500\/5 blur-\[120px\]/g,          'hidden',             'inline atmospheric blob → hidden'],
    [/\btracking-\[0\.3em\]/g,                      'tracking-[0.2em]',   'tracking-[0.3em] → 0.2em'],
    [/\btracking-\[0\.4em\]/g,                      'tracking-[0.2em]',   'tracking-[0.4em] → 0.2em'],
    [/\bshadow-indigo-(\d+)\b/g,                    'shadow-md',          'shadow-indigo-N → shadow-md'],
    [/\bshadow-emerald-(\d+)\b/g,                   'shadow-md',          'shadow-emerald-N → shadow-md'],
];

const PROTECTED_FILES = new Set([
    'apps/core/src/templates/pages/report.template.tsx',
]);

function walk(dir, out) {
    if (!fs.existsSync(dir)) return out;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (EXTS.some(ext => e.name.endsWith(ext))) out.push(full);
    }
    return out;
}

function isProtected(file) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    return PROTECTED_FILES.has(rel) || PROTECTED_FILES.has('apps/core/' + rel);
}

function transform(content) {
    const lines = content.split(/\r?\n/);
    const fileChanges = [];
    const newLines = lines.map(line => {
        if (line.includes('codemod-keep')) return line;
        let processed = line;
        for (const [re, replacement, comment] of REPLACEMENTS) {
            const matches = processed.match(re);
            if (matches) {
                fileChanges.push({ comment, count: matches.length });
                processed = processed.replace(re, replacement);
            }
        }
        return processed;
    });
    return { content: newLines.join('\n'), changes: fileChanges };
}

function run({ dryRun }) {
    const cwd = process.cwd();
    const files = TARGETS.flatMap(t => walk(path.join(cwd, t), []));
    const out = [];
    for (const f of files) {
        if (isProtected(f)) continue;
        const orig = fs.readFileSync(f, 'utf-8');
        const { content: next, changes } = transform(orig);
        if (changes.length > 0 && next !== orig) {
            out.push({ file: path.relative(cwd, f).replace(/\\/g, '/'), changes });
            if (!dryRun) fs.writeFileSync(f, next, 'utf-8');
        }
    }
    return out;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const result = run({ dryRun });
console.log(JSON.stringify({ dryRun, changedFiles: result.length, changes: result }, null, 2));
console.log(dryRun ? `\n(dry-run; no files written; ${result.length} files would change)` : `\n(applied; wrote ${result.length} files)`);
