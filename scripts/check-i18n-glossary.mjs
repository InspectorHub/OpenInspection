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
 * Four checks against the catalogue:
 *   1. BANNED TERM   — a term the glossary's "Never" column rules out appears in
 *                      a translation. Only context-free wrong words are listed
 *                      there, so a hit is always a real hit.
 *   2. CONSISTENCY   — two keys with character-identical English must have
 *                      identical Spanish, unless declared under gate:divergence.
 *   3. PLACEHOLDERS  — `{name}` tokens must survive translation unchanged. A
 *                      dropped or renamed one compiles to a different function
 *                      signature and breaks the call site at runtime.
 *   4. LITERALS      — a string the gate:literal table declares must survive
 *                      byte-identical (`STOP`, `pk_test_`, `label,floor`, vendor
 *                      names) must still be present in the translation. A
 *                      translated `STOP` is a compliance failure, not a typo.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PARSER IS SO SUSPICIOUS OF ITS OWN INPUT
 * ---------------------------------------------------------------------------
 * Every check above is only as real as the number of rows that reached it, and
 * a markdown parser fed a slightly different document does not error — it
 * silently reads less. Four ways this gate has been shown to pass while
 * enforcing nothing:
 *
 *   - Deleting the entire usted/tu enforcement table (16 of 31 banned terms)
 *     left the old global `MIN_BANNED_TERMS = 15` floor satisfied at exactly
 *     15, and the gate printed OK. A single global floor cannot notice that one
 *     whole section vanished. Fixed by a PER-SECTION baseline
 *     (`scripts/i18n-glossary-baseline.json`): a missing section is a failure
 *     regardless of the total.
 *   - A marker scanned the whole rest of the document for a table, so a marker
 *     placed above prose latched onto whatever table came next. Adding one
 *     marker above the three-column "database seeds" table (whose third column
 *     is "Why", where the gate reads "Never") banned `Empresa` — an APPROVED
 *     translation used in 99 keys — plus a paragraph of English prose compiled
 *     into a regex. Fixed by anchoring: the first non-blank line after a marker
 *     must be the table header, and the header must be the canonical one.
 *   - Columns were bound by POSITION, so any table with four columns parsed,
 *     whatever its headers said. Fixed by binding on header name.
 *   - `row.approved` was parsed and then used only inside an error message, so
 *     nothing could ever contradict it. It is now load-bearing: a banned term
 *     that equals some row's approved translation is a parse-time failure, and
 *     the literal table gives the catalogue a second thing to contradict.
 *
 * The rule this encodes: a gate must fail when it stops being able to see, not
 * when what it sees is bad. Every ambiguity below is an error, never a skip.
 *
 *   node scripts/check-i18n-glossary.mjs            # gate (CI + `npm run lint`)
 *   node scripts/check-i18n-glossary.mjs --update   # regenerate the baseline
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GLOSSARY = join(root, 'docs/developers/i18n-glossary.md');
const BASELINE = join(root, 'scripts/i18n-glossary-baseline.json');
const SOURCE_LOCALE = 'en';
const TARGET_LOCALE = 'es-419';

/**
 * Column headers a marked table MUST declare, in order. Binding on the NAME and
 * not the position is the point: a table that means something else no longer
 * parses as this one just because it happens to have the same column count.
 */
const TERM_HEADER = ['English', 'es-419', 'Never', 'Why'];
const LITERAL_HEADER = ['Literal', 'Where it appears', 'Why it stays English'];

/**
 * Smoke floor, NOT a drift ratchet: "did the catalogue load at all". Deliberately
 * not in the baseline file — key counts move on every extraction pass, and a
 * number people re-baseline reflexively stops being read, which would erode the
 * glossary counts sharing the file.
 */
const MIN_SOURCE_KEYS = 100;

/** Placeholder-list join separator. Written as an escape so no invisible control
 * character lands in this file — the previous revision embedded a raw NUL byte
 * here, which made the whole script read as binary to grep. */
const UNIT_SEP = '\u001f';

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

// ---------------------------------------------------------------- table shapes

