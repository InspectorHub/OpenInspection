#!/usr/bin/env node
/**
 * Unread-field census — fields the PRODUCT declares, fills, and never reads.
 *
 * ## The blind spot this closes
 *
 * `lint:unwired` asks whether the running product can reach a MODULE. It is a
 * good question and it is answered at file granularity, which means it could
 * never have caught the defect that prompted this gate.
 *
 * `EmbedData.siteKey` was declared on an interface, populated by the embed
 * loader from `resolveTurnstileSiteKey`, handed to the component that renders
 * the embedded booking form — and read by nobody. The form posted
 * `turnstileToken: fd.get("cf-turnstile-response")`, always null, because no
 * widget had ever written that input. Meanwhile `admitBooking` refused every
 * tokenless booking on saas. The embedded booking form took no bookings at all,
 * and the file holding the dead field is a route the product renders every time
 * someone opens it — perfectly reachable, and therefore invisible to `unwired`.
 *
 * ## The question this asks
 *
 * For every property of every object type declared under `app/`, `server/` and
 * `packages/`: does any NON-TEST source read it? A field nothing reads is
 * either debt or a defect, and this repo's ledger says the second often enough
 * to be worth a gate.
 *
 * "Non-test" is load-bearing and is the same choice `lint:unwired` makes. A
 * field kept alive only by its own spec is precisely the shape being hunted:
 * `TemplateSchema.schemaVersion` is declared in three separate type files and
 * every mention outside those declarations is in a `.test.` file.
 *
 * ## What this gate cannot do
 *
 * It matches on NAME, not on type. A dead `Foo.name` is masked by every other
 * `.name` in the tree, so this UNDER-REPORTS. That is deliberate: the exact
 * question ("who reads this symbol") needs a TypeScript program, and a
 * type-aware pass is the one thing this repo has measured as unaffordable
 * locally — it is why type-aware eslint does not run here. Under-reporting is
 * the safe direction for a census; over-reporting is what gets a gate switched
 * off.
 *
 * It also cannot tell a field kept for a caller that does not exist yet from
 * one nobody ever wired. Only the reason string distinguishes those, and a
 * person writes that. The gate checks a reason EXISTS; it cannot check it is
 * true.
 *
 * ## How the instrument was checked, before its output was believed
 *
 * Against the tree with `EmbedData.siteKey` restored to its pre-fix state it
 * reported that field, at the right file and line. Against the fixed tree it
 * does not, and the total moves by exactly one. A census nobody has red/green
 * tested is a number, not a measurement.
 *
 * Five passes of precision work came out of that, each one measured rather than
 * guessed. 211 findings with a line-based body scan; 141 once the body is taken
 * by matching braces (the line-based one walked off the end of a type and
 * reported the following function's PARAMETERS as its fields); 103 once types
 * whose keys are enumerated are excused; 95 once `scripts/` counts as a place a
 * field can be read from.
 *
 * The last two went the OTHER WAY, and that is the more useful half. Excluding
 * prose took the count UP, 95 -> 98, because this file's own header had been
 * counting as a read of the fields it names as examples. Reading the working
 * tree rather than the index fixed a blindness to files not yet `git add`-ed —
 * caught when a component was written to consume a flagged field and the count
 * did not move. A census that only ever falls is not being corrected.
 *
 *   node scripts/check-unread-fields.mjs            # gate
 *   node scripts/check-unread-fields.mjs --update   # re-take the census
 *   node scripts/check-unread-fields.mjs --list     # print findings, exit 0
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declaredProperties } from './lib/type-properties.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'unread-fields-baseline.json');
const UPDATE = process.argv.includes('--update');
const LIST = process.argv.includes('--list');

/** Long enough that "todo" and "n/a" do not pass for an explanation. */
const MIN_REASON_CHARS = 20;

/** The categories a census entry may carry. A free-text kind is how "dead" and
 *  "deliberate" stop being countable. */
