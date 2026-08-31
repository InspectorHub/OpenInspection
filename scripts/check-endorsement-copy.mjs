#!/usr/bin/env node
/**
 * Implied-endorsement policy gate for statutory-form copy.
 *
 * ── The risk this guards is not copyright ───────────────────────────────────
 * Rendering an authority's own published form is settled: the output IS their
 * document, filled in (`server/lib/statutory/render.ts`). What is NOT settled,
 * and what no other gate here looks at, is the sentence NEXT to it. "OIR-
 * approved", "approved by the Florida Office of Insurance Regulation",
 * "state-certified form" — each converts "we print the agency's form" into "the
 * agency approved OUR rendering", which is a claim about a third party that
 * nobody at that agency ever made.
 *
 * The distinction is one word wide and it is invisible from inside the feature:
 * every assertion about a rendered form still passes, the PDF is still
 * byte-identical to the published substrate, and the copy beside it is still
 * wrong.
 *
 * ── One agency's name is not the rule ───────────────────────────────────────
 * The Florida OIR wind-mitigation form is the one this software is closest to
 * shipping, and it would be the obvious thing to hard-code. It is not hard-
 * coded, deliberately: a gate that knows one acronym goes quietly blind on the
 * day the subsystem grows a TREC form, a DBPR form or a form from an authority
 * in another country. So the rules below are shaped like the CLAIM — an
 * approval word attached to an authority — not like a name.
 *
 * ── What is permitted, and it matters that a lot is ─────────────────────────
 * Naming the authority is fine and often required: "the Office of Insurance
 * Regulation publishes this form". Naming the form, including by its own
 * agency-issued number ("OIR-B1-1802"), is fine — a form number is an identifier,
 * not an endorsement. And the DENIAL of the claim is the opposite of making it,
 * so "this rendering is not approved or endorsed by the …" must stay writable:
 * a gate that flags the disclaimer teaches authors to delete the disclaimer.
 * Matches are therefore evaluated per CLAUSE and skipped where the clause is
 * negated, exactly as `check-verification-copy.mjs` does.
 *
 * ── Scope: string literals only, never prose ────────────────────────────────
 * Three groups, in `SCOPES` below: the message catalogues in every locale, the
 * seed templates (where a statutory form's own name and blurb are written), and
 * the statutory subsystem's sources. From the .ts sources only STRING LITERALS
 * are read, with comments stripped first — this repository has repeatedly
 * watched a content-matching gate fire on the comment EXPLAINING the rule,
 * and the sentence "do not claim the agency approved this" necessarily contains
 * the claim.
 *
 * Usage: node scripts/check-endorsement-copy.mjs [--self-test]
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/**
 * Strings that are the AUTHORITY'S OWN WORDS, transcribed from its published
 * form, rather than copy this software wrote about itself.
 *
 * ── Why the rules cannot simply be narrowed instead ─────────────────────────
 * The policy this gate enforces is about the sentence NEXT to the form: a claim
 * that an agency approved OUR rendering. A question's `description` that is the
 * form's own instruction text is not next to the form; it IS the form, and the
 * rest of the statutory subsystem exists to reproduce it verbatim
 * (`lint:statutory-fidelity`, and a signed field map behind it). Editing one to
 * please a gate would print an instruction the authority never printed, which
 * is the fault the whole subsystem is built to prevent.
 *
 * And these WILL keep arriving. An agency's own form text routinely puts an
 * approval word beside an institution — Florida's Q9 names the "product
 * approval system of the State of Florida", meaning the programme that approves
 * BUILDING PRODUCTS, a different subject entirely. Four forms ship today and
 * more are coming; a per-clause patch each time would erode the rules until
 * they stopped catching the thing they exist for.
 *
 * ── Fail-closed, three ways ────────────────────────────────────────────────
 * An exemption pinned only to a path would silently cover whatever that path
 * later held. So each entry names the exact bytes:
 *
 *   1. the string must still EXIST at that path            — else FAIL (stale)
 *   2. its sha256 must still match                         — else FAIL (edited)
 *   3. it must still produce at least one hit              — else FAIL (moot)
 *
 * Rule 3 is the one that keeps this list honest: an exemption that has stopped
 * suppressing anything is a claim about the file that is no longer true, and
 * leaving it in place would quietly widen the next person's licence.
 */
