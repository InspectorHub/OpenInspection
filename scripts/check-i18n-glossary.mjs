#!/usr/bin/env node
/**
 * i18n — glossary conformance gate (`lint:i18n-glossary`).
 *
 * `docs/developers/i18n-glossary.md` fixes one es-419 equivalent per product
 * term. A glossary nobody checks is a suggestion, and 4,300 keys translated
 * against a suggestion produce four Spanish words for "Report". This gate reads
 * the glossary's own tables — the document is the source of truth, not a copy
 * kept in here — and holds `messages/es-419/**` to them.
 *
 * Three checks:
 *   1. BANNED TERM   — a term the glossary's "Never" column rules out appears in
 *                      a translation. Only context-free wrong words are listed
 *                      there, so a hit is always a real hit.
 *   2. CONSISTENCY   — two keys with character-identical English must have
 *                      identical Spanish, unless declared under gate:divergence.
 *   3. PLACEHOLDERS  — `{name}` tokens must survive translation unchanged. A
 *                      dropped or renamed one compiles to a different function
 *                      signature and breaks the call site at runtime.
 *
 * Plus self-guards: a gate that silently scans nothing is worse than no gate, so
 * this one fails if the glossary stops parsing, if the tables shrink below a
 * floor, or if the catalogue cannot be read.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GLOSSARY = join(root, 'docs/developers/i18n-glossary.md');
const SOURCE_LOCALE = 'en';
const TARGET_LOCALE = 'es-419';

/** Floors for the self-guard. Raise as the glossary grows; never lower to pass. */
const MIN_TERM_ROWS = 60;
const MIN_BANNED_TERMS = 15;
const MIN_SOURCE_KEYS = 100;

let failed = false;
const fail = (msg) => { failed = true; console.error(`[i18n-glossary] ${msg}`); };

/**
 * Accent- and case-insensitive form, so "Reportes" is caught by "reporte".
 * The combining-marks range is written as escapes on purpose: spelling it with
 * literal accents would leave invisible characters in this file.
 */
const isCombiningMark = (cp) => cp >= 0x0300 && cp <= 0x036f;
const norm = (s) => [...s.normalize('NFD')]
    .filter((ch) => !isCombiningMark(ch.codePointAt(0)))
    .join('')
    .toLowerCase();

function loadCatalogue(locale) {
    const dir = join(root, 'messages', locale);
    const merged = {};
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const file of files) {
        const { $schema, ...messages } = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        for (const [key, value] of Object.entries(messages)) merged[key] = { value: String(value), file };
    }
    return { merged, fileCount: files.length };
}

/**
 * Parse every markdown table that follows a `<!-- gate:terms -->` marker.
 * Columns are (english | es-419 | never | why); only the first three are read.
 */
function parseGlossary(text) {
    const terms = [];
    const marker = /<!--\s*gate:terms\s*-->/g;
    let m;
    while ((m = marker.exec(text)) !== null) {
        const rest = text.slice(m.index + m[0].length);
        let started = false;
        for (const line of rest.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('|')) { if (started) break; continue; }
            const cells = trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
            if (cells.every((c) => /^:?-{2,}:?$/.test(c))) { started = true; continue; }
            if (!started) continue;           // header row
            if (cells.length < 3) continue;
            terms.push({ english: cells[0], approved: cells[1], never: cells[2] });
        }
    }
    // Keys allowed to break the consistency rule, declared as list items.
    const divergence = new Set();
    const dm = /<!--\s*gate:divergence\s*-->/.exec(text);
    if (dm) {
        for (const line of text.slice(dm.index).split('\n')) {
            if (/^#{1,6}\s/.test(line.trim())) break;
            if (!line.trim().startsWith('-')) continue;
            for (const k of line.matchAll(/`([a-z0-9_]+)`/g)) divergence.add(k[1]);
        }
    }
    return { terms, divergence };
}