/** Cells of a markdown table row. Leading/trailing pipes are structure, not data. */
function splitRow(line) {
    const t = line.trim();
    const inner = t.slice(1, t.endsWith('|') ? -1 : undefined);
    return inner.split('|').map((c) => c.trim());
}

const isSeparatorRow = (cells) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));

/**
 * Read the ONE table anchored to the marker on line `i`.
 *
 * "Anchored" is the whole contract: the first non-blank line after the marker
 * must be the header, the line after that must be the separator, and the table
 * ends at the first line that is not a row. Nothing is searched for further
 * down the document, so a marker can never adopt an unrelated table.
 *
 * @returns {{header: string[], rows: string[][], headerLine: number} | null}
 */
export function readMarkedTable(lines, i, marker, where, fail) {
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j >= lines.length || !lines[j].trim().startsWith('|')) {
        fail(`${where}: the first non-blank line after <!-- ${marker} --> is not a table header `
            + `(saw ${j >= lines.length ? 'end of file' : `"${lines[j].trim().slice(0, 60)}"`}). `
            + `A marker must sit directly above the table it marks — otherwise it adopts whatever table comes next.`);
        return null;
    }
    const header = splitRow(lines[j]);
    if (j + 1 >= lines.length || !isSeparatorRow(splitRow(lines[j + 1]))) {
        fail(`${where}: the line after the table header is not a |---|---| separator.`);
        return null;
    }
    const rows = [];
    for (let k = j + 2; k < lines.length; k++) {
        if (!lines[k].trim().startsWith('|')) break;
        const cells = splitRow(lines[k]);
        if (isSeparatorRow(cells)) {
            fail(`${where}: a second separator row inside the table at line ${k + 1} — two tables ran together.`);
            return null;
        }
        if (cells.length !== header.length) {
            fail(`${where}: row at line ${k + 1} has ${cells.length} column(s), header declares ${header.length}. `
                + `"${lines[k].trim().slice(0, 80)}"`);
            return null;
        }
        rows.push(cells);
    }
    if (rows.length === 0) {
        fail(`${where}: the marked table has zero data rows — a table that yields nothing enforces nothing.`);
        return null;
    }
    return { header, rows, headerLine: j };
}

function requireHeader(header, canonical, where, fail) {
    if (header.length === canonical.length && header.every((c, n) => c === canonical[n])) return true;
    fail(`${where}: table header is [${header.join(' | ')}], expected exactly [${canonical.join(' | ')}]. `
        + `Columns are bound by name, so a table with different headings is a different table — `
        + `rename the columns or remove the marker.`);
    return false;
}

// --------------------------------------------------------- prose in the "Never" column

/**
 * A banned "term" is a word or a short phrase. Prose that lands in this column —
 * which is what happens when a marker adopts a table whose third column is
 * "Why" — compiles into a junk regex that matches nothing AND pads the term
 * count, so a poisoned table can look healthier than a real one.
 */