const KINDS = new Set([
    // Read by something this name-based scan cannot see: a dynamic access, a
    // spread into another shape, JSON serialisation, a non-TypeScript consumer.
    'invisible-read',
    // A wire contract: the field exists because a third party or a stored
    // payload has it, whether or not this codebase reads it back.
    'wire-shape',
    // Written down in order TO BE written down — a compliance classification, an
    // approval, a citation, a jurisdiction fact and the date it was checked.
    // Its readers are people and review, and code never having an opinion on it
    // is the design rather than a gap.
    //
    // ⚠️ NOT a softer `deferred`. The test is whether a reader could name who
    // consults it and when. "We might need it later" is `deferred`; "it is
    // signed off in review and read in an audit" is a record.
    'record',
    // Nobody wired it. Work owed. Counted separately on every run.
    'deferred',
]);

/* ------------------------------------------------------------------ */
/*  Sources                                                            */
/* ------------------------------------------------------------------ */

// `--others --exclude-standard` alongside the tracked list, because a file that
// has not been `git add`-ed yet is still part of the working tree this gate is
// asked about. Without it a brand-new module's READS are invisible (the census
// over-reports the moment you write the consumer) and its own DECLARATIONS are
// unscanned (a new dead field is not caught until it is staged) — measured the
// first time a component was written to consume a flagged field and the count
// did not move.
const FILES = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'app', 'server', 'packages'], {
    encoding: 'utf8',
    cwd: ROOT,
})
    .split('\n')
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f))
    .filter((f) => !/(^|\/)__tests__\//.test(f))
    .filter((f) => !f.startsWith('app/paraglide/'))
    .filter((f) => !f.endsWith('.d.ts'));

/**
 * Modules `lint:unwired` already owns.
 *
 * A field in a module the product cannot reach is not a second finding — it is
 * the same one, counted once per property, split across two baselines so that
 * connecting the module would have to be signed off twice. `subtype-specials.ts`
 * and `system-coverage.ts` were being reported here while sitting in the
 * unwired census, and the finer grain actively misled: seeing only
 * `SubtypeSpecialMounts.subItemIds` flagged (its sibling `sectionIds` is a
 * common name read elsewhere, so the name scan could not see it) reads as
 * "mounting a special drops its sub-items" when the truth is that nothing
 * mounts anything.
 *
 * One module, one entry, one decision. This gate asks its question only of
 * files the other gate says the product can reach.
 */
const UNWIRED_MODULES = new Set(
    existsSync(join(ROOT, 'scripts', 'unwired-baseline.json'))
        ? Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts', 'unwired-baseline.json'), 'utf8')))
        : [],
);

const SRC = new Map(
    FILES.filter((f) => !UNWIRED_MODULES.has(f)).map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]),
);

/**
 * Extra places a field can be READ from, which declare none of their own.
 *
 * The compliance manifests are the reason. `ErasureRule.biometricStatus`,
 * `RetentionPolicyHeader.approvedBy` and their neighbours are written by hand
 * in TypeScript and consumed by the gates under `scripts/` — `check-erasure-
 * manifest.mjs`, `check-retention-policy.mjs` and friends. A field a gate reads
 * on every commit is not an unread field, and a census that called twenty of
 * them dead would have been teaching people to ignore it.
 */
const READ_ONLY_CORPUS = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'scripts', 'workers'], {
    encoding: 'utf8',
    cwd: ROOT,
})
    .split('\n')
    .filter((f) => /\.(mjs|js|ts)$/.test(f))
    .filter((f) => !/\.(test|spec)\./.test(f));

/**
 * Prose is not a read.
 *
 * Caught by this gate turning on itself: the header above names
 * `TemplateSchema.schemaVersion`, `ErasureRule.biometricStatus` and
 * `RetentionPolicyHeader.approvedBy` as EXAMPLES of what it hunts, and once
 * this file was tracked under `scripts/` it began counting its own
 * documentation as evidence that those fields are used. Seven findings
 * disappeared for no reason but that. A comment mentioning `.foo` HIDES a real
 * finding, which is the expensive direction to be wrong in.
 *
 * A comment is recognised only when it OPENS ITS OWN LINE, block or line alike.
 * The obvious regex form is worse than no stripping at all: a string literal
 * like `"/api/platform/*"` opens a block comment that runs to the next close,
 * and it ate 6108 of `workers/app.ts`'s 15732 characters — 39% of a file,
 * silently, taking a real `.hasPortalIntegrationApi` read with it and reporting
 * that field as unread. Deleting code from the corpus is the same error as
 * counting prose, in the same direction: it invents findings.
 */