/** One regex per banned term: whole word, optional Spanish plural, spaces loose. */
function bannedMatcher(term) {
    const escaped = norm(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:e?s)?(?![\\p{L}\\p{N}])`, 'u');
}

// ---------------------------------------------------------------- self-guards
if (!existsSync(GLOSSARY)) {
    fail(`docs/developers/i18n-glossary.md is missing — the gate has nothing to enforce.`);
    console.error('[i18n-glossary] FAIL');
    process.exit(1);
}
const { terms, divergence } = parseGlossary(readFileSync(GLOSSARY, 'utf8'));

const banned = [];
for (const row of terms) {
    if (!row.never || row.never === '—' || row.never === '-') continue;
    for (const raw of row.never.split(',')) {
        const term = raw.trim().replace(/^[*_`]+|[*_`]+$/g, '');
        if (term) banned.push({ term, approved: row.approved, english: row.english });
    }
}

if (terms.length < MIN_TERM_ROWS) {
    fail(`only ${terms.length} term row(s) parsed from the glossary (floor ${MIN_TERM_ROWS}). `
        + `Either the tables shrank or the gate:terms markers / table layout changed — a gate that reads nothing passes everything.`);
}
if (banned.length < MIN_BANNED_TERMS) {
    fail(`only ${banned.length} banned term(s) parsed (floor ${MIN_BANNED_TERMS}) — same reason.`);
}

const { merged: source } = loadCatalogue(SOURCE_LOCALE);
const { merged: target, fileCount: targetFiles } = loadCatalogue(TARGET_LOCALE);
const sourceKeys = Object.keys(source);
if (sourceKeys.length < MIN_SOURCE_KEYS) {
    fail(`only ${sourceKeys.length} source key(s) loaded (floor ${MIN_SOURCE_KEYS}) — the catalogue did not load.`);
}
if (targetFiles === 0) fail(`no messages/${TARGET_LOCALE}/*.json files found.`);

for (const key of divergence) {
    if (!(key in source)) {
        fail(`gate:divergence lists '${key}', which is not a key in messages/${SOURCE_LOCALE}/*.json — remove it.`);
    }
}

if (failed) {
    console.error('[i18n-glossary] FAIL — the gate could not trust its own inputs; fix the above before relying on it.');
    process.exit(1);
}

// ------------------------------------------------------------ 1. banned terms
const matchers = banned.map((b) => ({ ...b, re: bannedMatcher(b.term) }));
const hits = [];
for (const [key, { value, file }] of Object.entries(target)) {
    const haystack = norm(value);
    // Several rows can rule out the same written word ("tu" and "tú" normalise
    // alike); report the offending word once per key, not once per row.
    const seen = new Set();
    for (const b of matchers) {
        const found = b.re.exec(haystack);
        if (!found || seen.has(found[0])) continue;
        seen.add(found[0]);
        hits.push({ key, file, value, word: found[0], ...b });
    }
}
if (hits.length) {
    fail(`${hits.length} translation(s) use a term the glossary rules out:`);
    for (const h of hits) {
        console.error(`    ${h.file} · ${h.key}\n      "${h.value}"\n      '${h.word}' is ruled out for ${h.english} — use '${h.approved}'.`);
    }
}

// -------------------------------------------------------------- 2. consistency
const byEnglish = new Map();
for (const [key, { value }] of Object.entries(source)) {
    const v = value.trim();
    if (!byEnglish.has(v)) byEnglish.set(v, []);
    byEnglish.get(v).push(key);
}
for (const [english, keys] of byEnglish) {
    if (keys.length < 2) continue;
    const translated = keys.filter((k) => k in target && target[k].value.trim() !== '');
    if (translated.length < 2) continue;
    const variants = new Map();
    for (const k of translated) {
        const es = target[k].value.trim();
        if (!variants.has(es)) variants.set(es, []);
        variants.get(es).push(k);
    }
    if (variants.size < 2) continue;
    if (translated.every((k) => divergence.has(k))) continue;
    fail(`"${english}" has ${variants.size} different translations — identical English must read identically:`);
    for (const [es, ks] of variants) console.error(`      "${es}"  ← ${ks.join(', ')}`);
    console.error(`      Pick one, or declare the split under gate:divergence in the glossary with a reason.`);
}

// -------------------------------------------------------------- 3. placeholders
const holders = (s) => [...s.matchAll(/\{([^}]*)\}/g)].map((x) => x[1].trim()).sort();
for (const [key, { value, file }] of Object.entries(target)) {
    if (!(key in source)) continue;             // stale keys are check-i18n-catalog's job
    const want = holders(source[key].value);
    const got = holders(value);
    if (want.join(' ') === got.join(' ')) continue;
    fail(`${file} · ${key}: placeholders changed in translation — [${want.join(', ')}] became [${got.join(', ')}].`
        + ` The call site passes the English set; a rename or a drop breaks it.`);
}

if (failed) {
    console.error('[i18n-glossary] FAIL — see docs/developers/i18n-glossary.md.');
    process.exit(1);
}
const translated = sourceKeys.filter((k) => k in target && target[k].value.trim() !== '').length;
console.log(`[i18n-glossary] OK — ${terms.length} term row(s), ${banned.length} banned term(s), `
    + `${divergence.size} declared divergence(s); checked ${translated} translated key(s) of ${sourceKeys.length}.`);
