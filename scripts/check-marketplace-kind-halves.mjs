#!/usr/bin/env node
/**
 * Every marketplace catalogue kind needs BOTH halves: an import path and an
 * un-import path.
 *
 * ── The rule already existed; nothing executed it ───────────────────────────
 * `marketplace_libraries` says so in its own comment: "Adding a kind means
 * adding both halves; there is no generic fallthrough, because a silent one is
 * how the wrong table gets written." That is a rule written down and enforced by
 * nobody, which is a comment rather than an invariant.
 *
 * The two halves genuinely differ per kind — retiring one local `templates` row
 * is not the same operation as deleting N tagged `comments` rows — so a single
 * branch pretending they are the same is how one of the two gets it wrong. That
 * is why the check is per kind and per half, not "there is an uninstall
 * somewhere".
 *
 * ── ⚠️ THIS GATE IS RED ON ARRIVAL, AND THAT IS THE POINT ───────────────────
 * There is no un-import path anywhere in `marketplace.service.ts` today —
 * neither existing kind has its second half. The gate is not describing a
 * mistake made while writing it; it is reporting a gap that was already there
 * and that nothing else in the tree could see. It goes green when the un-import
 * path lands.
 *
 * Loosening the check to make it green sooner would blind it at exactly the
 * moment it matters: the next kind added is the one nobody has a mental model
 * for yet.
 *
 * ── Why the halves are scoped to their own function bodies ──────────────────
 * A file-wide search for `kind === 'comments'` is satisfied by ANY mention,
 * including the import branch itself — so a scan that looked at the whole file
 * would report both halves present the moment one was written. The halves are
 * therefore read from the two function bodies separately, and the parser that
 * does it is scored against fixtures on every ordinary run, because a parser
 * that stopped finding a body prints the same clean line as a repository that
 * is fine.
 *
 *   node scripts/check-marketplace-kind-halves.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_FILE = 'server/lib/db/schema/marketplace.ts';
const SERVICE_FILE = 'server/services/marketplace.service.ts';

/**
 * The two halves, and the member each one lives in.
 *
 * `import` is one name because there is one import front door. `unimport` lists
 * the spellings the un-import path may reasonably take, so the gate turns green
 * on the path landing rather than on it being named the one word this file
 * happened to guess first.
 */
const HALVES = [
    { name: 'import', members: ['importCatalogEntry'] },
    { name: 'un-import', members: ['uninstall', 'unimport', 'uninstallLibrary'] },
];

const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * The body of a class member, or null when there is none.
 *
 * ⚠️ The trap this function exists to survive is the RETURN TYPE. These members
 * are declared `async importCatalogEntry(…): Promise<{ kind: string; … }> {`, so
 * the first `{` after the parameter list belongs to the type, not to the body.
 * Taking it would hand back the return type as though it were the code — a body
 * that parses, contains no branch, and reports every kind missing every half.
 * Angle-bracket depth is what tells the two apart.
 */
export function memberBody(code, name) {
    const decl = new RegExp(`(?:^|[\\s;}])(?:async\\s+)?${name}\\s*\\(`, 'm').exec(code);
    if (decl === null) return null;

    // 1. Walk the parameter list to its closing paren.
    let i = decl.index + decl[0].length - 1;
    let parens = 0;
    for (; i < code.length; i += 1) {
        if (code[i] === '(') parens += 1;
        else if (code[i] === ')') {
            parens -= 1;
            if (parens === 0) break;
        }
    }
    if (parens !== 0) return null;

    // 2. Find the body's `{`: the first one at angle-bracket depth 0.
    let angles = 0;
    let start = -1;
    for (i += 1; i < code.length; i += 1) {
        const ch = code[i];
        if (ch === '<') angles += 1;
        else if (ch === '>') angles = Math.max(0, angles - 1);
        else if (ch === '{' && angles === 0) { start = i; break; }
        else if (ch === ';' && angles === 0) return null; // a declaration, no body
    }
    if (start === -1) return null;

    // 3. Balance to the body's `}`.
    let braces = 0;
    for (i = start; i < code.length; i += 1) {
        if (code[i] === '{') braces += 1;
        else if (code[i] === '}') {
            braces -= 1;
            if (braces === 0) return code.slice(start + 1, i);
        }
    }
    return null;
}

/** Does `body` branch on this kind? */
export function branchesOn(body, kind) {
    return new RegExp(`kind\\s*===\\s*'${kind}'`).test(body);
}

// ---------------------------------------------------------------------------
// The parser's positive control, on every ordinary run
// ---------------------------------------------------------------------------

const RETURN_TYPE_CASE = `
class S {
  async importCatalogEntry(id: string): Promise<{ kind: string; n: number }> {
    if (entry.kind === 'templates') { return a; }
    else if (entry.kind === 'comments') { return b; }
  }
}`;

