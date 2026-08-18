#!/usr/bin/env node
/**
 * lint:messaging-rules — the jurisdiction rules are data, and the data has to
 * be citable, resolvable, and actually consulted.
 *
 * `compliance/messaging-rules.jsonc` records what a message class owes in a
 * jurisdiction. Three things can go wrong with a file like that, and only one of
 * them is visible by reading it:
 *
 *   1. A RULE NOBODY CAN CITE. This is the one that has already cost this
 *      repository twice — a TCPA quiet-hours range written wider than the
 *      regulation's own scope, and Washington recorded as carrying a signature
 *      exemption it does not have. Both came from second-hand summaries. So
 *      every requirement must name a citation, every citation must say what was
 *      read (`verified_against`) and when (`checked_on`), and a claim that a
 *      STATUTE exempts or does not reach us may not rest on a summary at all.
 *   2. A RULE THE SEND PATH CANNOT RESOLVE. The register is a document; the
 *      Worker enforces a table in `server/lib/sms/send-gate.ts`, because a
 *      Worker has no filesystem. A rule in one and not the other is a rule that
 *      reads as live and is not, so all four values of every rule are compared
 *      in both directions.
 *   3. A RULE THE SEND PATH IGNORES. A requirement may claim
 *      `enforced_by: "send-gate"` only if the gate's own
 *      `GATE_ENFORCED_REQUIREMENTS` names it, and the gate must actually call
 *      `rulesFor` — a table nothing consults is decoration with a legal
 *      vocabulary.
 *
 * ── UNVERIFIED IS COUNTED, NOT HIDDEN ───────────────────────────────────────
 * An unverified statutory claim that reads as verified is worse than an absent
 * one, so the count is printed on EVERY run, verified and unverified side by
 * side, and each unverified citation is named rather than totalled. A
 * requirement resting on no primary text at all is named too, and must state the
 * question that would settle it. None of this is a failure: recording "nobody
 * has read this" is the correct move. Recording it invisibly is not.
 *
 * ── "A STATUTE EXEMPTS US" IS NOT "OUR ARCHITECTURE DOES NOT TRIGGER IT" ─────
 * The register keeps those in two different fields and this gate keeps them
 * apart: `basis_kind: "architecture"` must carry the engineering fact, and
 * `statutory_exception` / `statute_scope` must carry primary text. An
 * `architecture_note` is allowed alongside any basis — being stricter than the
 * law is normal — but it can never BE the basis.
 *
 * ── ZERO IS A FAILURE ───────────────────────────────────────────────────────
 * Zero rules, zero citations, zero entries in the send path's table, or zero
 * `rulesFor` consult sites all mean this gate is looking at the wrong thing.
 * Each prints what it scanned beside what it found and stops the build.
 *
 * Usage: node scripts/check-messaging-rules.mjs [--self-test]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTER = join(ROOT, 'compliance', 'messaging-rules.jsonc');
// The TABLE and the GATE are two files. `send-gate.ts` crossed the 400-line
// ceiling and the rules moved to their own module along the seam the code
// already had — the table answers "what does the law require here", the gate
// answers "may THIS message go to THIS person now". So this script reads BOTH:
// the table from where it lives, and the consult from where it happens. Reading
// only one was how this gate briefly reported that the register enforced
// nothing, immediately after the split — which was true of the file it was
// looking at and false of the code.
const RULES_TABLE = join('server', 'lib', 'sms', 'messaging-rules.ts');
const SEND_GATE = join('server', 'lib', 'sms', 'send-gate.ts');

const CATEGORIES = ['transactional', 'operational', 'marketing'];
const REQUIREMENT_KEYS = ['consent_standard', 'quiet_hours', 'identification', 'unsubscribe'];

const VALUE_VOCAB = {
    consent_standard: ['express', 'express_written', 'exception_applies', 'express_or_implied'],
    quiet_hours: ['required', 'not_applicable', 'unknown'],
    identification: ['required', 'not_applicable', 'unknown'],
    unsubscribe: ['required', 'not_applicable', 'unknown'],
};

const BASIS_KINDS = [
    'statute_requires', 'statute_scope', 'statutory_exception',
    'architecture', 'product_posture', 'unknown',
];
/** Bases that assert something about a STATUTE's text and therefore need it. */
const BASES_NEEDING_PRIMARY_TEXT = ['statute_scope', 'statutory_exception'];

const VERIFIED_AGAINST = ['primary_text', 'primary_text_mirror', 'secondary_source', 'unverified'];
/** The two rungs that count as having read the text itself. */
const PRIMARY = ['primary_text', 'primary_text_mirror'];

/**
 * Who enforces a requirement, and where to look. A name here is a promise the
 * file exists and still contains the mechanism, so a rename cannot quietly turn
 * an enforced requirement into a documented one.
 */
