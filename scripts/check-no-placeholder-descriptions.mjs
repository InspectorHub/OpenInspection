#!/usr/bin/env node
/**
 * Placeholder-description ratchet.
 *
 * API descriptions that read "Auto-generated placeholder" or "TODO describe"
 * are published verbatim into the OpenAPI document and the contract snapshot,
 * where integrators and tool-calling clients read them as documentation. This
 * gate counts the literal placeholder phrases in three places and lets the
 * count only fall:
 *
 *   source    server/**\/*.ts
 *   snapshot  server/lib/mcp/openapi-snapshot.json
 *   contract  everything under contracts/
 *
 * The baseline stores the current count per category. Above it the gate fails;
 * below it the gate asks for --update to tighten the ratchet. The target is 0.
 * A scan that reads zero files is a broken reader, not a clean repo, so it
 * fails.
 *
 *   node scripts/check-no-placeholder-descriptions.mjs            # gate
 *   node scripts/check-no-placeholder-descriptions.mjs --update   # tighten
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'no-placeholder-descriptions-baseline.json');
const SNAPSHOT = 'server/lib/mcp/openapi-snapshot.json';

export const PHRASES = ['Auto-generated placeholder', 'TODO describe'];
export const CATEGORIES = ['source', 'snapshot', 'contract'];

/** Count literal occurrences of every placeholder phrase in a string. */
export function countPlaceholders(text) {
    let n = 0;
    for (const phrase of PHRASES) n += text.split(phrase).length - 1;
    return n;
}

/**
 * Tally a set of files. `files` is [{ category, path, text }]. Returns
 * per-category { hits, files } plus totals.
 */
export function tally(files) {
    const by = Object.fromEntries(CATEGORIES.map((c) => [c, { hits: 0, files: 0 }]));
    for (const f of files) {
        by[f.category].files += 1;
        by[f.category].hits += countPlaceholders(f.text);
    }
    const hits = CATEGORIES.reduce((s, c) => s + by[c].hits, 0);
    const scanned = CATEGORIES.reduce((s, c) => s + by[c].files, 0);
    return { by, hits, scanned };
}

/**
 * Compare a tally to the baseline. Returns { errors, tighten }. Zero scanned
 * files is an error: an empty scan would read as green.
 */
export function evaluate(result, baseline) {
    const errors = [];
    const tighten = [];
    if (result.scanned === 0) {
        errors.push('scanned 0 files - the reader is broken, not the repo.');
    }
    for (const c of CATEGORIES) {
        if (result.by[c].files === 0) errors.push(`${c}: scanned 0 files - the reader is broken, not the repo.`);
        const allowed = baseline[c] ?? 0;
        const got = result.by[c].hits;
        if (got > allowed) errors.push(`${c}: ${got} placeholder description(s), baseline allows ${allowed}. Write a real description.`);
        else if (got < allowed) tighten.push(`${c}: ${got} < baseline ${allowed}`);
    }
    return { errors, tighten };
}

function walk(dir, accept, out = []) {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) {
            if (name === 'node_modules') continue;
            walk(p, accept, out);
        } else if (accept(p)) out.push(p);
    }
    return out;
}

function collect() {
    const files = [];
    const add = (category, p) => files.push({ category, path: relative(ROOT, p).split(/[\\/]/).join('/'), text: readFileSync(p, 'utf8') });
    for (const p of walk(join(ROOT, 'server'), (f) => f.endsWith('.ts'))) add('source', p);
    if (existsSync(join(ROOT, SNAPSHOT))) add('snapshot', join(ROOT, SNAPSHOT));
    for (const p of walk(join(ROOT, 'contracts'), () => true)) add('contract', p);
    return files;
}

function main() {
    const files = collect();
    const result = tally(files);
    const line = CATEGORIES.map((c) => `${c} ${result.by[c].hits} hits / ${result.by[c].files} files`).join(' · ');
    console.log(`no-placeholder-descriptions: ${result.hits} hits in ${result.scanned} files scanned (${line})`);

    if (process.argv.includes('--update')) {
        if (result.scanned === 0) {
            console.error('refusing to write a baseline from an empty scan.');
            process.exit(1);
        }
        const next = Object.fromEntries(CATEGORIES.map((c) => [c, result.by[c].hits]));
        writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
        console.log('baseline re-taken.');
        return;
    }

    const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const { errors, tighten } = evaluate(result, baseline);
    if (tighten.length) {
        console.log('  below baseline - tighten with --update:');
        for (const t of tighten) console.log(`    ${t}`);
    }
    if (errors.length) {
        console.error(`\nPlaceholder-description gate - ${errors.length} problem(s):`);
        for (const e of errors) console.error(`  ${e}`);
        process.exit(1);
    }
    console.log('Placeholder-description gate - no category above its baseline.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