const TRANSCRIPTIONS = [
    {
        file: 'server/data/seed-templates/fl-oir-b1-1802-rev-04-26.json',
        path: 'schema.sections[8].items[1].description',
        sha256: '54eafb0bb3d9c3ce9818e10853fd277594348eb4f4e81299cf86fd7c2734b18a',
        source: 'Florida OIR-B1-1802 Rev. 04/26, question 9 (Opening Protection), transcribed '
            + 'verbatim from the adopted form the Office publishes',
        why: 'Answers A and B both cite the "product approval system of the State of Florida or '
            + 'Miami-Dade County" — an approval word and an institution in one clause. The subject '
            + 'of that approval is a building product, not this software or its output, and the '
            + 'sentence is the authority\'s, printed on its own page.',
    },
];

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Where statutory-form copy can be written today.
 *
 * Each group is checked for emptiness SEPARATELY. A gate that only asks "did I
 * read anything at all" stays green when one of three groups moves or is
 * renamed, and reports the other two's clean result as the whole answer.
 */
const SCOPES = [
    { name: 'message catalogues', dir: 'messages', exts: ['.json'] },
    { name: 'seed templates', dir: 'server/data/seed-templates', exts: ['.json'] },
    { name: 'statutory subsystem', dir: 'server/lib/statutory', exts: ['.ts'] },
    { name: 'statutory services', dir: 'server/services/statutory', exts: ['.ts'] },
];

/**
 * An approval word. The claim is always one of these landing on an authority.
 *
 * Spanish is here for the same reason `check-verification-copy.mjs` carries it:
 * the catalogues are translated, and a translation states a claim more flatly
 * than the English it came from — an English gate would pass the one string
 * that actually says it.
 */
const APPROVAL = new RegExp(
    '\\b(approved|approval|endorsed|endorsement|endorses|certified|certifies|certification'
    + '|accredited|accreditation|sanctioned|authori[sz]ed|authori[sz]ation'
    + '|aprobad[oa]s?|aprobaci[oó]n|aprueba|avalad[oa]s?|aval|certificad[oa]s?|certifica'
    + '|acreditad[oa]s?|acreditaci[oó]n|autorizad[oa]s?|autorizaci[oó]n|homologad[oa]s?)\\b',
    'i',
);

/**
 * A public authority. Nouns, not names — an agency is recognised by what it is.
 *
 * `board of` / `office of` / `state of` carry the `of` on purpose. Bare "board"
 * is a product word here (a dashboard, a board of directors on a commercial
 * property record) and bare "state" is an address field; the possessive form is
 * what makes it an institution.
 */
const AUTHORITY = new RegExp(
    '\\b(office\\s+of|department\\s+of|division\\s+of|board\\s+of|bureau|commission'
    + '|regulator|regulatory\\s+\\w+|government|governmental|ministry|state\\s+of'
    + '|federal|municipal|county\\s+of'
    + '|oficina\\s+de|departamento\\s+de|junta\\s+de|comisi[oó]n|organismo|ministerio'
    + '|gobierno|estado\\s+de|regulador[a]?)\\b',
    'i',
);

/**
 * Each rule is a claim we are not entitled to make. `why` prints on a hit: a
 * gate that only says "banned" teaches nobody and is worked around with a
 * synonym.
 *
 * `test` takes the clause, so a rule may be a composition of vocabularies
 * rather than one regex. The composition rules are the ones that survive the
 * subsystem growing a second agency.
 */
