#!/usr/bin/env node
/**
 * lint:fabricated-names — a person's name is recorded or it is absent. It is
 * never derived.
 *
 * The banned shape is splitting an email address to obtain a display name:
 *
 *     name = user.name || user.email.split('@')[0]
 *
 * Four sites did this. One of them fed a published report's "Inspected & Signed
 * By" panel, so a tenant whose `users.name` was NULL had the local part of their
 * mailbox — `info` — printed as the inspector's name. Another fed the snapshot
 * that gets content-hashed and signed, which means a fabricated name was sealed
 * into the integrity chain and attested by the public verifier. A third never
 * read `users.name` at all: an inspector WITH a name still came back as their
 * mailbox prefix.
 *
 * The fourth was found only after two hand-written greps had already declared
 * the sweep complete. That is this gate's whole justification: the sweep is not
 * the hard part, remembering to run it forever is.
 *
 * The correct behaviour when a name is absent is to render nothing. A heading
 * that attributes authorship, drawn over a synthesised name, asserts something
 * the record does not contain — the same defect class as the composed signature
 * this repository spent 2026-08-15 removing.
 *
 * PROSE CAVEAT (learned the hard way, twice). This gate greps source text and
 * has no AST. A comment explaining what we deliberately do NOT do must write the
 * banned expression out to explain it — and is then indistinguishable from doing
 * it. Comments are therefore scanned like any other line, and the fix is to
 * describe the rejected approach without quoting it. There is no allowlist on
 * purpose: an exemption is where this gate would go to die.
 *
 * Usage: node scripts/check-fabricated-names.mjs [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['server', 'app', 'workers', 'packages'];
const EXT = /\.(ts|tsx)$/;
const SKIP = /(\.test\.|\.spec\.|[\\/]tests?[\\/])/;

/** Splitting an email address, in either quote style, however it is chained. */
const BANNED = /\.split\(\s*['"]@['"]\s*\)/;

function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        const p = join(dir, e);
        if (e === 'node_modules' || e === '.git') continue;
        const st = statSync(p);
        if (st.isDirectory()) walk(p, out);
        else if (EXT.test(e) && !SKIP.test(p)) out.push(p);
    }
    return out;
}

function scan(files) {
    const hits = [];
    for (const f of files) {
        const lines = readFileSync(f, 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
            if (BANNED.test(line)) hits.push({ file: relative(ROOT, f), line: i + 1, text: line.trim() });
        });
    }
    return hits;
}

/**
 * Two-way self-test. A gate that has never been shown to fire is not known to
 * work, and the positive controls here are the ones that matter: each is a real
 * shape that existed in this repository.
 */
function selfTest() {
    const mustFlag = [
        `name: r.email.split('@')[0]`,
        `name: u?.name || (u?.email?.split('@')[0] ?? null)`,
        `|| ((r.email as string | null)?.split('@')[0] ?? '')`,
        `const local = address.split("@")[0];`,
        `foo.split( '@' )[0]`,
        `// we used to do name = email.split('@')[0] here`,
    ];
    const mustNotFlag = [
        `inspectorName = inspector?.name ?? null;`,
        `const [user, host] = parseAddress(email);`,
        `if (!email.includes('@')) return null;`,
        `const parts = path.split('/');`,
        `name: r.name ?? null,`,
    ];
    let bad = 0;
    for (const s of mustFlag) if (!BANNED.test(s)) { console.error(`  MISSED: ${s}`); bad++; }
    for (const s of mustNotFlag) if (BANNED.test(s)) { console.error(`  FALSE POSITIVE: ${s}`); bad++; }
    console.log(`  self-test: ${mustFlag.length} must-flag, ${mustNotFlag.length} must-not-flag, ${bad} wrong`);
    return bad === 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
    process.exit(selfTest() ? 0 : 1);
}

if (!selfTest()) {
    console.error('\n✘ fabricated-names gate: its own self-test failed. Fix the gate before trusting it.');
    process.exit(1);
}

const files = DIRS.flatMap((d) => walk(join(ROOT, d)));
const hits = scan(files);

// Both numbers, side by side. A gate that prints only "0 problems" cannot be
// told apart from a gate that scanned nothing.
console.log(`\nfabricated-names: ${files.length} file(s) scanned, ${hits.length} hit(s).`);

if (files.length === 0) {
    console.error('✘ Scanned zero files — the gate is looking in the wrong place, not passing.');
    process.exit(1);
}

if (hits.length > 0) {
    console.error('\n✘ A person\'s name is being derived from an email address:\n');
    for (const h of hits) console.error(`    ${h.file}:${h.line}\n      ${h.text}`);
    console.error('\n  A mailbox local part is not a name. Return null and let the surface');
    console.error('  render nothing — a heading that attributes authorship over an invented');
    console.error('  name asserts something the record does not contain.');
    console.error('\n  If a comment needs to explain the rejected approach, describe it');
    console.error('  without writing the expression out; this gate has no AST.\n');
    process.exit(1);
}

console.log('✓ No name is derived from an email address.\n');