const FIXTURES = [
    // The one that matters: the return type's braces must not be mistaken for
    // the body, and both branches inside the real body must be found.
    [() => branchesOn(memberBody(RETURN_TYPE_CASE, 'importCatalogEntry') ?? '', 'templates'), true],
    [() => branchesOn(memberBody(RETURN_TYPE_CASE, 'importCatalogEntry') ?? '', 'comments'), true],
    // A kind NOT branched on must read as absent, or every kind looks covered.
    [() => branchesOn(memberBody(RETURN_TYPE_CASE, 'importCatalogEntry') ?? '', 'statutory'), false],
    // A member that does not exist is null, not an empty string that quietly
    // answers "no branches" for a reason nobody stated.
    [() => memberBody(RETURN_TYPE_CASE, 'uninstall'), null],
    // A bare declaration with no body is not a body.
    [() => memberBody('class S { uninstall(id: string): Promise<void>; }', 'uninstall'), null],
    // A body that IS present comes back non-empty.
    [() => (memberBody('class S { uninstall(id) { return 1; } }', 'uninstall') ?? '').includes('return 1'), true],
];

let selfTestFailures = 0;
FIXTURES.forEach(([run, want], n) => {
    let got;
    try {
        got = run();
    } catch (err) {
        got = `threw ${err.message}`;
    }
    if (got !== want) {
        selfTestFailures += 1;
        console.log(`  ✘ parser self-check ${n + 1}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
});

// ---------------------------------------------------------------------------
// The real read
// ---------------------------------------------------------------------------

for (const rel of [SCHEMA_FILE, SERVICE_FILE]) {
    if (existsSync(join(ROOT, rel))) continue;
    console.log(`marketplace-kinds: ${rel} not found, so this gate read nothing. Unreadable is a `
        + 'failure here: it looks exactly like "every kind is covered".');
    process.exit(1);
}

const schema = stripComments(readFileSync(join(ROOT, SCHEMA_FILE), 'utf8'));
const service = stripComments(readFileSync(join(ROOT, SERVICE_FILE), 'utf8'));

const enumMatch = /kind:\s*text\(\s*'kind'\s*,\s*\{\s*enum:\s*\[([^\]]+)\]/.exec(schema);
if (enumMatch === null) {
    console.log(`marketplace-kinds: could not read the kind enum from ${SCHEMA_FILE}. Unreadable `
        + 'is a failure here: it looks exactly like "every kind is covered".');
    process.exit(1);
}
const kinds = [...enumMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const missing = [];
const blind = [];

for (const half of HALVES) {
    const found = half.members.map((m) => ({ m, body: memberBody(service, m) })).filter((x) => x.body !== null);
    if (found.length === 0) {
        for (const kind of kinds) missing.push({ kind, half: half.name, reason: 'there is no un-import path in the service at all' });
        continue;
    }
    for (const kind of kinds) {
        if (found.some((x) => branchesOn(x.body, kind))) continue;
        missing.push({ kind, half: half.name, reason: `${found.map((x) => x.m).join('/')} does not branch on it` });
    }
}

// The import half is the one that certainly exists today. If the parser cannot
// see ANY import branch, the far more likely explanation is the parser, and a
// report blaming the service would send somebody to rewrite working code.
const importBody = HALVES[0].members.map((m) => memberBody(service, m)).find((b) => b !== null);
if (importBody === undefined) {
    blind.push(`  ✘ no member named ${HALVES[0].members.join('/')} could be read from ${SERVICE_FILE}, `
        + 'so the import half was not examined at all. The import path certainly exists, so this is '
        + 'the reader having broken rather than a finding about the service.');
} else if (!kinds.some((k) => branchesOn(importBody, k))) {
    blind.push(`  ✘ the import path branches on NONE of the ${kinds.length} declared kind(s). It `
        + 'branches on at least one in reality, so this is the reader having broken rather than a '
        + 'finding about the service.');
}

const total = kinds.length * HALVES.length;

// Both numbers on every run, including the zeroes.
console.log(`marketplace-kinds: parser self-check ${FIXTURES.length} case(s) / `
    + `${FIXTURES.length - selfTestFailures} as expected.`);
console.log(`marketplace-kinds: ${kinds.length} kind(s) declared (${kinds.join(', ')}) · `
    + `${total - missing.length}/${total} halves present.`);

if (kinds.length === 0) {
    console.log('  ✘ the enum parsed to zero kinds, so this gate checked nothing.');
    process.exit(1);
}

for (const b of blind) console.log(b);
for (const { kind, half, reason } of missing) {
    console.log(`  ✘ '${kind}' has no ${half} branch — ${reason}. The catalogue table's own comment `
        + 'requires both halves, "because a silent fallthrough is how the wrong table gets '
        + 'written": a kind that can be installed and not removed leaves rows that nothing owns, '
        + 'and the un-import for a 1:1 kind is a different operation from the un-import for a 1:N '
        + 'one.');
}

if (selfTestFailures > 0 || blind.length > 0 || missing.length > 0) process.exit(1);
process.exit(0);