const BANNED = [
    {
        id: 'acronym-approval',
        // Case-sensitive on the acronym, and the hyphen is required. `OIR-B1-1802`
        // is a form NUMBER and must never be touched; `OIR-approved` is a claim.
        test: (c) => /\b[A-Z]{2,6}-(approved|endorsed|certified|accredited|authori[sz]ed|sanctioned)\b/.test(c),
        why: 'an agency acronym hyphenated to an approval word states that the agency approved this rendering — '
            + 'it approved its own published form, which is a different thing and the only thing we may say',
    },
    {
        id: 'level-approval',
        test: (c) => /\b(state|federal|government|governmental|agency|county|municipal|officially)[-\s](approved|endorsed|certified|accredited|sanctioned)\b/i.test(c)
            || /\b(aprobad|certificad|avalad)[oa]s?\s+por\s+(el\s+|la\s+)?(estado|gobierno|organismo)\b/i.test(c),
        why: 'claims a level of government approved this — no government approved anything we produced',
    },
    {
        id: 'approval-by-authority',
        // The composition that has no name in it, and the reason this gate does
        // not go blind when the subsystem grows a second authority.
        test: (c) => APPROVAL.test(c) && AUTHORITY.test(c),
        why: 'puts an approval word and a public authority in one clause — the authority publishes the form; '
            + 'it has not reviewed, approved or endorsed what this software renders',
    },
    {
        id: 'official-artifact',
        test: (c) => /\b(this|our|the)\s+(is\s+the\s+)?official\s+(form|document|report|version|copy|rendering|submission|filing|pdf)\b/i.test(c)
            || /\bofficial\s+(form|document|version|copy|rendering)\b/i.test(c)
            || /\bformulario\s+oficial\b/i.test(c),
        why: 'calls the output the official document — the authority\'s published PDF is the official document; '
            + 'what leaves this software is that PDF with our values written onto it, which is not the same claim',
    },
];

/**
 * A DENIAL contains the words. "Not approved or endorsed by the Office of
 * Insurance Regulation" is precisely the sentence this policy wants written,
 * and the first shape of every gate like this flags it.
 *
 * Clause, not string: one sentence may disclaim while the next asserts.
 */
const NEGATORS = new RegExp(
    '\\b(not|never|neither|nor|without|no\\s+\\w+\\s+(has|have|is|are|was|were|may|can|will|ha|han)'
    + '|cannot|can\'t|isn\'t|aren\'t|doesn\'t|don\'t'
    + '|nunca|ning[uú]n|ninguna|sin\\s+|tampoco|no\\s+(ha|han|es|son|est[aá]|constituye|implica|significa))\\b',
    'i',
);

const clausesOf = (text) => text.split(/(?<=[.;:!?])\s+|\s+—\s+|\s+-\s+|\n+/);

function scanValue(v) {
    const out = [];
    for (const clause of clausesOf(v)) {
        if (NEGATORS.test(clause)) continue;   // a denial is not an assertion
        for (const rule of BANNED) if (rule.test(clause)) out.push(rule);
    }
    return out;
}

