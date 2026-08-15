#!/usr/bin/env node
/**
 * Retention POLICY ratchet.
 *
 * The rule it enforces: any change to what production deletes, or when, must
 * produce a policy diff. It hashes the operative fields of the three retention
 * arrays and compares the result to `RETENTION_POLICY.rulesDigest`. Change a
 * window and the digest moves; the build then refuses until the policy header
 * moves with it, so the version bump lands in the same diff as the rule change
 * and a reviewer sees both at once.
 *
 * It cannot stop someone editing a rule and the digest together — no ratchet
 * can. What it removes is the SILENT case: a window edited on its own, shipped,
 * and discovered a year later with nothing in the history saying a policy
 * decision was made. The edit is still possible; it can no longer be invisible.
 *
 * ── The constant indirection, which is why this is not a copy of the portal's ─
 * The portal's rules carry literal windows, so hashing its manifest text sees
 * every change. This repository's rules carry constant REFERENCES and the
 * numbers live in `retention-windows.ts` — that file even says the existing
 * manifest gate "only ever parses `window.unit`, never the numeric value". A
 * digest over manifest text alone would sit still while `AUDIT_LOG_ANONYMIZE_
 * MONTHS` went from 24 to 12, which is the exact edit this gate exists to
 * surface. So every constant is resolved through `retention-windows.ts` and the
 * RESOLVED NUMBER is hashed. A name that cannot be resolved is an error, not a
 * name hashed as itself — hashing the unresolved name would produce a stable
 * digest that means nothing and a gate that reads green.
 *
 * Reporting follows this repo's rule that a gate prints both numbers, never a
 * verdict alone: rule, exclusion and open counts are printed on every run, pass
 * or fail. An empty parse — zero rules found because a refactor moved an array
 * — would otherwise be a stable digest of nothing and a green build. Zero rules
 * is a FAILURE here.
 *
 * Usage: node scripts/check-retention-policy.mjs [--update] [--self-test]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const COMPLIANCE = join(ROOT, 'server', 'lib', 'compliance');
const MANIFEST = join(COMPLIANCE, 'retention-manifest.ts');
const WINDOWS = join(COMPLIANCE, 'retention-windows.ts');
const POLICY = join(COMPLIANCE, 'retention-policy.ts');

/**
 * Body between the outermost brackets of `export const NAME = <open> … <close>;`.
 *
 * The name match is anchored on both sides. A plain `indexOf('export const ' +
 * name)` also matches `NAME_ARCHIVE` — so a second array declared above the
 * real one would be hashed in its place, and the gate would report the count it
 * found rather than the count it should have found. The self-test's
 * relocated-array case exists because that is how this was discovered.
 */
function delimitedBody(text, name, open, close) {
    const decl = text.search(new RegExp(`export const ${name}\\b(?![A-Za-z0-9_])`));
    if (decl === -1) return null;
    const start = text.indexOf(open, text.indexOf('=', decl));
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === open) depth++;
        else if (text[i] === close && --depth === 0) return text.slice(start + 1, i);
    }
    return null;
}

/** Split a bracketed body into top-level `{ … }` object literals (nested ones stay inside). */
function objectLiterals(body) {
    const out = [];
    let depth = 0, start = -1;
    for (let i = 0; i < body.length; i++) {
        if (body[i] === '{') { if (depth++ === 0) start = i; }
        else if (body[i] === '}' && --depth === 0) out.push(body.slice(start, i + 1));
    }
    return out;
}

const field = (lit, key) => lit.match(new RegExp(`\\b${key}\\s*:\\s*'([^']*)'`))?.[1] ?? null;

/** `export const NAME = 24;` → { NAME: 24 }. The numbers the rules point at. */
function parseWindowConstants(src) {
    const out = {};
    for (const m of src.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*;/g)) {
        out[m[1]] = Number(m[2]);
    }
    return out;
}

/**
 * The whole digest, as a pure function of the two source texts, so the
 * self-test can feed it synthetic inputs and prove what it claims to catch.
 * Returns { digest, rules, excluded, open, errors }.
 */
