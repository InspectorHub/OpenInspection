#!/usr/bin/env node
/**
 * This repository is PUBLIC. Nothing in it may cite a private legal review.
 *
 * ── What an object that FAILS this looks like ───────────────────────────────
 * A source comment, a document, a test name or a string literal that explains
 * the code by naming who required it, or by pointing at a tracker that only
 * exists somewhere else:
 *
 *     // Counsel round 26 requires the chain to show the signer was presented
 *     // ... a distinction the reader is entitled to (counsel ruling 17c).
 *     // see docs/superpowers/specs/2026-07-30-sms-consent-isv-strategy.md
 *
 * Each of those is two separate problems. It discloses that a private review
 * happened and roughly what it said, and it points a reader at a document they
 * cannot open — so the comment does not even do its job for the audience this
 * repository actually has.
 *
 * The repair is never to delete the sentence. It is to state the requirement
 * instead of citing who required it: "The chain must show the signer was
 * presented ...". The reasoning is the valuable part and it survives the edit.
 *
 * ── What PASSES ─────────────────────────────────────────────────────────────
 * Public law, by name and section. `CASL 6(6)`, `TCPA`, `§1798.140(w)`,
 * `ESIGN` are statutes anyone can read, and code that implements one should
 * say so. What goes is the internal citation, not the law.
 *
 * ── Why this gate exists at all ─────────────────────────────────────────────
 * Every other class of leak into this repository already has a gate: Chinese
 * has one, hosted-service routes have one, mode disguises have one. This class
 * had none, and the superproject's own notes said so in as many words. It was
 * the only category on that list whose entry read "nothing." Three hundred and
 * thirty-three lines had accumulated by the time anyone counted.
 *
 * ── Reading the output ──────────────────────────────────────────────────────
 * Both numbers print on every run, pass or fail: how much was searched, and how
 * much was found. A run that scans zero files is a FAILURE, not a pass — a gate
 * that has gone blind must never be mistaken for a clean tree.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.html', '.md', '.json', '.yml', '.yaml'];
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'build', 'dist', '.wrangler', '.types',
    'coverage', '.docs-shots', 'test-results', 'playwright-report',
    'local-fixtures', '.react-router', '.superpowers',
]);

/**
 * Each rule says what it catches and, in `why`, what to write instead. The
 * message a developer sees at 2am is the whole product of a gate, so it names
 * the repair rather than the crime.
 */
const RULES = [
    {
        id: 'counsel',
        // The bare word, in any casing, as a whole word. `counselling` and
        // `counselor` are not this project's legal review, so the boundary
        // matters; `counsel's` and `counsel-ready` are, so the trailing
        // boundary allows an apostrophe or a hyphen.
        re: /\bcounsel(?:'s|s)?\b/gi,
        why: 'State the requirement instead of naming who required it: '
            + '"Counsel round 26 requires X" becomes "X must hold, because ...".',
    },
    {
        id: 'review-round',
        // "round 26", "round 24 ruling 24D", "ruling 17c", "ruling B4".
        re: /\b(?:round\s+\d+[a-z]?(?:\s*[·,-]\s*)?|ruling\s+)(?:\d+[a-z]?|[A-Z]\d+)\b/gi,
        // "Round 37" in the marketplace code is a PRODUCT iteration and always
        // was; so is a reinspection round, which is a domain term customers use.
        // A gate that cannot tell a sprint from a legal review gets argued with
        // until somebody deletes it, so it has to be able to tell them apart.
        skipIf: (line) => /marketplace|Scheme \d|reinspection/i.test(line),
        why: 'Drop the citation. The requirement stands on its own; the round it '
            + 'came from is a private tracker a reader here cannot open.',
    },
    {
        id: 'private-planning-path',
        // Two trees in the private repository: the planning one and the legal
        // archive. Neither exists here, so every mention is a dangling link as
        // well as a disclosure — and `docs/legal/` is the worse of the two,
        // because naming the archive is naming the index this gate exists to
        // keep out. The trailing slash is NOT required: the first version of
        // this rule demanded one and therefore missed `docs/legal,` and
        // `docs/superpowers,` written mid-sentence.
        re: /docs\/(?:superpowers|legal)[^\s)'"`,\]]*/g,
        why: 'That path does not resolve in this repository. Inline what the '
            + 'document said, or cite an issue number instead.',
    },
];

/**
 * Lines that may keep a match, each with the reason. An entry is a FILE plus a
 * SUBSTRING that must be present on the matching line — not a bare line number,
 * because a line number silently starts pointing at different code the moment
 * anything above it is edited, and a gate that has quietly re-aimed is worse
 * than no gate.
 */
const ALLOW = [
    {
        file: 'tests/unit/agreements/language-disclosure.spec.ts',
        contains: 'for (const forbidden of [/counsel/i',
        why: 'A NEGATIVE guard. That spec asserts the disclosure module contains '
            + 'no private legal material, so the word is the thing it searches '
            + 'for. Removing it would delete the test that enforces this rule at '
            + 'the one place it matters most.',
    },
    {
        file: 'server/api/well-known.ts',
        contains: 'court, opposing counsel',
        why: 'Names who in the WORLD might verify a signature — a court, the '
            + 'other side\'s lawyer. It describes the audience for a public '
            + 'verification endpoint, not a review of this project.',
    },
];

function walk(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const name of entries) {
        if (SKIP_DIRS.has(name)) continue;
        const full = join(dir, name);
        let st;
        try {
            st = statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) walk(full, out);
        else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
    }
    return out;
}