// ── Self-test. It runs before every normal scan, and is addressable alone ────
//
// MUST_FLAG is the claim in each disguise. MUST_NOT_FLAG is what the copy is
// supposed to look like instead, plus REAL strings from this repository that
// reuse one of the banned words in its ordinary product sense. A pattern that
// drifts in either direction turns a clean scan into a false green — and the
// second direction is the expensive one, because a gate that punishes the
// disclaimer teaches people to remove the disclaimer.
const MUST_FLAG = [
    'OIR-approved',
    'OIR-approved wind mitigation form',
    'TREC-approved report format',
    'DBPR-certified inspection record',
    'Approved by the Florida Office of Insurance Regulation',
    'This form is endorsed by the Office of Insurance Regulation.',
    'Certified by the Department of Business and Professional Regulation',
    'Accredited by the Board of Home Inspectors',
    'Reviewed and sanctioned by the commission',
    'State-approved wind mitigation form',
    'A government-endorsed inspection document',
    'Officially certified output',
    'This is the official form.',
    'Download the official version',
    'Aprobado por la Oficina de Regulación de Seguros de Florida',
    'Formulario aprobado por el estado',
    'Formulario oficial de mitigación de viento',
];
const MUST_NOT_FLAG = [
    // The honest disclaimers. Highest false-positive cost in the file.
    'This rendering is not approved or endorsed by the Florida Office of Insurance Regulation.',
    'No agency has approved, endorsed or certified this software or its output.',
    'Esta traducción no ha sido aprobada por ningún organismo público.',
    // Naming the authority, and naming the form, are both permitted and both
    // necessary. Only the approval claim is not.
    'The Office of Insurance Regulation publishes this form; this software fills it in.',
    'Published by the Florida Office of Insurance Regulation.',
    'Source: Texas Real Estate Commission, revision 7-6.',
    // The real seed-template string in this repository. A form NUMBER issued by
    // an agency is an identifier; treating it as a claim would make the correct
    // way to name a statutory form unwritable.
    'Florida-style Uniform Mitigation Verification (OIR-B1-1802) survey — captures features that '
    + 'may qualify the property for hurricane wind insurance discounts.',
    'Uniform Mitigation Verification Inspection Form OIR-B1-1802',
    // Real strings from these catalogues whose ordinary sense reuses a banned
    // word. Each is why the rule beside it is narrow rather than a bare grep.
    'Authorized representative *',
    'MCP clients (e.g. Claude) you\'ve authorized to access your data. Revoke access at any time.',
    'Could not complete Google Calendar authorization. Please try again.',
    'Connected — key is valid',
    'Certified Master Inspector',
    'Your inspector has approved this report.',
    'Approval required before sending',
    'State',
    'Board of directors',
];

const selfTestMissed = MUST_FLAG.filter((s) => scanValue(s).length === 0);
const selfTestOverreach = MUST_NOT_FLAG.filter((s) => scanValue(s).length > 0);
if (selfTestMissed.length || selfTestOverreach.length) {
    console.error('\n[endorsement-copy] BROKEN — the gate failed its own self-test.');
    for (const m of selfTestMissed) console.error(`   should have flagged: ${JSON.stringify(m)}`);
    for (const o of selfTestOverreach) console.error(`   wrongly flagged:     ${JSON.stringify(o)}`);
    console.error('\nA pattern drifted. Until it is fixed, a clean scan means nothing.\n');
    process.exit(1);
}

if (process.argv.slice(2).includes('--self-test')) {
    console.log(`\n[endorsement-copy] self-test OK — ${BANNED.length} rule(s), `
        + `${MUST_FLAG.length} must-flag + ${MUST_NOT_FLAG.length} must-not-flag, all correct.\n`);
    process.exit(0);
}

// ── The scan ────────────────────────────────────────────────────────────────

function walk(dir, exts, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, exts, out);
        else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
    }
    return out;
}

/** Every string leaf of a parsed JSON document, with a dotted path to it. */
function jsonStrings(node, path, out) {
    if (typeof node === 'string') { out.push({ path, value: node }); return out; }
    if (Array.isArray(node)) { node.forEach((v, i) => jsonStrings(v, `${path}[${i}]`, out)); return out; }
    if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) jsonStrings(v, path ? `${path}.${k}` : k, out);
    }
    return out;
}

const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** String literals from a .ts source, comments removed first. */
function tsStrings(src) {
    const code = stripComments(src);
    const out = [];
    const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
    let m;
    let n = 0;
    while ((m = re.exec(code)) !== null) {
        const raw = m[1] ?? m[2] ?? m[3] ?? '';
        n += 1;
        const value = raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ');
        if (value.trim() !== '') out.push({ path: `literal #${n}`, value });
    }
    return out;
}

const hits = [];
const groups = [];
let files = 0;
let strings = 0;

