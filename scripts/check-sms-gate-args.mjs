#!/usr/bin/env node
/**
 * lint:sms-gate-args — a gate argument nobody passes is a gate that is not
 * running.
 *
 * `smsSendGate` inspects the message BODY for marketing content, but it can
 * only do that when the caller hands it `bodyTemplate`. A caller that omits the
 * argument does not fail, does not warn, and does not get blocked: it silently
 * skips the check. The gate looks present in the source and is absent in
 * effect, which is the worst of both — a reviewer reading `send-gate.ts` sees a
 * marketing block that a reviewer reading the call site never learns is off.
 *
 * ── Why this cannot be a TypeScript requirement ──────────────────────────────
 * Making `bodyTemplate` non-optional would be the better control, and it is not
 * available. The settings "test connection" send has NO template: it sends a
 * fixed diagnostic string it composes itself. A required field would force that
 * call site to invent a value, and an invented value is worse than an absent
 * one — it would feed the marketing scanner text no recipient ever receives.
 *
 * ── The exemption is a MARKER AT THE CALL SITE, not a path list here ─────────
 * The one legitimately-bodyless call carries
 *
 *     // sms-gate-args-allow: <why this send has no template>
 *
 * on or just above the call. A path list inside this script would put the
 * exemption where nobody copying the pattern would ever see it; the marker puts
 * it where the copying happens. Every exemption is therefore visible in the
 * diff that creates it.
 *
 * ── Zero is a failure, not a pass ───────────────────────────────────────────
 * This gate's whole subject is a check that quietly is not running. A version
 * of it that scanned no files, or matched no call sites, would report a clean
 * pass while doing precisely nothing — the same defect it exists to catch. So
 * it prints what it scanned beside what it found, and treats an empty scan and
 * an implausible call-site count as red.
 *
 * Usage: node scripts/check-sms-gate-args.mjs [--self-test]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['server'];
const EXT = /\.(ts|tsx)$/;
const SKIP = /(\.test\.|\.spec\.|[\\/]tests?[\\/])/;

/** The call shape: the exported gate invoked with an object literal. */
const CALL = /\bsmsSendGate\s*\(\s*\{/g;

/** The argument the marketing scanner cannot run without. */
const REQUIRED_ARG = /\bbodyTemplate\b/;

/**
 * The call-site exemption marker, and the reason it must carry.
 *
 * The reason has to be on the SAME line as the marker, and the character class
 * says so the hard way — `[ \t]` rather than `\s`, which crosses newlines. An
 * earlier draft used `\s*\S+` here and a bare `// sms-gate-args-allow:` was
 * accepted as fully reasoned, because the `const` beginning the next line
 * satisfied the `\S+`. The self-test did not catch it: it fed the marker with
 * nothing after it, which is the one shape that never occurs in a source file.
 * A bare marker is an exemption nobody has to justify, which is the failure
 * this gate is trying not to become.
 */
const ALLOW_MARKER = /\/\/[ \t]*sms-gate-args-allow:[ \t]*\S[^\r\n]*/;

/** How many source lines above the call the marker may sit on. */
const MARKER_LOOKBACK = 5;

/**
 * The number of call sites present when this gate was written, verified by
 * hand: server/api/sms.ts, server/api/message-templates.ts and
 * server/services/automation/send-one-sms.ts. It is a FLOOR, not an equality —
 * a fourth call site is the case this gate exists for and must not trip it.
 *
 * Finding fewer means either a call site was removed or this scanner stopped
 * recognising one, and those two are indistinguishable from the output. Both
 * deserve a human, so both are red: lowering this number is a decision someone
 * has to write down, not something a silent green run makes for them.
 */
const EXPECTED_MIN_CALL_SITES = 3;

function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        const p = join(dir, e);
        if (e === 'node_modules' || e === '.git') continue;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (EXT.test(e) && !SKIP.test(p)) out.push(p);
    }
    return out;
}