function computeDigest(manifestSrc, constants) {
    const errors = [];

    const ruleBody = delimitedBody(manifestSrc, 'RETENTION_MANIFEST', '[', ']');
    const oosBody = delimitedBody(manifestSrc, 'RETENTION_OUT_OF_SCOPE', '[', ']');
    const openBody = delimitedBody(manifestSrc, 'RETENTION_OPEN', '[', ']');

    if (ruleBody === null) errors.push('RETENTION_MANIFEST not found — the digest cannot be computed, so no change to it could be detected.');
    if (oosBody === null) errors.push('RETENTION_OUT_OF_SCOPE not found — same problem.');
    if (openBody === null) errors.push('RETENTION_OPEN not found — same problem.');

    const rules = ruleBody === null ? [] : objectLiterals(ruleBody).map((lit) => {
        const win = lit.match(/\bwindow\s*:\s*\{([^}]*)\}/)?.[1] ?? '';
        const unit = win.match(/\bunit\s*:\s*'([^']*)'/)?.[1] ?? null;
        const raw = win.match(/\bvalue\s*:\s*([A-Za-z_][A-Za-z0-9_]*|\d+)/)?.[1] ?? null;

        // Resolve the reference. An unresolvable name must NOT be hashed as a
        // name: that would hide the number it stands for, which is the one
        // thing this digest is for.
        let value = null;
        if (raw === null) {
            errors.push(`rule for table ${field(lit, 'table')} has no window value — it cannot be hashed faithfully.`);
        } else if (/^\d+$/.test(raw)) {
            value = Number(raw);
        } else if (Object.prototype.hasOwnProperty.call(constants, raw)) {
            value = constants[raw];
        } else {
            errors.push(
                `window constant ${raw} (table ${field(lit, 'table')}) is not defined in retention-windows.ts — ` +
                'refusing to hash an unresolved name, because the resulting digest would be stable while the ' +
                'period it stands for could move freely.',
            );
        }

        return { table: field(lit, 'table'), anchor: field(lit, 'timestampColumn'), unit, value, action: field(lit, 'action') };
    });

    // A table moving in or out of scope IS a retention change, so the exclusion
    // set is part of the digest — but only its table names. Reasons are prose.
    const excluded = oosBody === null ? [] : objectLiterals(oosBody).map((lit) => field(lit, 'table')).filter(Boolean);

    // `decideBy` is operative: it is the date we promised to answer, and moving
    // it out is a policy decision that would otherwise be a one-character diff.
    const open = openBody === null ? [] : objectLiterals(openBody).map((lit) => ({
        table: field(lit, 'table'),
        decideBy: field(lit, 'decideBy'),
    })).filter((e) => e.table);

    // Zero is not a pass. A refactor that renames or relocates an array would
    // otherwise produce an empty parse, a stable digest of nothing, and green.
    if (ruleBody !== null && rules.length === 0) errors.push('RETENTION_MANIFEST parsed to ZERO rules — an empty parse is a gate failure, not a clean sweep.');
    if (oosBody !== null && excluded.length === 0) errors.push('RETENTION_OUT_OF_SCOPE parsed to ZERO entries — same reasoning.');
    // RETENTION_OPEN is legitimately allowed to be empty: it empties as questions get answered.

    for (const r of rules) {
        if (!r.table || !r.anchor || !r.unit || !r.action) {
            errors.push(`rule with a missing operative field cannot be hashed faithfully: ${JSON.stringify(r)}`);
        }
    }

    const canonical = JSON.stringify({
        rules: rules.slice().sort((a, b) => String(a.table).localeCompare(String(b.table))),
        excluded: excluded.slice().sort(),
        open: open.slice().sort((a, b) => String(a.table).localeCompare(String(b.table))),
    });

    return { digest: createHash('sha256').update(canonical).digest('hex'), rules, excluded, open, errors };
}

/**
 * Two-way self-test. A gate that has never been shown to fail is not known to
 * work, and the case worth proving here is the one a naive port would miss: the
 * number moving in the OTHER file while the manifest text stays byte-identical.
 */