export function proseComplaint(term) {
    if (term.length > 40) return 'longer than 40 characters';
    if (term.split(/\s+/).length > 4) return 'more than four words';
    const punct = term.match(/[—–:;()"“”]/);
    if (punct) return `contains ${JSON.stringify(punct[0])}, which no banned word contains`;
    if (/\.(?!$)/.test(term)) return 'contains a mid-string period';
    if (/\.$/.test(term) && term.length > 6) return 'ends in a period — that is a sentence, not a term';
    return null;
}

// ------------------------------------------------------------------- the parser

/**
 * Parse the glossary into sections, banned terms, do-not-translate literals and
 * declared divergences. `fail` is called for every structural problem found;
 * the caller decides what to do with a partial result (nothing — it exits).
 */
export function parseGlossary(text, fail) {
    const lines = text.split('\n');
    // Anchored to a whole LINE, not searched for anywhere in the text. This
    // document explains its own markers, so `<!-- gate:divergence -->` appears
    // inside backticks in the prose near the top; a loose `.exec(text)` finds
    // that mention first and reads the paragraph after it as the divergence
    // list, silently yielding zero declared divergences.
    const termMarker = /^\s*<!--\s*gate:terms\s*-->\s*$/;
    const literalMarker = /^\s*<!--\s*gate:literal\s*-->\s*$/;
    const divergenceMarker = /^\s*<!--\s*gate:divergence\s*-->\s*$/;
    let divergenceLine = -1;

    /** @type {Map<string, {rows: {english:string,approved:string,never:string}[], banned: {term:string,approved:string,english:string,section:string}[]}>} */
    const sections = new Map();
    const literals = [];
    let literalMarkers = 0;
    let divergenceMarkers = 0;
    let heading = '(before the first heading)';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const h = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
        if (h) { heading = h[1]; continue; }

        if (termMarker.test(line)) {
            const where = `gate:terms under "${heading}" (line ${i + 1})`;
            const table = readMarkedTable(lines, i, 'gate:terms', where, fail);
            if (!table) continue;
            if (!requireHeader(table.header, TERM_HEADER, where, fail)) continue;
            if (sections.has(heading)) {
                fail(`${where}: a second gate:terms table under the heading "${heading}". `
                    + `The baseline is keyed by heading, so two tables cannot share one — give the section its own heading.`);
                continue;
            }
            const rows = [];
            const banned = [];
            for (const cells of table.rows) {
                const [english, approved, never] = cells;
                if (!english) { fail(`${where}: a row has an empty English column.`); continue; }
                if (!approved || approved === '—' || approved === '-') {
                    fail(`${where}: row "${english}" has no approved es-419 value. `
                        + `A term row exists to fix one equivalent; a row without one decides nothing.`);
                    continue;
                }
                rows.push({ english, approved, never });
                if (!never || never === '—' || never === '-') continue;
                for (const raw of never.split(',')) {
                    const term = raw.trim().replace(/^[*_`]+|[*_`]+$/g, '').trim();
                    if (!term) continue;
                    const complaint = proseComplaint(term);
                    if (complaint) {
                        fail(`${where}: "${term.slice(0, 60)}" in the Never column of row "${english}" is ${complaint}. `
                            + `Prose here becomes a regex that matches nothing and still counts toward the section's floor.`);
                        continue;
                    }
                    banned.push({ term, approved, english, section: heading });
                }
            }
            sections.set(heading, { rows, banned });
            continue;
        }

        if (literalMarker.test(line)) {
            literalMarkers++;
            const where = `gate:literal under "${heading}" (line ${i + 1})`;
            const table = readMarkedTable(lines, i, 'gate:literal', where, fail);
            if (!table) continue;
            if (!requireHeader(table.header, LITERAL_HEADER, where, fail)) continue;
            for (const cells of table.rows) {
                const literal = cells[0].replace(/^`+|`+$/g, '');
                if (!literal) { fail(`${where}: a row has an empty Literal column.`); continue; }
                if (literals.some((l) => l.literal === literal)) {
                    fail(`${where}: "${literal}" is listed twice.`);
                    continue;
                }
                literals.push({ literal, where: cells[1] });
            }
            continue;
        }

        if (divergenceMarker.test(line)) { divergenceMarkers++; if (divergenceLine < 0) divergenceLine = i; }
    }

    // Keys allowed to break the consistency rule, declared as list items under
    // the marker line found above.
    const divergence = new Set();
    if (divergenceLine >= 0) {
        for (let i = divergenceLine + 1; i < lines.length; i++) {
            const l = lines[i].trim();
            if (/^#{1,6}\s/.test(l)) break;
            if (!l.startsWith('-')) continue;
            for (const k of l.matchAll(/`([a-z0-9_]+)`/g)) divergence.add(k[1]);
        }
    }

    if (literalMarkers !== 1) {
        fail(`expected exactly one <!-- gate:literal --> marker, found ${literalMarkers}. `
            + `The do-not-translate literals are one table on purpose.`);
    }
    if (divergenceMarkers !== 1) {
        fail(`expected exactly one <!-- gate:divergence --> marker, found ${divergenceMarkers}.`);
    }

    // Marker count must equal table count: a marker that produced nothing above
    // already failed, but say it plainly rather than leaving it to a row floor.
    const termMarkers = lines.filter((l) => termMarker.test(l)).length;
    if (termMarkers !== sections.size) {
        fail(`${termMarkers} gate:terms marker(s) but ${sections.size} table(s) parsed — `
            + `at least one marker did not yield a table (see the errors above).`);
    }

    const banned = [...sections.values()].flatMap((s) => s.banned);

    // A banned term that is somebody's approved translation bans the catalogue's
    // own correct answer. This is how one stray marker banned `Empresa` across
    // 99 keys, and it is the check that makes the approved column load-bearing.
    const approvedForms = new Map();
    for (const [name, s] of sections) {
        for (const row of s.rows) {
            for (const part of row.approved.split(/[,/]/)) {
                const p = norm(part.trim().replace(/^[*_`]+|[*_`]+$/g, '').trim());
                if (p) approvedForms.set(p, `"${row.english}" under "${name}"`);
            }
        }
    }
    for (const b of banned) {
        const owner = approvedForms.get(norm(b.term));
        if (owner) {
            fail(`"${b.term}" is banned by row "${b.english}" under "${b.section}", but it is also the `
                + `APPROVED translation for ${owner}. One of the two rows is wrong — a banned term can never `
                + `be an approved term, and shipping this would fail every key that uses the correct word.`);
        }
    }

    return { sections, banned, literals, divergence, termMarkers };
}

// ------------------------------------------------------------------- catalogue

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

/** One regex per banned term: whole word, optional Spanish plural, spaces loose. */
export function bannedMatcher(term) {
    const escaped = norm(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:e?s)?(?![\\p{L}\\p{N}])`, 'u');
}

// ------------------------------------------------------------------- baseline

/** Snapshot shape mirrors scripts/file-size-baseline.json: plain counts, sorted, ratcheted. */
export function buildBaseline({ sections, literals, divergence }) {
    const out = {};
    for (const name of [...sections.keys()].sort()) {
        const s = sections.get(name);
        out[name] = { rows: s.rows.length, banned: s.banned.length };
    }
    return { sections: out, literals: literals.length, divergences: divergence.size };
}

/**
 * Ratchet, in the direction the glossary is supposed to move. Growth is fine and
 * only prints a hint; SHRINKING is the failure, because every way this gate has
 * ever gone quiet was a table getting smaller or disappearing.
 */
export function diffBaseline(current, baseline) {
    const violations = [];
    const loosened = [];
    for (const [name, want] of Object.entries(baseline.sections ?? {})) {
        const got = current.sections[name];
        if (!got) {
            violations.push(`section "${name}" is gone from the glossary (baselined at ${want.rows} row(s), `
                + `${want.banned} banned term(s)). Deleting a whole section is exactly the change a global floor missed.`);
            continue;
        }
        if (got.rows < want.rows) violations.push(`section "${name}": ${got.rows} row(s), baseline ${want.rows}.`);
        if (got.banned < want.banned) violations.push(`section "${name}": ${got.banned} banned term(s), baseline ${want.banned}.`);
        if (got.rows > want.rows || got.banned > want.banned) loosened.push(name);
    }
    for (const name of Object.keys(current.sections)) {
        if (!(name in (baseline.sections ?? {}))) loosened.push(`${name} (new)`);
    }
    if (current.literals < (baseline.literals ?? 0)) {
        violations.push(`${current.literals} do-not-translate literal(s), baseline ${baseline.literals}.`);
    } else if (current.literals > (baseline.literals ?? 0)) loosened.push('literals');
    if (current.divergences < (baseline.divergences ?? 0)) {
        violations.push(`${current.divergences} declared divergence(s), baseline ${baseline.divergences}.`);
    } else if (current.divergences > (baseline.divergences ?? 0)) loosened.push('divergences');
    return { violations, loosened };
}

// ------------------------------------------------------------------------ main
const _scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').toLowerCase();
const _argv1 = (process.argv[1] ?? '').replace(/\\/g, '/').toLowerCase();
if (_scriptPath === _argv1 || _argv1.endsWith('/check-i18n-glossary.mjs')) {
    let failed = false;
    const fail = (msg) => { failed = true; console.error(`[i18n-glossary] ${msg}`); };

    if (!existsSync(GLOSSARY)) {
        console.error('[i18n-glossary] docs/developers/i18n-glossary.md is missing — the gate has nothing to enforce.');
        console.error('[i18n-glossary] FAIL');
        process.exit(1);
    }

    const parsed = parseGlossary(readFileSync(GLOSSARY, 'utf8'), fail);
    const { sections, banned, literals, divergence } = parsed;
    const current = buildBaseline(parsed);

    if (process.argv.includes('--update')) {
        if (failed) {
            console.error('[i18n-glossary] refusing to write a baseline from a glossary that did not parse cleanly. '
                + 'Fix the errors above first — freezing a broken parse is how a floor ends up calibrated to the damage.');
            process.exit(1);
        }
        writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
        console.log(`Updated scripts/i18n-glossary-baseline.json: ${Object.keys(current.sections).length} section(s), `
            + `${current.literals} literal(s), ${current.divergences} divergence(s).`);
        process.exit(0);
    }

    if (!existsSync(BASELINE)) {
        fail('scripts/i18n-glossary-baseline.json is missing — run `node scripts/check-i18n-glossary.mjs --update`.');
    } else {
        const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
        const { violations, loosened } = diffBaseline(current, baseline);
        for (const v of violations) fail(`baseline: ${v}`);
        if (violations.length) {
            console.error('[i18n-glossary] The glossary shrank. If the removal is intended, run '
                + '`node scripts/check-i18n-glossary.mjs --update` and commit the baseline with the change.');
        }
        if (loosened.length && !violations.length) {
            console.log(`[i18n-glossary] ${loosened.length} section(s)/counter(s) grew — run `
                + '`node scripts/check-i18n-glossary.mjs --update` to tighten the ratchet.');
        }
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

    // -------------------------------------------------------- 1. banned terms
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

    // --------------------------------------------------------- 2. consistency
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

    // -------------------------------------------------------- 3. placeholders
    const holders = (s) => [...s.matchAll(/\{([^}]*)\}/g)].map((x) => x[1].trim()).sort();
    for (const [key, { value, file }] of Object.entries(target)) {
        if (!(key in source)) continue;             // stale keys are check-i18n-catalog's job
        const want = holders(source[key].value);
        const got = holders(value);
        // Join on U+001F, not a space: a placeholder name may contain spaces, and
        // joining on one would make ['a b'] and ['a','b'] compare equal.
        if (want.join(UNIT_SEP) === got.join(UNIT_SEP)) continue;
        fail(`${file} · ${key}: placeholders changed in translation — [${want.join(', ')}] became [${got.join(', ')}].`
            + ` The call site passes the English set; a rename or a drop breaks it.`);
    }

    // ------------------------------------------- 4. do-not-translate literals
    for (const { literal, where } of literals) {
        const bearing = Object.keys(source).filter((k) => source[k].value.includes(literal));
        if (bearing.length === 0) {
            fail(`gate:literal lists "${literal}" (${where}), which appears in no messages/${SOURCE_LOCALE} value. `
                + `A literal nothing contains protects nothing — fix the spelling or drop the row.`);
            continue;
        }
        for (const key of bearing) {
            const t = target[key];
            if (!t || t.value.trim() === '') continue;   // untranslated falls back to English
            if (t.value.includes(literal)) continue;
            fail(`${t.file} · ${key}: "${literal}" must survive translation byte-identical (${where}), but the `
                + `es-419 value does not contain it.\n      en:     "${source[key].value}"\n      es-419: "${t.value}"`);
        }
    }

    if (failed) {
        console.error('[i18n-glossary] FAIL — see docs/developers/i18n-glossary.md.');
        process.exit(1);
    }
    const translated = sourceKeys.filter((k) => k in target && target[k].value.trim() !== '').length;
    const termRows = Object.values(current.sections).reduce((a, s) => a + s.rows, 0);
    console.log(`[i18n-glossary] OK — ${sections.size} section(s), ${termRows} term row(s), ${banned.length} banned term(s), `
        + `${literals.length} protected literal(s), ${divergence.size} declared divergence(s); `
        + `checked ${translated} translated key(s) of ${sourceKeys.length}.`);
}