/**
 * The braced argument object starting at `open` (the index of its `{`).
 *
 * Brace-counting alone is wrong here: the real call sites nest objects inside
 * spread ternaries, and template bodies in this codebase contain `{{var}}`
 * inside string literals. So quotes, template literals and comments are skipped
 * rather than counted. Returns the object source including both braces, or the
 * remainder of the file if it is unbalanced (which then reads as "no
 * bodyTemplate" and is reported, rather than being silently dropped).
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

/** A call that does not mention the argument is a call the body check skips. */
export function missingBody(callText) {
    return !REQUIRED_ARG.test(callText);
}

/** Exempt when the marker sits inside the call or on the lines just above it. */
export function isExempt(callText, precedingLines) {
    return ALLOW_MARKER.test(callText) || ALLOW_MARKER.test(precedingLines);
}

/**
 * Zero call sites means the scanner is broken or the gate was deleted, and a
 * clean pass would be a lie either way. Fewer than the verified floor means the
 * same thing less obviously.
 */
export function callSitesAreImplausible(sites) {
    return sites.length < EXPECTED_MIN_CALL_SITES;
}

function scanFile(rel, text) {
    const found = [];
    CALL.lastIndex = 0;
    let m;
    while ((m = CALL.exec(text)) !== null) {
        const open = text.indexOf('{', m.index);
        const call = extractObject(text, open);
        const before = text.slice(0, m.index).split(/\r?\n/);
        const line = before.length;
        found.push({
            file: rel.split(sep).join('/'),
            line,
            call,
            preceding: before.slice(Math.max(0, before.length - 1 - MARKER_LOOKBACK)).join('\n'),
        });
        CALL.lastIndex = open + call.length;
    }
    return found;
}

/**
 * Two-way self-test. Every positive control below is a REAL shape from this
 * repository — the three call sites as they are actually written, nested spread
 * ternaries and all — because a self-test built from invented shapes only ever
 * proves the gate agrees with whoever wrote the gate.
 */