const ENFORCERS = {
    'send-gate': { path: RULES_TABLE, marker: /GATE_ENFORCED_REQUIREMENTS/ },
    'sender-identity': { path: join('server', 'lib', 'sms', 'sender-identity.ts'), marker: /resolveSmsSenderIdentity/ },
    'inbound-stop-webhook': { path: join('server', 'api', 'sms.ts'), marker: /isRevoke/ },
    unenforced: null,
};

/** A region that answers for a country nobody studied. Refused outright. */
const WILDCARD_REGIONS = ['*', 'ALL', 'ANY', '-'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Strip comments and normalize quotes, leaving parseable JSON.
 *
 * This has to read BOTH the JSONC register and a TypeScript object literal, and
 * the literal is ordinary source: unquoted keys, single-quoted strings, trailing
 * commas. A gate that only accepted the shape the literal happens to have today
 * would break the first time `eslint --fix` reformatted it, and "the gate broke"
 * and "the rules drifted" look identical from the outside. So the scanner
 * handles both, and the self-test feeds it both.
 *
 * A scanner rather than a regex because a regex cannot tell a comment from a URL
 * or from the same characters inside a string, and this register is full of
 * both — `https://` in every citation source.
 */
export function looseJson(text) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i++;
            continue;
        }
        if (c === '"' || c === "'") {
            const quote = c;
            let body = '';
            for (i++; i < text.length && text[i] !== quote; i++) {
                if (text[i] === '\\') {
                    // A single-quoted \' becomes a bare ' once re-quoted; every
                    // other escape survives as written.
                    body += text[i + 1] === "'" && quote === "'" ? "'" : text[i] + (text[i + 1] ?? '');
                    i++;
                    continue;
                }
                body += text[i] === '"' ? '\\"' : text[i];
            }
            out += `"${body}"`;
            continue;
        }
        out += c;
    }
    // Bare identifier keys, then trailing commas.
    return out
        .replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3')
        .replace(/,(\s*[}\]])/g, '$1');
}

/**
 * The braced object starting at `open`. Quotes, template literals and comments
 * are skipped rather than brace-counted, because the register's prose contains
 * braces and the source's strings contain both.
 */
export function extractObject(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
        if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 1; continue; }
        if (c === "'" || c === '"' || c === '`') {
            const quote = c;
            for (i++; i < text.length; i++) {
                if (text[i] === '\\') { i++; continue; }
                if (text[i] === quote) break;
            }
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return text.slice(open, i + 1); }
    }
    return text.slice(open);
}

/** The send path's enforceable table, as data. */
export function codeTable(source) {
    const decl = source.indexOf('const MESSAGING_RULES');
    if (decl < 0) return null;
    const open = source.indexOf('{', source.indexOf('=', decl));
    if (open < 0) return null;
    return JSON.parse(looseJson(extractObject(source, open)));
}

/** The requirement names the gate says it refuses on. */
export function enforcedRequirements(source) {
    const m = /GATE_ENFORCED_REQUIREMENTS[^=]*=\s*\[([^\]]*)\]/.exec(source);
    if (!m) return null;
    return [...m[1].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1]);
}

/**
 * Calls to `rulesFor`, not counting its own declaration.
 *
 * Zero means the register is decoration: every value could be wrong and nothing
 * would behave differently.
 */
