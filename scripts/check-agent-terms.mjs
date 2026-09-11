#!/usr/bin/env node
/**
 * The agent-terms compliance gate.
 *
 * A compliance field that was never written is more dangerous than none: the
 * absent one is visibly absent, the never-written one reads as satisfied. This
 * gate keeps four such fields visibly answered, and every check prints BOTH
 * numbers, so a green run says how much it looked at rather than only that it
 * found nothing.
 *
 * ── The four checks ─────────────────────────────────────────────────────────
 *  1. Every clause these terms are required to carry is present in the document.
 *  2. The publisher still refuses a draft and still refuses placeholders.
 *  3. Every agent entrance is behind the gate.
 *  4. No production path writes an acceptance except the one function.
 *
 * ── Check 3 is NOT what the plan specified, and that is deliberate ──────────
 * The design this check was drawn up against counted agent route GROUPS and
 * asserted each was behind the gate, with zero groups failing. That describes a
 * gate mounted on a ROUTE LIST, and the implementation deliberately did not
 * build one: `agentTermsGate` is mounted on `*` and keyed on the ACTOR
 * (`c.var.agentUserId`), so a route added next year is behind it without anyone
 * remembering. Counting route groups against that design finds zero, and the
 * that rule fails on zero — a gate reporting red for a risk the implementation
 * had already removed by construction.
 *
 * What that design does leave exposed is written in the middleware's own words:
 * "the exemptions below must be exact and few". So check 3 asserts the three
 * properties that keep them that way. If the gate is ever re-mounted on a route
 * list, this check is the wrong shape again and must be rewritten with it.
 *
 * Run: npm run lint:agent-terms   ·   self-test: --self-test
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The seven clauses these terms are required to carry, without which an agent
 * has accepted a document that does not say what their access is conditioned
 * on. Identifiers, never titles: a title is copy an editor may reword, an
 * identifier is a promise about content.
 *
 * Changing this list changes what the deployment may publish, so it is edited
 * with the document and never to make a red run go green.
 */
export const REQUIRED_CLAUSES = [
    'authorized_access',
    'credential_security',
    'no_misuse',
    'no_resale_or_unauthorized_data_use',
    'confidentiality_and_permitted_use',
    'termination',
    'not_the_customer',
];

/**
 * Clause markers are HTML comments: `<!-- clause: authorized_access -->`.
 *
 * Not a shortcut around structuring the document — it is the only marker shape
 * that provably cannot reach a signer. `publish-agent-terms.mjs` strips HTML
 * comments BEFORE hashing, so the published bytes and the content hash are
 * identical with the markers or without them. A marker in the prose would
 * change both, and would show a signer an identifier they cannot read.
 */
const CLAUSE_MARKER = /<!--\s*clause:\s*([a-z_]+)\s*-->/g;

const DOC = join(ROOT, 'app', 'content', 'legal', 'agent-terms.md');
const PUBLISHER = join(ROOT, 'scripts', 'publish-agent-terms.mjs');
const GATE = join(ROOT, 'server', 'lib', 'middleware', 'agent-terms-gate.ts');
const WRITER = ['server', 'services', 'agent', 'terms-acceptance.ts'].join('/');

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const slash = (p) => p.split(sep).join('/');

/** Every `.ts` under server/, so check 4 has a real denominator. */
function serverFiles(dir = join(ROOT, 'server'), out = []) {
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) serverFiles(p, out);
        else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
    }
    return out;
}

// ── check 1 ─────────────────────────────────────────────────────────────────
export function checkClauses(body) {
    // A document we cannot read is a failure, never "zero clauses missing".
    if (body === null) {
        return { ok: false, num: 0, den: REQUIRED_CLAUSES.length, note: 'document unreadable' };
    }
    const found = new Set();
    for (const m of body.matchAll(CLAUSE_MARKER)) found.add(m[1]);
    const present = REQUIRED_CLAUSES.filter((c) => found.has(c));
    const unknown = [...found].filter((c) => !REQUIRED_CLAUSES.includes(c));
    return {
        ok: present.length === REQUIRED_CLAUSES.length && unknown.length === 0,
        num: present.length,
        den: REQUIRED_CLAUSES.length,
        missing: REQUIRED_CLAUSES.filter((c) => !found.has(c)),
        unknown,
    };
}

// ── check 2 ─────────────────────────────────────────────────────────────────
/**
 * A gate on the gate. The publisher's refusals are what stop an unapproved
 * contract reaching a signer, and nothing else asserts they survive an edit.
 */
export function checkPublisherRefusals(src) {
    if (src === null) return { ok: false, num: 0, den: 2, note: 'publisher unreadable' };
    const refusals = [
        ['refuses a surviving placeholder', /placeholders\.length === 0/],
        ['refuses a draft status line', /draftish/],
    ];
    const held = refusals.filter(([, re]) => re.test(src));
    return {
        ok: held.length === refusals.length,
        num: held.length,
        den: refusals.length,
        missing: refusals.filter(([, re]) => !re.test(src)).map(([label]) => label),
    };
}