function withoutComments(src) {
    const out = [];
    let inBlock = false;
    for (const line of src.split('\n')) {
        const t = line.trimStart();
        if (inBlock) {
            if (line.includes('*/')) inBlock = false;
            out.push('');
            continue;
        }
        if (t.startsWith('/*')) {
            if (!line.includes('*/')) inBlock = true;
            out.push('');
            continue;
        }
        out.push(t.startsWith('//') ? '' : line);
    }
    return out.join('\n');
}

const READERS = new Map([
    ...[...SRC].map(([f, src]) => [f, withoutComments(src)]),
    ...READ_ONLY_CORPUS.map((f) => [f, withoutComments(readFileSync(join(ROOT, f), 'utf8'))]),
]);
/* ------------------------------------------------------------------ */
/*  Declarations                                                       */
/* ------------------------------------------------------------------ */

const declared = declaredProperties(SRC);

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

/**
 * Every shape that counts as READING a property. Anything missing from this
 * list becomes a false positive, so it is generous on purpose — a census that
 * cries wolf is one nobody reads.
 */
function isRead(prop) {
    const patterns = [
        new RegExp(`\\.${prop}\\b`),                                   // obj.prop
        new RegExp(`\\[\\s*["'\`]${prop}["'\`]\\s*\\]`),               // obj["prop"]
        new RegExp(`\\{[^{}]*\\b${prop}\\b[^{}]*\\}\\s*(?::|=[^=])`),  // destructuring
        new RegExp(`\\b${prop}\\s*=\\s*[{"'\`]`),                      // JSX prop={…} / prop="…"
        new RegExp(`\\b${prop}\\s*,`),                                 // shorthand in a destructure list
    ];
    for (const [, src] of READERS) for (const re of patterns) if (re.test(src)) return true;
    return false;
}

/**
 * Types whose KEYS are enumerated, whose fields therefore cannot be judged by
 * name at all.
 *
 * `preset-tokens.ts` is the clearest case: `for (const key of
 * Object.keys(TOKEN_MAP) as (keyof PresetTokenMap)[])` reads all twenty-odd of
 * them through a key map, so every single one looks dead to a scan that hunts
 * for `.headingWeight`. `Required<StyleTokens>` says the same thing about the
 * server-side twin. Reporting those is not under-reporting, it is noise, and
 * noise is what gets a gate switched off.
 *
 * `keyof T`, `Required<T>` and `Partial<T>` are all declarations that the type
 * is handled as a whole. One of them anywhere in non-test source excuses the
 * whole type.
 */
const ENUMERATED = new Set();
for (const [, src] of SRC) {
    for (const m of src.matchAll(/\bkeyof\s+(\w+)/g)) ENUMERATED.add(m[1]);
    for (const m of src.matchAll(/\b(?:Required|Partial|Readonly)<\s*(\w+)\s*>/g)) ENUMERATED.add(m[1]);
}