export function consultSites(source) {
    const all = [...source.matchAll(/\brulesFor\s*\(/g)].length;
    const decls = [...source.matchAll(/function\s+rulesFor\s*\(/g)].length;
    return all - decls;
}

// ── Predicates ──────────────────────────────────────────────────────────────

/** Every (jurisdiction, category) pair a register rule declares. */
export function expand(rules) {
    return rules.flatMap((r) => (r.message_categories ?? []).map((category) => ({
        key: `${r.country}/${r.region ?? '-'}`,
        category,
        requirements: r.requirements ?? {},
        rule: r,
    })));
}

/** Rules the send path cannot answer, and values where the two disagree. */
export function compareWithCode(expanded, table) {
    const unresolvable = [];
    const mismatched = [];
    for (const e of expanded) {
        const coded = table?.[e.key]?.[e.category];
        if (!coded) { unresolvable.push(`${e.key} ${e.category}`); continue; }
        for (const k of REQUIREMENT_KEYS) {
            const want = e.requirements[k]?.value;
            if (coded[k] !== want) {
                mismatched.push(`${e.key} ${e.category}.${k}: register '${want}' vs send path '${coded[k]}'`);
            }
        }
    }
    return { unresolvable, mismatched };
}

/** Entries the send path enforces that the register never declared. */
export function codeRulesNotInRegister(expanded, table) {
    const known = new Set(expanded.map((e) => `${e.key} ${e.category}`));
    return Object.entries(table ?? {}).flatMap(([key, cats]) =>
        Object.keys(cats ?? {}).map((c) => `${key} ${c}`).filter((id) => !known.has(id)));
}

export function citationProblems(c, index) {
    const id = c.id ?? `citation #${index}`;
    const p = [];
    if (!c.id) p.push(`${id}: no id`);
    if (!c.authority) p.push(`${id}: no authority named`);
    if (!VERIFIED_AGAINST.includes(c.verified_against)) {
        p.push(`${id}: verified_against '${c.verified_against}' is not on the ladder (${VERIFIED_AGAINST.join(' | ')})`);
    }
    if (!ISO_DATE.test(c.checked_on ?? '')) p.push(`${id}: checked_on '${c.checked_on}' is not a YYYY-MM-DD date`);
    const unverified = c.verified_against === 'unverified';
    if (!unverified && !c.quote) {
        p.push(`${id}: claims '${c.verified_against}' with no quote — quote what was read, or say it is unverified`);
    }
    if (!unverified && !c.source) p.push(`${id}: claims '${c.verified_against}' with no source`);
    if (unverified && c.quote) p.push(`${id}: is unverified but carries a quote — nobody read it, so where is the quote from?`);
    if (unverified && !c.why_unverified) p.push(`${id}: unverified with no why_unverified — say what has to be opened`);
    return p;
}

export function requirementProblems(ruleId, key, req, citationsById) {
    const id = `${ruleId}.${key}`;
    const p = [];
    if (!req) return [`${id}: missing entirely`];
    if (!(VALUE_VOCAB[key] ?? []).includes(req.value)) {
        p.push(`${id}: value '${req.value}' is not in the vocabulary (${(VALUE_VOCAB[key] ?? []).join(' | ')})`);
    }
    if (!BASIS_KINDS.includes(req.basis_kind)) {
        p.push(`${id}: basis_kind '${req.basis_kind}' is not in the vocabulary`);
    }
    if (!Object.prototype.hasOwnProperty.call(ENFORCERS, req.enforced_by)) {
        p.push(`${id}: enforced_by '${req.enforced_by}' names no known enforcer`);
    }
    if (!ISO_DATE.test(req.checked_on ?? '')) {
        p.push(`${id}: checked_on '${req.checked_on}' is not a YYYY-MM-DD date`);
    }
    const cites = req.citations ?? [];
    if (cites.length === 0) p.push(`${id}: no citation — do not record a rule you cannot cite`);
    const resolved = [];
    for (const cid of cites) {
        const c = citationsById.get(cid);
        if (!c) p.push(`${id}: cites '${cid}', which the citations table does not define`);
        else resolved.push(c);
    }
    // WHICH citation carries the basis, named rather than inferred.
    //
    // "at least one of my citations is primary text" was the first draft, and it
    // is not enough: a requirement citing four provisions passes it while the
    // one provision its legal conclusion actually rests on is a summary. Proved
    // on real data — downgrading the CASL 6(6) exception to a secondary source
    // left the register GREEN, because a sibling citation on the same
    // requirement was still primary. The basis has to be named.
    const basis = req.basis_citation;
    if (!basis) p.push(`${id}: no basis_citation — name the ONE citation this value rests on`);
    else if (!cites.includes(basis)) p.push(`${id}: basis_citation '${basis}' is not among its own citations`);
    const basisCite = citationsById.get(basis);
    const basisIsPrimary = PRIMARY.includes(basisCite?.verified_against);
    if (BASES_NEEDING_PRIMARY_TEXT.includes(req.basis_kind) && !basisIsPrimary) {
        p.push(`${id}: basis_kind '${req.basis_kind}' asserts what a statute's own text says, but its `
            + `basis_citation '${basis}' was not read from primary text `
            + `(${basisCite?.verified_against ?? 'unresolved'}). This is the exact shape of the Washington error.`);
    }
    const hasPrimary = basisIsPrimary;
    if (req.basis_kind === 'architecture' && !req.architecture_note) {
        p.push(`${id}: basis_kind 'architecture' with no architecture_note — state the design fact`);
    }
    if (req.basis_kind !== 'architecture' && req.architecture_note && !req.note && !hasPrimary) {
        p.push(`${id}: an architecture_note is the only thing supporting a legal value — `
            + 'our design not triggering a rule is not the rule not applying');
    }
    if (!hasPrimary && !req.open_question) {
        p.push(`${id}: rests on no primary text and states no open question — `
            + 'name what would settle it, or it will read as settled');
    }
    if (req.value === 'unknown' && !req.open_question) {
        p.push(`${id}: value 'unknown' with no open_question`);
    }
    return p;
}

export function ruleProblems(r, i) {
    const id = `${r.country}/${r.region ?? '-'}`;
    const p = [];
    if (!/^[A-Z]{2}$/.test(r.country ?? '')) p.push(`rule #${i}: country '${r.country}' is not an ISO alpha-2 code`);
    if (r.region !== null && WILDCARD_REGIONS.includes(r.region)) {
        p.push(`${id}: region '${r.region}' is a wildcard — one entry may not answer for a country nobody studied`);
    }
    if (r.region !== null && !/^[A-Z0-9]{1,3}$/.test(r.region ?? '')) {
        p.push(`${id}: region '${r.region}' is neither null nor a subdivision code`);
    }
    if (!r.label) p.push(`${id}: no label`);
    if (r.channel !== 'sms') p.push(`${id}: channel '${r.channel}' — this register covers sms`);
    const cats = r.message_categories ?? [];
    if (cats.length === 0) p.push(`${id}: no message_categories`);
    for (const c of cats) if (!CATEGORIES.includes(c)) p.push(`${id}: unknown category '${c}'`);
    if (!r.applicability) {
        p.push(`${id}: no applicability — classification, applicability, exception, requirements, in that order`);
    }
    const keys = Object.keys(r.requirements ?? {});
    for (const k of REQUIREMENT_KEYS) if (!keys.includes(k)) p.push(`${id}: requirement '${k}' is missing`);
    for (const k of keys) if (!REQUIREMENT_KEYS.includes(k)) p.push(`${id}: unknown requirement '${k}'`);
    return p;
}

/** A requirement claiming the gate enforces it that the gate does not name. */
export function ignoredBySendPath(expanded, enforced) {
    const named = new Set(enforced ?? []);
    return expanded.flatMap((e) => REQUIREMENT_KEYS
        .filter((k) => e.requirements[k]?.enforced_by === 'send-gate' && !named.has(k))
        .map((k) => `${e.key} ${e.category}.${k} claims enforced_by 'send-gate', which does not name it`));
}

/** Citations nobody cites. A quote in support of nothing is a stale claim. */
export function unusedCitations(expanded, citations) {
    const used = new Set(expanded.flatMap((e) =>
        REQUIREMENT_KEYS.flatMap((k) => e.requirements[k]?.citations ?? [])));
    return citations.filter((c) => !used.has(c.id)).map((c) => c.id);
}

export const registerIsImplausible = (rules) => rules.length === 0;

// ── Self-test ───────────────────────────────────────────────────────────────

/**
 * A real requirement shape from the register, with overrides.
 *
 * `basis_citation` defaults to the first citation, which is what the register's
 * entries mostly do — but it is derived AFTER the overrides are applied, so a
 * control that swaps the citation list does not silently keep pointing at a
 * citation it no longer carries. That is a bug this fixture had for one run.
 */
const req = (over = {}) => {
    const base = {
        value: 'not_applicable', basis_kind: 'statute_scope', enforced_by: 'send-gate',
        checked_on: '2026-08-17', citations: ['cfr-64.1200-f15'], note: 'n', ...over,
    };
    return { basis_citation: base.citations[0], ...base };
};
const CITES = new Map([
    ['cfr-64.1200-f15', { id: 'cfr-64.1200-f15', verified_against: 'primary_text', checked_on: '2026-08-17', quote: 'q', source: 's' }],
    ['crtc-stop-as-unsubscribe', { id: 'crtc-stop-as-unsubscribe', verified_against: 'secondary_source', checked_on: '2026-08-17', quote: 'q', source: 's' }],
    ['crtc-utr-calling-hours', { id: 'crtc-utr-calling-hours', verified_against: 'unverified', checked_on: '2026-08-17', quote: null, source: null, why_unverified: 'w' }],
]);

function selfTest() {
    const checks = [];
    const ok = (name, pass) => checks.push([name, pass]);

    // ── The parser, on the two real shapes it must read ─────────────────────
    // The TypeScript literal as it is actually written in send-gate.ts:
    // unquoted category keys, single-quoted values, a trailing comma.
    const tsLiteral = `{
    'US/CA': {
        transactional: {
            consent_standard: 'express',
            quiet_hours: 'not_applicable',
            identification: 'required',
            unsubscribe: 'required',
        },
    },
}`;
    const parsedTs = JSON.parse(looseJson(tsLiteral));
    ok('a TS literal with unquoted keys and single quotes parses',
        parsedTs['US/CA'].transactional.quiet_hours === 'not_applicable');
    // The same table after a formatter quoted every key — the shape that would
    // break a gate written only for today's formatting.
    ok('the same table with double-quoted keys parses',
        JSON.parse(looseJson('{ "US/CA": { "marketing": { "quiet_hours": "required" } } }'))['US/CA'].marketing.quiet_hours === 'required');
    // A real citation source: `//` inside a string is not a comment.
    ok('a URL inside a string is not treated as a comment',
        JSON.parse(looseJson('{ "source": "https://www.govinfo.gov/x" }')).source === 'https://www.govinfo.gov/x');
    ok('a // comment is stripped', JSON.parse(looseJson('{ // why\n "a": 1 }')).a === 1);
    // Real register prose contains apostrophes: "the called party's location".
    ok("an apostrophe inside a double-quoted value survives",
        JSON.parse(looseJson(`{ "quote": "the called party's location" }`)).quote === "the called party's location");
    ok('a brace inside a quoted string does not close the object',
        extractObject(`{ "a": "}", "b": 1 }`, 0) === `{ "a": "}", "b": 1 }`);

    // ── Reading the send path ───────────────────────────────────────────────
    const fakeGate = `const MESSAGING_RULES: Record<string, X> = ${tsLiteral};
export const GATE_ENFORCED_REQUIREMENTS: readonly string[] = ['consent_standard', 'quiet_hours'];
export function rulesFor(classId: string, j: Jurisdiction): MessagingRule {
    const entry = MESSAGING_RULES[key];
}
const r = rulesFor(classId, jurisdiction);`;
    ok('the send path table is extracted', codeTable(fakeGate)?.['US/CA']?.transactional?.consent_standard === 'express');
    ok('the enforced-requirement list is extracted',
        JSON.stringify(enforcedRequirements(fakeGate)) === JSON.stringify(['consent_standard', 'quiet_hours']));
    ok('a consult site is counted and the declaration is not', consultSites(fakeGate) === 1);
    ok('a send path that never consults the table counts zero',
        consultSites('export function rulesFor(a, b) { return 1; }') === 0);
    ok('a missing table reads as absent, not as empty', codeTable('const OTHER = {};') === null);

    // ── Drift between the register and the send path ────────────────────────
    const registerRule = {
        country: 'US', region: 'CA', label: 'United States - California', channel: 'sms',
        message_categories: ['transactional'], applicability: 'a',
        requirements: {
            consent_standard: req({ value: 'express', basis_kind: 'statute_requires' }),
            quiet_hours: req({ value: 'not_applicable' }),
            // The real enforcers, not all 'send-gate': the two checks below
            // count claims the gate does not name, and a fixture where every
            // requirement claimed the gate would make both of them pass for the
            // wrong reason.
            identification: req({ value: 'required', basis_kind: 'product_posture', enforced_by: 'sender-identity' }),
            unsubscribe: req({ value: 'required', basis_kind: 'statute_requires', enforced_by: 'inbound-stop-webhook' }),
        },
    };
    const expanded = expand([registerRule]);
    const table = codeTable(fakeGate);
    ok('a register rule the send path answers is not reported',
        compareWithCode(expanded, table).unresolvable.length === 0
        && compareWithCode(expanded, table).mismatched.length === 0);
    ok('a register rule the send path cannot resolve is reported',
        compareWithCode(expand([{ ...registerRule, region: 'TX' }]), table).unresolvable.length === 1);
    ok('a register category the send path lacks is reported',
        compareWithCode(expand([{ ...registerRule, message_categories: ['marketing'] }]), table).unresolvable.length === 1);
    ok('a value the two disagree on is reported, naming the field',
        compareWithCode(expanded, JSON.parse(looseJson(`{ 'US/CA': { transactional: { consent_standard: 'express_written', quiet_hours: 'not_applicable', identification: 'required', unsubscribe: 'required' } } }`)))
            .mismatched.some((m) => m.includes('consent_standard')));
    ok('a send path rule with no register entry is reported',
        codeRulesNotInRegister(expand([{ ...registerRule, region: 'TX' }]), table).length === 1);
    ok('a send path table matching the register reports nothing extra',
        codeRulesNotInRegister(expanded, table).length === 0);

    // ── The rule the send path ignores ──────────────────────────────────────
    ok('a requirement claiming send-gate enforcement the gate does not name is reported',
        ignoredBySendPath(expand([{
            ...registerRule,
            requirements: { ...registerRule.requirements, identification: req({ value: 'required', basis_kind: 'product_posture', enforced_by: 'send-gate' }) },
        }]), ['consent_standard', 'quiet_hours']).length === 1);
    ok('a requirement enforced elsewhere is not reported as ignored',
        ignoredBySendPath(expand([{
            ...registerRule,
            requirements: { ...registerRule.requirements, identification: req({ enforced_by: 'sender-identity' }) },
        }]), ['consent_standard', 'quiet_hours']).length === 0);

    // ── Citations ───────────────────────────────────────────────────────────
    ok('a primary-text citation with a quote passes', citationProblems(
        { id: 'a', authority: 'x', verified_against: 'primary_text', checked_on: '2026-08-17', quote: 'q', source: 's' }, 0,
    ).length === 0);
    ok('a claimed reading with no quote is refused', citationProblems(
        { id: 'a', authority: 'x', verified_against: 'primary_text', checked_on: '2026-08-17', quote: null, source: 's' }, 0,
    ).some((p) => p.includes('no quote')));
    ok('an unverified citation with a quote is refused', citationProblems(
        { id: 'a', authority: 'x', verified_against: 'unverified', checked_on: '2026-08-17', quote: 'q', why_unverified: 'w' }, 0,
    ).some((p) => p.includes('carries a quote')));
    ok('an unverified citation that says nothing about why is refused', citationProblems(
        { id: 'a', authority: 'x', verified_against: 'unverified', checked_on: '2026-08-17', quote: null }, 0,
    ).some((p) => p.includes('why_unverified')));
    ok('an unverified citation naming what to open passes', citationProblems(
        { id: 'a', authority: 'x', verified_against: 'unverified', checked_on: '2026-08-17', quote: null, source: null, why_unverified: 'not opened' }, 0,
    ).length === 0);
    ok('a made-up verification rung is refused', citationProblems(
        { id: 'a', authority: 'x', verified_against: 'looks_right', checked_on: '2026-08-17', quote: 'q', source: 's' }, 0,
    ).some((p) => p.includes('not on the ladder')));
    ok('a citation with no date is refused', citationProblems(
        { id: 'a', authority: 'x', verified_against: 'primary_text', checked_on: 'recently', quote: 'q', source: 's' }, 0,
    ).some((p) => p.includes('YYYY-MM-DD')));

    // ── Requirements. The first control is the Washington shape verbatim: a
    // statutory exemption asserted from a summary.
    ok('a statutory exception resting on a secondary source is refused',
        requirementProblems('CA/-', 'consent_standard', req({
            value: 'exception_applies', basis_kind: 'statutory_exception',
            citations: ['crtc-stop-as-unsubscribe'], open_question: 'q',
        }), CITES).some((p) => p.includes('Washington error')));
    ok('a statutory exception resting on primary text passes',
        requirementProblems('CA/-', 'consent_standard', req({
            value: 'exception_applies', basis_kind: 'statutory_exception', citations: ['cfr-64.1200-f15'],
        }), CITES).length === 0);
    // The mutation that motivated `basis_citation`: the exception provision
    // itself downgraded to a summary, while a sibling citation on the same
    // requirement is still primary text. An "at least one is primary" rule was
    // green for this, on the real register.
    ok('a statutory exception whose OWN provision is a summary is refused even when a sibling citation is primary',
        requirementProblems('CA/-', 'consent_standard', req({
            value: 'exception_applies', basis_kind: 'statutory_exception',
            citations: ['crtc-stop-as-unsubscribe', 'cfr-64.1200-f15'],
            basis_citation: 'crtc-stop-as-unsubscribe', open_question: 'q',
        }), CITES).some((p) => p.includes('Washington error')));
    ok('a requirement with no basis_citation is refused',
        requirementProblems('CA/-', 'consent_standard', { ...req(), basis_citation: undefined }, CITES)
            .some((p) => p.includes('name the ONE citation')));
    ok('a basis_citation the requirement does not itself cite is refused',
        requirementProblems('CA/-', 'consent_standard', req({ basis_citation: 'crtc-utr-calling-hours' }), CITES)
            .some((p) => p.includes('not among its own citations')));
    ok('a statute_scope claim with no primary text is refused',
        requirementProblems('US/CA', 'quiet_hours', req({
            citations: ['crtc-utr-calling-hours'], open_question: 'q',
        }), CITES).some((p) => p.includes('Washington error')));
    ok('a requirement with no citation at all is refused',
        requirementProblems('US/CA', 'quiet_hours', req({ citations: [] }), CITES)
            .some((p) => p.includes('do not record a rule you cannot cite')));
    ok('a citation id nothing defines is refused',
        requirementProblems('US/CA', 'quiet_hours', req({ citations: ['no-such-citation'] }), CITES)
            .some((p) => p.includes('does not define')));
    ok("an 'unknown' value with no open question is refused",
        requirementProblems('CA/-', 'quiet_hours', req({
            value: 'unknown', basis_kind: 'unknown', citations: ['crtc-utr-calling-hours'],
        }), CITES).some((p) => p.includes("value 'unknown' with no open_question")));
    ok("an 'unknown' value naming its open question passes",
        requirementProblems('CA/-', 'quiet_hours', req({
            value: 'unknown', basis_kind: 'unknown', citations: ['crtc-utr-calling-hours'],
            open_question: 'Do the CRTC rules reach SMS?',
        }), CITES).length === 0);
    ok("basis_kind 'architecture' with no architecture_note is refused",
        requirementProblems('US/CA', 'quiet_hours', req({
            basis_kind: 'architecture', open_question: 'q',
        }), CITES).some((p) => p.includes('state the design fact')));
    ok("basis_kind 'architecture' stating the design fact passes",
        requirementProblems('US/CA', 'quiet_hours', req({
            basis_kind: 'architecture', architecture_note: 'we never send outside the window',
        }), CITES).length === 0);
    ok('a value resting on no primary text and stating no question is refused',
        requirementProblems('US/CA', 'identification', req({
            value: 'required', basis_kind: 'product_posture', citations: ['crtc-utr-calling-hours'],
        }), CITES).some((p) => p.includes('will read as settled')));
    ok('an enforcer nobody knows is refused',
        requirementProblems('US/CA', 'unsubscribe', req({ enforced_by: 'somewhere-else' }), CITES)
            .some((p) => p.includes('names no known enforcer')));
    ok("the 'unenforced' enforcer is accepted and not a spelling mistake",
        requirementProblems('US/CA', 'unsubscribe', req({ enforced_by: 'unenforced' }), CITES).length === 0);

    // ── Rule-level shape ───────────────────────────────────────────────────
    ok('a well-formed rule passes', ruleProblems(registerRule, 0).length === 0);
    ok('a wildcard region is refused',
        ruleProblems({ ...registerRule, region: '*' }, 0).some((p) => p.includes('wildcard')));
    ok("region '-' is refused as a wildcard, not read as null",
        ruleProblems({ ...registerRule, region: '-' }, 0).some((p) => p.includes('wildcard')));
    ok('a null region is the country-level rule and passes',
        ruleProblems({ ...registerRule, country: 'CA', region: null }, 0).length === 0);
    ok('a missing requirement is reported by name',
        ruleProblems({ ...registerRule, requirements: { consent_standard: req() } }, 0)
            .some((p) => p.includes("requirement 'quiet_hours' is missing")));
    ok('a rule with no applicability is refused',
        ruleProblems({ ...registerRule, applicability: '' }, 0).some((p) => p.includes('applicability')));
    ok('an invented category is refused',
        ruleProblems({ ...registerRule, message_categories: ['promotional'] }, 0)
            .some((p) => p.includes("unknown category 'promotional'")));

    // ── Stale claims and the empty scan ────────────────────────────────────
    ok('a citation nobody cites is reported',
        unusedCitations(expanded, [...CITES.values()]).includes('crtc-utr-calling-hours'));
    ok('a cited citation is not reported as unused',
        !unusedCitations(expanded, [...CITES.values()]).includes('cfr-64.1200-f15'));
    ok('zero rules is a failure', registerIsImplausible([]));
    ok('one rule is plausible', !registerIsImplausible([registerRule]));

    const failed = checks.filter(([, pass]) => !pass);
    for (const [name] of failed) console.error(`  WRONG: ${name}`);
    console.log(`  self-test: ${checks.length} checks, ${failed.length} wrong`);
    return failed.length === 0;
}

// ── Driver ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
if (!selfTest()) {
    console.error('\n✘ messaging-rules gate: its own self-test failed. Fix the gate before trusting it.');
    process.exit(1);
}

let register;
try {
    register = JSON.parse(looseJson(readFileSync(REGISTER, 'utf8')));
} catch (err) {
    console.error(`\n✘ Could not read compliance/messaging-rules.jsonc: ${err.message}`);
    console.error('  Unreadable is a failure, not a pass.');
    process.exit(1);
}
const rules = register.rules ?? [];
const citations = register.citations ?? [];
const citationsById = new Map(citations.map((c) => [c.id, c]));

// The table and the consult live in two files since the split. Reading only one
// of them is how this gate briefly reported that the register enforced nothing.
const tableSource = readFileSync(join(ROOT, RULES_TABLE), 'utf8');
const gateSource = readFileSync(join(ROOT, SEND_GATE), 'utf8');
const table = codeTable(tableSource);
const enforced = enforcedRequirements(tableSource);
// The CONSULT is the one thing that must be in the gate itself: a table nothing
// calls is decoration, and calling it from its own module would prove nothing.
const consults = consultSites(gateSource);

const expanded = expand(rules);
const { unresolvable, mismatched } = compareWithCode(expanded, table);
const extraInCode = codeRulesNotInRegister(expanded, table);
const ignored = ignoredBySendPath(expanded, enforced);
const unused = unusedCitations(expanded, citations);

const problems = [
    ...rules.flatMap((r, i) => ruleProblems(r, i)),
    ...citations.flatMap((c, i) => citationProblems(c, i)),
    ...expanded.flatMap((e) => REQUIREMENT_KEYS.flatMap((k) =>
        requirementProblems(`${e.key} ${e.category}`, k, e.requirements[k], citationsById))),
];

// Enforcers must still exist where the register says they do.
const enforcerProblems = [];
const enforcersClaimed = new Set(expanded.flatMap((e) =>
    REQUIREMENT_KEYS.map((k) => e.requirements[k]?.enforced_by).filter(Boolean)));
for (const name of enforcersClaimed) {
    const spec = ENFORCERS[name];
    if (spec === null || spec === undefined) continue; // 'unenforced', or already reported above.
    const p = join(ROOT, spec.path);
    if (!existsSync(p)) enforcerProblems.push(`${name}: ${spec.path.split('\\').join('/')} does not exist`);
    else if (!spec.marker.test(readFileSync(p, 'utf8'))) {
        enforcerProblems.push(`${name}: ${spec.path.split('\\').join('/')} no longer contains ${spec.marker}`);
    }
}

// ── Census. Both numbers, every run. ────────────────────────────────────────
const allRequirements = expanded.flatMap((e) => REQUIREMENT_KEYS.map((k) => ({ id: `${e.key} ${e.category}.${k}`, r: e.requirements[k] })));
const withPrimary = allRequirements.filter(({ r }) =>
    PRIMARY.includes(citationsById.get(r?.basis_citation)?.verified_against));
const noPrimary = allRequirements.filter((x) => !withPrimary.includes(x));
const unknownValues = allRequirements.filter(({ r }) => r?.value === 'unknown');
const byRung = Object.fromEntries(VERIFIED_AGAINST.map((v) => [v, citations.filter((c) => c.verified_against === v)]));
const unenforcedReqs = allRequirements.filter(({ r }) => r?.enforced_by === 'unenforced');
const codeRuleCount = Object.values(table ?? {}).reduce((n, cats) => n + Object.keys(cats ?? {}).length, 0);
const architectureBased = allRequirements.filter(({ r }) => r?.basis_kind === 'architecture');

console.log('\nmessaging rules — compliance/messaging-rules.jsonc + ' + SEND_GATE.split('\\').join('/'));
console.log(`  jurisdictions       : ${new Set(expanded.map((e) => e.key)).size} register / ${Object.keys(table ?? {}).length} in the send path`);
console.log(`  rules (jurisdiction x category) : ${expanded.length} register / ${expanded.length - unresolvable.length} resolvable by the send path / ${codeRuleCount} in the send path`);
console.log(`  value comparisons   : ${expanded.length * REQUIREMENT_KEYS.length} compared / ${mismatched.length} disagree`);
console.log(`  requirements        : ${allRequirements.length} total / ${withPrimary.length} whose basis_citation is primary text / ${noPrimary.length} whose basis is weaker`);
for (const x of noPrimary) console.log(`      · basis not primary text: ${x.id} (${x.r?.basis_kind}, basis ${x.r?.basis_citation} = ${citationsById.get(x.r?.basis_citation)?.verified_against ?? 'unresolved'})`);
console.log(`  citations           : ${citations.length} total / ${byRung.primary_text.length} primary_text / ${byRung.primary_text_mirror.length} mirror / ${byRung.secondary_source.length} secondary / ${byRung.unverified.length} UNVERIFIED`);
for (const c of byRung.unverified) console.log(`      · unverified: ${c.id} — ${c.authority}`);
console.log(`  values 'unknown'    : ${unknownValues.length} of ${allRequirements.length} (each refuses at the gate)`);
for (const x of unknownValues) console.log(`      · ${x.id}`);
console.log(`  bases              : ${architectureBased.length} of ${allRequirements.length} rest on architecture rather than on a statute`);
console.log(`  enforcement        : ${enforced?.length ?? 0} requirement(s) named by GATE_ENFORCED_REQUIREMENTS / ${ignored.length} claimed-but-unnamed / ${unenforcedReqs.length} recorded as unenforced`);
for (const x of unenforcedReqs) console.log(`      · unenforced: ${x.id}`);
console.log(`  rulesFor consults in the send path : ${consults}`);

let failed = false;
const report = (label, list, hint) => {
    if (list.length === 0) return;
    failed = true;
    console.error(`\n✘ ${label}:`);
    for (const x of list) console.error(`    ${x}`);
    if (hint) console.error(`  ${hint}`);
};

if (registerIsImplausible(rules)) {
    console.error('\n✘ Read zero rules — that is a parse failure or the wrong file, not a register with no rules.');
    failed = true;
}
if (citations.length === 0) {
    console.error('\n✘ Read zero citations — every rule here is supposed to name one, so zero means nothing was checked.');
    failed = true;
}
if (table === null || codeRuleCount === 0) {
    console.error('\n✘ Found no MESSAGING_RULES table in the send path — the register enforces nothing.');
    failed = true;
}
if (enforced === null) {
    console.error('\n✘ Found no GATE_ENFORCED_REQUIREMENTS in the send path — cannot tell which rules it claims to enforce.');
    failed = true;
}
if (consults === 0) {
    console.error('\n✘ The send path never calls rulesFor. A table nothing consults is decoration:');
    console.error('  every value in the register could be wrong and no send would behave differently.');
    failed = true;
}
report('Register rules the send path cannot resolve', unresolvable,
    'A rule that reads as live and is not is worse than a rule nobody wrote.');
report('Send path rules the register never declared', extraInCode,
    'The enforceable table is a projection of the register, not a second opinion.');
report('Values the register and the send path disagree on', mismatched);
report('Requirements the send path ignores', ignored,
    "Either the gate must refuse on it, or the register must name the enforcer that does.");
report('Citations nothing cites', unused,
    'Remove it, or cite it. A quote in support of nothing is a claim nobody is making.');
report('Enforcers that moved', enforcerProblems);
report('Register problems', problems);

if (failed) {
    console.error('\n  compliance/messaging-rules.jsonc and the MESSAGING_RULES table are the two files to fix.\n');
    process.exit(1);
}

console.log('\n✓ Every rule is cited, resolvable by the send path, and enforced by something named.\n');