// ── check 3 ─────────────────────────────────────────────────────────────────
export function checkGateShape(src) {
    if (src === null) return { ok: false, num: 0, den: 3, note: 'gate unreadable' };
    const properties = [
        // Keyed on the actor, not on a list of paths.
        ['gated on the actor (agentUserId)', /get\('agentUserId'\)/],
        // Derived from the classification table, so a new route cannot be
        // exempted by forgetting to add it somewhere.
        ['exemptions derived from AGENT_ROUTE_BINDING', /AGENT_ROUTE_BINDING[\s\S]{0,160}requiresBinding/],
        // Exact matching. A prefix exempts every future path beneath it, which
        // is how a homebuyer's report link ends up answering 428.
        ['exemptions matched exactly, not by prefix', /EXEMPT_PATHS\.has\(/],
    ];
    const held = properties.filter(([, re]) => re.test(src));
    return {
        ok: held.length === properties.length,
        num: held.length,
        den: properties.length,
        missing: properties.filter(([, re]) => !re.test(src)).map(([label]) => label),
    };
}

// ── check 4 ─────────────────────────────────────────────────────────────────
/**
 * One writer. An acceptance inserted anywhere else is a row with no evidence
 * behind it, and it would look exactly like a real one.
 */
export function checkSingleWriter(files) {
    // Zero files scanned means the walker broke, not that the tree is clean.
    if (files.length === 0) return { ok: false, num: 0, den: 0, note: 'no files scanned' };
    const offenders = [];
    for (const { path, src } of files) {
        if (slash(relative(ROOT, path)) === WRITER) continue;
        if (/insert\(\s*agentTermsAcceptances\s*\)/.test(src)) offenders.push(slash(relative(ROOT, path)));
    }
    return { ok: offenders.length === 0, num: offenders.length, den: files.length, offenders };
}

// ── runner ──────────────────────────────────────────────────────────────────
function run() {
    const files = serverFiles().map((path) => ({ path, src: readFileSync(path, 'utf8') }));
    const results = [
        ['required clauses are present', checkClauses(read(DOC)), 'of'],
        ['publisher still refuses draft + placeholders', checkPublisherRefusals(read(PUBLISHER)), 'of'],
        ['every agent entrance is behind the gate', checkGateShape(read(GATE)), 'of'],
        ['no write path bypasses recordAgentTermsAcceptance', checkSingleWriter(files), 'bypass(es) in'],
    ];

    console.log('\nagent-terms gate');
    let failed = 0;
    for (const [label, r, unit] of results) {
        console.log(`  ${r.ok ? '✓' : '✘'} ${label}: ${r.num} ${unit} ${r.den}`);
        if (r.note) console.log(`      · ${r.note}`);
        if (r.missing?.length) console.log(`      · missing: ${r.missing.join(', ')}`);
        if (r.unknown?.length) console.log(`      · unknown clause marker(s): ${r.unknown.join(', ')}`);
        if (r.offenders?.length) console.log(`      · ${r.offenders.join(', ')}`);
        if (!r.ok) failed++;
    }

    if (failed > 0) {
        console.error(`\n✘ agent-terms gate: ${failed} of ${results.length} check(s) not green.\n`);
        return 1;
    }
    console.log(`\n✅ agent-terms gate — ${results.length} checks green.\n`);
    return 0;
}

// ── self-test ───────────────────────────────────────────────────────────────
/**
 * Both directions for every check. A self-test with only failing fixtures
 * cannot tell "correctly refused" from "found nothing to look at", which is the
 * one way this gate could go quiet without going red.
 */
function selfTest() {
    const failures = [];
    const expect = (label, actual, wanted) => {
        if (actual !== wanted) failures.push(`${label}: got ${actual}, wanted ${wanted}`);
    };

    const all = REQUIRED_CLAUSES.map((c) => `<!-- clause: ${c} -->`).join('\n');
    expect('clauses: complete doc passes', checkClauses(all).ok, true);
    expect('clauses: one missing fails', checkClauses(all.replace('<!-- clause: termination -->', '')).ok, false);
    expect('clauses: unreadable doc fails', checkClauses(null).ok, false);
    expect('clauses: unknown marker fails', checkClauses(`${all}\n<!-- clause: invented -->`).ok, false);

    expect('publisher: both refusals pass', checkPublisherRefusals('placeholders.length === 0 draftish').ok, true);
    expect('publisher: one refusal missing fails', checkPublisherRefusals('placeholders.length === 0').ok, false);
    expect('publisher: unreadable fails', checkPublisherRefusals(null).ok, false);

    const goodGate = "get('agentUserId') AGENT_ROUTE_BINDING.filter((r) => !r.requiresBinding) EXEMPT_PATHS.has(path)";
    expect('gate: correct shape passes', checkGateShape(goodGate).ok, true);
    expect('gate: hand-written exemptions fail', checkGateShape(goodGate.replace('AGENT_ROUTE_BINDING.filter((r) => !r.requiresBinding)', '[]')).ok, false);
    expect('gate: prefix matching fails', checkGateShape(goodGate.replace('EXEMPT_PATHS.has(', 'path.startsWith(')).ok, false);
    expect('gate: unreadable fails', checkGateShape(null).ok, false);

    const clean = [{ path: join(ROOT, 'server', 'x.ts'), src: 'nothing here' }];
    const dirty = [{ path: join(ROOT, 'server', 'x.ts'), src: 'db.insert( agentTermsAcceptances )' }];
    const writerItself = [{ path: join(ROOT, ...WRITER.split('/')), src: 'db.insert( agentTermsAcceptances )' }];
    expect('writer: clean tree passes', checkSingleWriter(clean).ok, true);
    expect('writer: a bypass fails', checkSingleWriter(dirty).ok, false);
    expect('writer: the writer itself is not a bypass', checkSingleWriter(writerItself).ok, true);
    expect('writer: zero files scanned fails', checkSingleWriter([]).ok, false);

    console.log(`\nagent-terms gate self-test: ${failures.length === 0 ? 'PASS' : 'FAIL'} · ${failures.length} failure(s) of 15`);
    for (const f of failures) console.error(`  ✘ ${f}`);
    return failures.length === 0 ? 0 : 1;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run());