const seen = new Map();
const findings = [];
for (const d of declared) {
    if (ENUMERATED.has(d.type)) continue;
    if (!seen.has(d.prop)) seen.set(d.prop, isRead(d.prop));
    if (!seen.get(d.prop)) findings.push(d);
}
findings.sort((a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`));

/** Keyed by identity, not by line: an edit above a field must not re-flag it. */
const keyOf = (f) => `${f.file}#${f.type}.${f.prop}`;

/* ------------------------------------------------------------------ */
/*  Report                                                             */
/* ------------------------------------------------------------------ */

// Zero of anything here means the reader is broken, not that the repo is clean.
if (SRC.size === 0 || declared.length === 0) {
    console.error(
        `unread-fields: read ${SRC.size} files and ${declared.length} declared properties — `
        + 'the reader is broken, not the repo.',
    );
    process.exit(1);
}

if (LIST) {
    for (const f of findings) console.log(`${f.file}:${f.line}  ${f.type}.${f.prop}`);
    console.log(`\nscanned ${SRC.size} files · ${declared.length} properties · ${findings.length} unread`);
    process.exit(0);
}

/**
 * The reason a census entry carries, DERIVED rather than typed.
 *
 * Ninety-odd hand-written sentences is the debt this gate exists to expose, not
 * a record of it — nobody checks them and they rot. So a new entry's reason
 * states the evidence: where else in the tree the name appears at all, split
 * into product code and tests. A reader can disagree with the conclusion and
 * re-check the fact in one grep.
 */
function evidenceFor(f) {
    let mentions = [];
    try {
        mentions = execFileSync('git', ['grep', '-l', '--', f.prop, 'app', 'server', 'scripts', 'tests', 'packages'],
            { encoding: 'utf8', cwd: ROOT }).split('\n').filter(Boolean);
    } catch { /* the declaration is the only mention */ }
    const others = mentions.filter((m) => m !== f.file);
    const tests = others.filter((m) => /(\.test\.|\.spec\.|^tests\/|__tests__)/.test(m));
    const prod = others.filter((m) => !tests.includes(m));
    const list = (xs) => `${xs.slice(0, 3).join(', ')}${xs.length > 3 ? ` +${xs.length - 3}` : ''}`;

    if (prod.length === 0 && tests.length > 0) {
        return `Written but never read: outside ${f.file} the name appears only in tests (${list(tests)}).`;
    }
    if (prod.length === 0) {
        return `Declared in ${f.file} and mentioned nowhere else in app/, server/, scripts/ or tests/.`;
    }
    return `Written in ${list(prod)}, and read by nothing — every mention there sets it or types it.`;
}

if (UPDATE) {
    const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const next = {};
    for (const f of findings) {
        next[keyOf(f)] = prev[keyOf(f)] ?? { kind: 'deferred', reason: evidenceFor(f) };
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    const dropped = Object.keys(prev).filter((k) => !(k in next));
    console.log(
        `unread-fields: census re-taken — ${findings.length} entries`
        + `${dropped.length ? `, ${dropped.length} dropped (fixed or gone)` : ''}`,
    );
    process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
const errors = [];

for (const [key, entry] of Object.entries(baseline)) {
    if (!KINDS.has(entry.kind)) {
        errors.push(`baseline ${key}: kind "${entry.kind}" is not one of ${[...KINDS].join(', ')}`);
    }
    if (!entry.reason || entry.reason.length < MIN_REASON_CHARS) {
        errors.push(`baseline ${key}: reason is missing or too short to be an explanation`);
    }
}

const fresh = findings.filter((f) => !(keyOf(f) in baseline));
for (const f of fresh) {
    errors.push(
        `${f.file}:${f.line}  ${f.type}.${f.prop} — declared and filled, read by nothing outside tests. `
        + 'Wire it, delete it, or add it to the baseline with a reason.',
    );
}

const stale = Object.keys(baseline).filter((k) => !findings.some((f) => keyOf(f) === k));
const deferred = Object.values(baseline).filter((e) => e.kind === 'deferred').length;

// Both numbers print on every run, pass or fail. A gate that speaks only when
// it is angry cannot be checked on the day it is quiet.
console.log(
    `unread-fields: ${declared.length} properties in ${SRC.size} files · ${findings.length} unread `
    + `· ${Object.keys(baseline).length} baselined (${deferred} still owed) · ${fresh.length} new`,
);
if (stale.length) {
    console.log(`  ${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} now read — drop with --update:`);
    for (const s of stale) console.log(`    ${s}`);
}

if (errors.length) {
    console.error(`\n✘ Unread-field gate — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
}
console.log('✅ Unread-field gate — no field is declared, filled and then read by nothing.');