function selfTest() {
    // server/api/sms.ts — the fixed-body diagnostic, verbatim shape.
    const testConnection = `const gate = await smsSendGate({
            db, tenantId, to: normalized, purpose: 'test', env: c.env,
            ...(quotaGuard
                ? { quota: { guard: quotaGuard, tier: c.get('tenantTier') ?? await readTenantTier(c.env.DB, tenantId) } }
                : {}),
        });`;

    // server/services/automation/send-one-sms.ts — the real send path.
    const realSend = `const gate = await smsSendGate({
        db,
        tenantId: inspection.tenantId,
        to: log.recipient,
        purpose: 'notification',
        contactId,
        roleKind,
        env,
        ...(classId ? { classId } : {}),
        ...(quotaGuard ? { quota: { guard: quotaGuard, tier: tenant.tier } } : {}),
    });`;

    const realSendFed = realSend.replace('roleKind,', 'roleKind,\n        bodyTemplate,');
    const marker = '            // sms-gate-args-allow: fixed diagnostic body, not a template';

    const objOf = (src) => extractObject(src, src.indexOf('{'));

    const checks = [
        // The argument, present and absent.
        ['a call passing bodyTemplate is accepted', !missingBody(objOf(realSendFed))],
        ['a call omitting bodyTemplate is flagged', missingBody(objOf(realSend))],
        ['the fixed-body diagnostic is flagged when unmarked', missingBody(objOf(testConnection))],

        // The exemption, and its shape.
        ['a marked call site is exempt', isExempt(objOf(testConnection), marker)],
        ['an unmarked call site is not exempt', !isExempt(objOf(realSend), 'const db = getDrizzle(c);')],
        ['a marker with no stated reason does not exempt', !isExempt('', '// sms-gate-args-allow:')],
        // The shape a bare marker ACTUALLY has in a source file: followed by the
        // line it annotates. The check above passes even when the reason may be
        // supplied by the next line, so on its own it proves nothing.
        ['a bare marker is not reasoned by the line beneath it',
            !isExempt('', '        // sms-gate-args-allow:\n        const gate = await smsSendGate({')],
        ['a reason on the marker line still exempts when a line follows',
            isExempt('', `${marker}\n        const gate = await smsSendGate({`)],

        // The extractor, on the two shapes that actually break brace counting.
        ['a nested spread ternary does not truncate the object',
            objOf(realSend).includes('tenant.tier }') && objOf(realSend).endsWith('}')],
        ['a template var in a string literal does not close the object',
            objOf(`smsSendGate({ db, body: 'Hi {{client_name}}', bodyTemplate });`).includes('bodyTemplate')],
        ['the object ends at its own brace, not the statement',
            objOf(`smsSendGate({ db, purpose: 'test' });\nconst after = { bodyTemplate };`)
                === `{ db, purpose: 'test' }`],

        // Recognising the call at all, and the two shapes that are not calls.
        ['the call site is recognised in file text', scanFile('a.ts', testConnection).length === 1],
        ['the import of the gate is not a call site',
            scanFile('a.ts', `import { smsSendGate } from '../lib/sms/send-gate';`).length === 0],
        ['the gate definition is not a call site',
            scanFile('a.ts', `export async function smsSendGate(args: SmsGateArgs): Promise<SmsGateOutcome> {`).length === 0],

        // The empty scan, which is this gate's own failure mode.
        ['zero call sites found is a failure', callSitesAreImplausible([])],
        ['fewer call sites than the verified floor is a failure',
            callSitesAreImplausible(new Array(EXPECTED_MIN_CALL_SITES - 1).fill(0))],
        ['the verified floor itself is plausible',
            !callSitesAreImplausible(new Array(EXPECTED_MIN_CALL_SITES).fill(0))],
        ['a fourth call site is plausible',
            !callSitesAreImplausible(new Array(EXPECTED_MIN_CALL_SITES + 1).fill(0))],
    ];

    const failed = checks.filter(([, ok]) => !ok);
    for (const [n] of failed) console.error(`  WRONG: ${n}`);
    console.log(`  self-test: ${checks.length} checks, ${failed.length} wrong`);
    return failed.length === 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
if (!selfTest()) {
    console.error('\n✘ sms-gate-args gate: its own self-test failed. Fix the gate before trusting it.');
    process.exit(1);
}

const files = DIRS.flatMap((d) => walk(join(ROOT, d)));
const sites = files.flatMap((f) => scanFile(relative(ROOT, f), readFileSync(f, 'utf8')));

const exempt = sites.filter((s) => isExempt(s.call, s.preceding));
const missing = sites.filter((s) => missingBody(s.call) && !isExempt(s.call, s.preceding));

// Every number side by side. "0 missing" alone is indistinguishable from a scan
// that walked the wrong directory, matched nothing, and congratulated itself.
console.log(
    `\nsms-gate-args: ${files.length} file(s) scanned, ${sites.length} call site(s), `
    + `${missing.length} missing bodyTemplate (${exempt.length} marked exempt).`,
);

if (files.length === 0) {
    console.error('✘ Scanned zero files — the gate is looking in the wrong place, not passing.');
    process.exit(1);
}

if (callSitesAreImplausible(sites)) {
    console.error(`\n✘ Found ${sites.length} call site(s); ${EXPECTED_MIN_CALL_SITES} were verified by hand when this gate was written.`);
    console.error('  Either a call site was removed, or this scanner no longer recognises one.');
    console.error('  Those two look identical from here, so both stop the build. If a call site');
    console.error(`  genuinely went away, lower EXPECTED_MIN_CALL_SITES in ${relative(ROOT, fileURLToPath(import.meta.url)).split(sep).join('/')} and say why.`);
    process.exit(1);
}

if (missing.length > 0) {
    console.error('\n✘ smsSendGate called without bodyTemplate — the marketing-content check does not run for these sends:\n');
    for (const s of missing) console.error(`    ${s.file}:${s.line}`);
    console.error('\n  Pass the resolved body template so the gate can inspect what is actually');
    console.error('  being sent. A send that genuinely has no template — a fixed diagnostic');
    console.error('  string composed at the call site — states that where it happens:');
    console.error('\n      // sms-gate-args-allow: fixed diagnostic body, not a template\n');
    process.exit(1);
}

console.log('✓ Every smsSendGate call feeds the body check, or says why it cannot.\n');