function selfTest() {
    const SYNTH = `
export const RETENTION_MANIFEST: RetentionRule[] = [
    { table: 't_a', timestampColumn: 'created_at', window: { unit: 'months', value: SAMPLE_MONTHS }, action: 'delete', purpose: 'prose' },
];
export const RETENTION_OUT_OF_SCOPE: RetentionOutOfScopeEntry[] = [
    { table: 't_b', reason: 'prose' },
];
export const RETENTION_OPEN: RetentionOpenEntry[] = [
    { table: 't_c', reason: 'prose', decideBy: '2027-02-06' },
];`;

    const checks = [];
    const base = computeDigest(SYNTH, { SAMPLE_MONTHS: 24 });
    checks.push(['baseline parses', base.errors.length === 0 && base.rules.length === 1 && base.excluded.length === 1 && base.open.length === 1]);

    // THE case this gate exists for: identical manifest text, different number.
    const moved = computeDigest(SYNTH, { SAMPLE_MONTHS: 12 });
    checks.push(['a window constant changing in the other file moves the digest', base.digest !== moved.digest]);

    // Same inputs must be stable, or every run would demand a version bump.
    checks.push(['identical inputs give an identical digest', base.digest === computeDigest(SYNTH, { SAMPLE_MONTHS: 24 }).digest]);

    // An unresolvable constant is an error, never a silently hashed name.
    checks.push(['an unresolvable constant is an error', computeDigest(SYNTH, {}).errors.length > 0]);

    // Prose is excluded — rewording a purpose must not demand a version bump.
    checks.push(['rewording prose does not move the digest',
        computeDigest(SYNTH.replace("purpose: 'prose'", "purpose: 'entirely different words'"), { SAMPLE_MONTHS: 24 }).digest === base.digest]);

    // Operative fields DO move it, one positive control each.
    checks.push(['changing an action moves the digest',
        computeDigest(SYNTH.replace("action: 'delete'", "action: 'anonymize'"), { SAMPLE_MONTHS: 24 }).digest !== base.digest]);
    checks.push(['changing a decideBy date moves the digest',
        computeDigest(SYNTH.replace("'2027-02-06'", "'2028-02-06'"), { SAMPLE_MONTHS: 24 }).digest !== base.digest]);
    checks.push(['dropping an exclusion moves the digest',
        computeDigest(SYNTH.replace("{ table: 't_b', reason: 'prose' },", ''), { SAMPLE_MONTHS: 24 }).digest !== base.digest]);

    // An empty parse must fail rather than hash nothing.
    checks.push(['a relocated array fails instead of hashing nothing',
        computeDigest(SYNTH.replace('RETENTION_MANIFEST', 'RETENTION_MANIFEST_MOVED'), { SAMPLE_MONTHS: 24 }).errors.length > 0]);

    const failed = checks.filter(([, ok]) => !ok);
    for (const [name] of failed) console.error(`  WRONG: ${name}`);
    console.log(`  self-test: ${checks.length} checks, ${failed.length} wrong`);
    return failed.length === 0;
}

// ── Driver ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1);

if (!selfTest()) {
    console.error('\n✘ retention-policy gate: its own self-test failed. Fix the gate before trusting it.');
    process.exit(1);
}

const constants = parseWindowConstants(readFileSync(WINDOWS, 'utf8'));
const { digest, rules, excluded, open, errors } = computeDigest(readFileSync(MANIFEST, 'utf8'), constants);

if (Object.keys(constants).length === 0) {
    errors.push('retention-windows.ts yielded ZERO constants — every window would then be unresolvable.');
}

const policySrc = readFileSync(POLICY, 'utf8');
const recorded = policySrc.match(/rulesDigest\s*:\s*'([^']*)'/)?.[1] ?? null;
const version = policySrc.match(/version\s*:\s*'([^']*)'/)?.[1] ?? null;
const status = policySrc.match(/status\s*:\s*'([^']*)'/)?.[1] ?? null;

if (!version) errors.push('RETENTION_POLICY.version not found — a policy with no version cannot be diffed.');
if (recorded === null) errors.push('RETENTION_POLICY.rulesDigest not found.');

if (args.includes('--update')) {
    if (errors.length) {
        console.error('\n✘ refusing to write a digest computed from a broken parse:');
        for (const e of errors) console.error(`   ✘ ${e}`);
        process.exit(1);
    }
    writeFileSync(POLICY, policySrc.replace(/(rulesDigest\s*:\s*')[^']*(')/, `$1${digest}$2`));
    console.log(`retention policy: rulesDigest updated to ${digest.slice(0, 16)}…`);
    console.log('  Now bump `version`, and record WHY in docs/legal/ — a digest that moved with no');
    console.log('  reasoning attached is the state this gate exists to prevent.');
    process.exit(0);
}

// Both numbers, every run — a gate that speaks only on failure cannot be
// checked on the day it is green.
console.log(`retention policy ${version ?? '(no version)'} [${status ?? '?'}] — hashed ${rules.length} rules + ${excluded.length} exclusions + ${open.length} open, resolving ${Object.keys(constants).length} window constants`);
console.log(`  computed ${digest.slice(0, 24)}…  recorded ${(recorded || '(none)').slice(0, 24)}…`);

if (recorded && recorded !== digest) {
    errors.push(
        'the retention rules changed but the policy header did not.\n' +
        '       What production deletes is now different from what version ' + version + ' describes.\n' +
        '       Fix: bump RETENTION_POLICY.version, run `npm run lint:retention-policy -- --update`,\n' +
        '       and record the reasoning in docs/legal/ — counsel requires every period to be\n' +
        '       answerable with one page saying why this number and not another.',
    );
} else if (!recorded) {
    errors.push('RETENTION_POLICY.rulesDigest is empty — run `npm run lint:retention-policy -- --update` to seed it.');
}

if (errors.length) {
    console.error(`\n✘ Retention-policy gate — ${errors.length} problem(s):`);
    for (const e of errors) console.error(`   ✘ ${e}`);
    process.exit(1);
}
console.log('✓ Retention policy matches the rules it describes.');