const files = walk(ROOT);
const findings = [];
const allowUsed = new Set();
let linesScanned = 0;

for (const full of files) {
    const rel = relative(ROOT, full).split(sep).join('/');
    if (rel.startsWith('scripts/check-no-private-review-refs.mjs')) continue; // this file describes the rules
    let text;
    try {
        text = readFileSync(full, 'utf8');
    } catch (err) {
        // A file this gate cannot read is a failure, not a skip. Silence here is
        // exactly how a scan reports "clean" for a tree it never looked at.
        findings.push({ rel, line: 0, rule: 'unreadable', text: String(err.message), why: 'The gate could not read this file.' });
        continue;
    }
    const lines = text.split(/\r?\n/);
    linesScanned += lines.length;
    lines.forEach((line, i) => {
        for (const rule of RULES) {
            rule.re.lastIndex = 0;
            if (!rule.re.test(line)) continue;
            if (rule.skipIf?.(line)) continue;
            const allow = ALLOW.find((a) => a.file === rel && line.includes(a.contains));
            if (allow) {
                allowUsed.add(`${allow.file}::${allow.contains}`);
                continue;
            }
            findings.push({ rel, line: i + 1, rule: rule.id, text: line.trim().slice(0, 140), why: rule.why });
        }
    });
}

// A stale allow-list entry is its own failure: it means the line it excused is
// gone, and nobody removed the excuse. The next line to land in that file
// inherits a permission written for something else.
const staleAllows = ALLOW.filter((a) => !allowUsed.has(`${a.file}::${a.contains}`));

console.log('\nPrivate-review reference gate');
console.log(`  files scanned      : ${files.length}`);
console.log(`  lines scanned      : ${linesScanned}`);
console.log(`  references found   : ${findings.length}`);
console.log(`  allowances used    : ${allowUsed.size} of ${ALLOW.length}`);

if (files.length === 0 || linesScanned === 0) {
    console.error('\n✖ This gate scanned nothing. That is a failure, not a clean tree —');
    console.error('  it means the walk root or the extension list is wrong.');
    process.exit(1);
}

if (staleAllows.length > 0) {
    console.error('\n✖ Stale allowance(s) — the excused line is gone, so the excuse must go too:');
    for (const a of staleAllows) console.error(`    ${a.file} — expected to contain: ${a.contains}`);
}

if (findings.length > 0) {
    console.error('\n✖ This repository is PUBLIC and must not cite a private legal review.\n');
    const byRule = new Map();
    for (const f of findings) {
        if (!byRule.has(f.rule)) byRule.set(f.rule, []);
        byRule.get(f.rule).push(f);
    }
    for (const [rule, list] of byRule) {
        console.error(`  [${rule}] ${list.length} occurrence(s) — ${list[0].why}`);
        for (const f of list) console.error(`    ${f.rel}:${f.line}  ${f.text}`);
        console.error('');
    }
    console.error('  Public law stays. CASL 6(6), TCPA, §1798.140 are statutes anyone');
    console.error('  can read, and code that implements one should say so. What goes is');
    console.error('  the internal citation, never the reasoning it carried.');
    process.exit(1);
}

if (staleAllows.length > 0) process.exit(1);

console.log('\n✓ No private-review references. Public law citations are unaffected.\n');