for (const scope of SCOPES) {
    const dir = join(ROOT, scope.dir);
    let scopeFiles = 0;
    let scopeStrings = 0;
    if (existsSync(dir) && statSync(dir).isDirectory()) {
        for (const file of walk(dir, scope.exts)) {
            scopeFiles += 1;
            const src = readFileSync(file, 'utf8');
            const values = file.endsWith('.json')
                ? jsonStrings(JSON.parse(src), '', [])
                : tsStrings(src);
            scopeStrings += values.length;
            const rel = relative(ROOT, file).replace(/\\/g, '/');
            for (const { path, value } of values) {
                const found = scanValue(value);
                if (found.length === 0) continue;
                // An exemption applies only where BOTH the path and the exact
                // bytes match. A path alone would cover whatever that path came
                // to hold later.
                const exempt = TRANSCRIPTIONS.find(
                    (t) => t.file === rel && t.path === path && t.sha256 === sha256(value),
                );
                if (exempt) { exempt.suppressed = (exempt.suppressed ?? 0) + found.length; continue; }
                for (const rule of found) {
                    hits.push({ file: rel, path, value, why: rule.why, id: rule.id });
                }
            }
        }
    }
    files += scopeFiles;
    strings += scopeStrings;
    groups.push({ ...scope, files: scopeFiles, strings: scopeStrings });
}

// Both numbers, always, per group — pass or fail. A gate that prints only its
// verdict cannot be checked on the day it is green, and this one EXPECTS zero
// hits forever, so "nothing wrong" and "looked at nothing" print the same word.
console.log(`\n[endorsement-copy] ${strings} string(s) in ${files} file(s) across ${groups.length} scope group(s); `
    + `${BANNED.length} rule(s); self-test ${MUST_FLAG.length} must-flag + ${MUST_NOT_FLAG.length} must-not-flag, all correct.`);
for (const g of groups) {
    console.log(`   ${g.files === 0 ? '✘' : '·'} ${g.name} (${g.dir}): ${g.files} file(s), ${g.strings} string(s)`);
}
console.log(`   · authority transcriptions exempted: ${TRANSCRIPTIONS.length} declared, `
    + `${TRANSCRIPTIONS.reduce((n, t) => n + (t.suppressed ?? 0), 0)} match(es) suppressed`);

// Zero examined is a hard failure, never a pass — and per GROUP, not only in
// total: two healthy groups would otherwise carry a third that had moved.
const blind = groups.filter((g) => g.files === 0 || g.strings === 0);
if (blind.length || files === 0 || strings === 0) {
    console.error(`\n[endorsement-copy] ${blind.length} scope group(s) resolved to nothing: `
        + `${blind.map((g) => g.dir).join(', ') || '(all empty)'}`);
    console.error('A scan of nothing is not a clean scan. The gate is looking in the wrong place.\n');
    process.exit(1);
}

if (hits.length) {
    console.error(`\n${hits.length} string(s) imply an authority approved what this software produces:\n`);
    for (const h of hits) {
        console.error(`   ${h.file} -> ${h.path}   [${h.id}]`);
        console.error(`     "${h.value}"`);
        console.error(`     ${h.why}\n`);
    }
    console.error('Name the authority and name the form. Do not attribute an approval to either.\n');
    process.exit(1);
}

// An exemption that suppressed nothing is a statement about this repository
// that has stopped being true. It is a failure, never a quiet pass — otherwise
// the list only ever grows and each stale line widens the next person's licence.
const moot = TRANSCRIPTIONS.filter((t) => !t.suppressed);
if (moot.length) {
    console.error(`\n${moot.length} declared transcription(s) suppressed nothing:\n`);
    for (const t of moot) {
        const full = join(ROOT, t.file);
        const reason = !existsSync(full)
            ? 'the file is gone'
            : 'the string moved, was edited (the sha256 no longer matches), or no longer trips a rule';
        console.error(`   ${t.file} -> ${t.path}\n     ${reason}`);
    }
    console.error('\nRe-point the entry at the bytes it means, or delete it. An exemption that');
    console.error('covers nothing is a licence nobody checked.\n');
    process.exit(1);
}

console.log('[endorsement-copy] OK — no copy attributes an approval of our output to an authority.\n');
