#!/usr/bin/env node
/**
 * Every tracked TEXT file is stored with LF line endings. No CRLF, no lone CR.
 *
 * ── The failure this exists to prevent ──────────────────────────────────────
 * On 2026-09-04 a Python script rewrote a message catalogue on this Windows
 * machine. It changed three keys. Python's text mode translates `\n` to the
 * platform newline on write, so it also converted every OTHER line in the file
 * from LF to CRLF — silently, with no error and nothing in the script that
 * mentioned line endings. The commit looked like a three-key edit and was a
 * whole-file rewrite. On somebody else's branch it stopped being a three-line
 * merge and became a conflict in every line of the file.
 *
 * That is the shape: the tool that damages the file is never the tool that
 * reports it, the damage is invisible in the editor, and the cost is paid by a
 * different person on a different branch some days later.
 *
 * ── Why a lone CR is a separate and worse case ──────────────────────────────
 * `git ls-files --eol` classifies a file as `-text` — BINARY — if it contains a
 * single CR that is not part of a CRLF pair. Not a NUL: one bare CR is enough.
 * So a lone CR does everything a raw NUL does (see `check-raw-nul.mjs`, this
 * gate's sibling): `git grep`, ripgrep and every review diff answer
 * "Binary file ... matches" with no line, no line number and no context, while
 * the file compiles and behaves normally because JavaScript treats CR as a line
 * terminator like any other.
 *
 * Measured in this repository on 2026-09-05, before this gate existed: TEN
 * `.ts`/`.tsx` files were binary to git for exactly that reason. Nine of them
 * carried the same single artefact — an inserted `import` line whose offset had
 * been computed against LF text and applied to a CRLF file, splitting one CRLF
 * pair in half. One (`app/components/oauth/ConsentForm.tsx`) had 154 of them,
 * from a tool that ran CRLF conversion over a file that was already CRLF. Not
 * one of those files was reported by anything. They had been unreviewable in a
 * diff for as long as they had been that way.
 *
 * ── What this does NOT protect ──────────────────────────────────────────────
 * `.gitattributes` (`* text=auto eol=lf`) is the primary control and it is the
 * one that matters: it normalises on commit, so a CRLF working file becomes an
 * LF blob without anybody noticing. This gate is the second layer, for the two
 * holes that leaves. First, `text=auto` decides text-vs-binary with git's own
 * heuristic, and that heuristic calls a lone-CR file binary — so the exact
 * corruption above is the one case `text=auto` declines to fix. Second, an
 * attribute silently stops applying when a pattern is wrong or a file is added
 * under a path nobody thought about, and an attribute that stopped applying
 * looks exactly like an attribute that is working.
 *
 * ── The escape, when a CR is genuinely wanted ───────────────────────────────
 * Same answer as the NUL gate: write the escape, not the byte. `'\r\n'` in
 * source is two characters that no line-ending tool will ever touch and that
 * produce the same string at runtime. A test asserting on CRLF protocol framing
 * should build it, not store it. If a file genuinely must hold raw bytes, its
 * extension belongs in BINARY_EXTS below — one line, and a reviewer can see it.
 *
 * Usage: node scripts/check-line-endings.mjs [--fix] [--self-test]
 *   --fix        rewrite offending tracked files to LF in place
 *   --self-test  prove the scanner detects planted faults, then exit
 */
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const CR = 0x0d;
const LF = 0x0a;

/**
 * Extensions whose contents are bytes rather than source. Listed explicitly,
 * for the reason `check-raw-nul.mjs` gives at length: "is this file binary" is
 * the question this gate would be answering with the very thing it measures. A
 * lone CR is what makes git call a file binary, so asking git would make the
 * gate agree with the corruption instead of reporting it.
 *
 * Kept in sync with BINARY_EXTS in check-raw-nul.mjs on purpose — the two gates
 * skip the same set for the same reason.
 */
const BINARY_EXTS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'icns', 'bmp',
    'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot',
    'zip', 'gz', 'tgz', 'br', 'wasm', 'sqlite', 'db',
    'mp3', 'mp4', 'webm', 'ogg', 'wav', 'mov',
]);

const extOf = (path) => {
    const base = path.slice(path.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
};

/**
 * Count CRLF pairs and lone CRs in a buffer.
 *
 * A CR immediately followed by LF is one pair and the LF is not re-examined; any
 * other CR is lone. This is git's own accounting in `convert.c:gather_stats`,
 * which is what decides whether `git ls-files --eol` prints `crlf`, `mixed` or
 * `-text` — matching it is what lets this gate's numbers be compared against
 * git's without translating between two definitions of the same word.
 */
function countCarriageReturns(buf) {
    let crlf = 0;
    let lonecr = 0;
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== CR) continue;
        if (i + 1 < buf.length && buf[i + 1] === LF) {
            crlf += 1;
            i += 1;
        } else {
            lonecr += 1;
        }
    }
    return { crlf, lonecr };
}

/**
 * Rewrite every line terminator to LF.
 *
 * CRLF collapses to one LF; a remaining lone CR becomes its own LF. That second
 * rule is deliberate and it is not a no-op: every runtime that reads these files
 * — JavaScript, JSON, git's diff — already treats a bare CR as a line break, so
 * turning it into LF preserves the number of lines the file has always had. The
 * tempting alternative, dropping a lone CR that sits directly before a CRLF,
 * would silently DELETE a blank line from ten files in this repository.
 */
function toLf(buf) {
    const out = Buffer.allocUnsafe(buf.length);
    let n = 0;
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === CR) {
            out[n++] = LF;
            if (i + 1 < buf.length && buf[i + 1] === LF) i += 1;
            continue;
        }
        out[n++] = buf[i];
    }
    return out.subarray(0, n);
}

// ── Self-test ───────────────────────────────────────────────────────────────
// A scanner whose job is to report absence must be shown finding something
// before it is allowed to report finding nothing. Four probes: the two faults
// this gate names, and two things it must NOT flag — a clean LF file, and the
// two-character source escape that is the sanctioned way to write a CR.
const probes = [
    { name: 'CRLF file', buf: Buffer.from('a\r\nb\r\n', 'utf8'), crlf: 2, lonecr: 0 },
    { name: 'lone CR (split CRLF pair)', buf: Buffer.from('a\r\r\nb\n', 'utf8'), crlf: 1, lonecr: 1 },
    { name: 'clean LF file', buf: Buffer.from('a\nb\n', 'utf8'), crlf: 0, lonecr: 0 },
    // Backslash-r in SOURCE: two characters, 0x5c 0x72. Must read as clean.
    { name: 'escaped \\r in source', buf: Buffer.from('const s = "a\\r\\nb";\n', 'utf8'), crlf: 0, lonecr: 0 },
];

const selfTestFailures = [];
for (const p of probes) {
    const got = countCarriageReturns(p.buf);
    if (got.crlf !== p.crlf || got.lonecr !== p.lonecr) {
        selfTestFailures.push(
            `   ${p.name}: got crlf=${got.crlf} lonecr=${got.lonecr}, expected crlf=${p.crlf} lonecr=${p.lonecr}`,
        );
    }
    // The repair must be idempotent and must not lose or invent a line.
    const fixed = toLf(p.buf);
    if (countCarriageReturns(fixed).crlf || countCarriageReturns(fixed).lonecr) {
        selfTestFailures.push(`   ${p.name}: toLf() left a CR behind`);
    }
    const linesBefore = p.buf.toString('utf8').split(/\r\n|\r|\n/).length;
    const linesAfter = fixed.toString('utf8').split('\n').length;
    if (linesBefore !== linesAfter) {
        selfTestFailures.push(
            `   ${p.name}: toLf() changed the line count (${linesBefore} → ${linesAfter})`,
        );
    }
}

if (selfTestFailures.length) {
    console.error('\n[line-endings] BROKEN — the scanner failed its own self-test.');
    console.error(selfTestFailures.join('\n'));
    console.error('Until this is fixed, a clean scan means nothing.\n');
    process.exit(1);
}

if (process.argv.slice(2).includes('--self-test')) {
    console.log(`\n[line-endings] self-test OK — ${probes.length} probes: CRLF and lone CR are`);
    console.log('detected, a clean LF file and a source-level `\\r` escape are not, and the');
    console.log('repair preserves the line count of all four.\n');
    process.exit(0);
}

// ── Attributes ──────────────────────────────────────────────────────────────

/**
 * Resolve `text` and `eol` for a list of paths through git's own attribute
 * machinery, so this gate and `.gitattributes` cannot drift apart.
 *
 * This is NOT the circular question `check-raw-nul.mjs` warns against. Asking
 * git "is this file binary" would answer with the heuristic, and a lone CR is
 * exactly what makes that heuristic say yes — the gate would agree with the
 * corruption. Asking for the ATTRIBUTE reads a line somebody wrote in
 * `.gitattributes` on purpose. A declaration, not a guess.
 *
 * Paths need not exist; attributes are matched on the path string.
 */
function gitAttributes(paths) {
    if (paths.length === 0) return new Map();
    const out = execFileSync('git', ['check-attr', '--stdin', '-z', 'text', 'eol'], {
        // ⚠️ `-z` makes the INPUT NUL-separated too, not just the output.
        // Newline-separated input is read as ONE enormous path, and every
        // lookup then silently returns "unspecified" — which this gate would
        // read as "scan everything", i.e. it fails safe, but it would also make
        // every declared exemption stop working with no error anywhere.
        input: Buffer.from(paths.join('\0') + '\0', 'utf8'),
        maxBuffer: 256 * 1024 * 1024,
    }).toString('utf8');
    const f = out.split('\0');
    const map = new Map();
    for (let i = 0; i + 2 < f.length; i += 3) {
        if (!map.has(f[i])) map.set(f[i], {});
        map.get(f[i])[f[i + 1]] = f[i + 2];
    }
    return map;
}

/**
 * Prove the `.gitattributes` rules are actually IN FORCE before trusting them.
 *
 * The bytes on disk cannot show this. If somebody narrows `* text=auto eol=lf`
 * or deletes the file, every tracked file is still LF that day and this gate is
 * still green — while the protection that keeps a Windows checkout from handing
 * the files back as CRLF is simply gone. That regression is invisible until the
 * next clone, which is the definition of something that needs a check.
 *
 * Probes are synthetic paths, deliberately: a probe pointed at a real file
 * stops testing the rule the moment somebody deletes the file.
 */
const ATTR_PROBES = [
    { path: 'probe.ts', eol: 'lf' },
    { path: 'app/nested/deep/probe.tsx', eol: 'lf' },
    { path: 'messages/en/probe.json', eol: 'lf' },
    { path: 'docs/probe.md', eol: 'lf' },
    { path: 'migrations/probe.sql', eol: 'lf' },
    { path: 'scripts/probe.mjs', eol: 'lf' },
    { path: '.githooks/probe', eol: 'lf' },
    { path: 'probe.sh', eol: 'lf' },
    // The declared exceptions. If these stop resolving, the exemption logic
    // below is dead code and nobody would find out from a green run.
    { path: 'probe.bat', eol: 'crlf' },
    { path: 'probe.cmd', eol: 'crlf' },
    { path: 'probe.png', text: 'unset' },
];

const probeAttrs = gitAttributes(ATTR_PROBES.map((p) => p.path));
const attrFailures = [];
for (const probe of ATTR_PROBES) {
    const got = probeAttrs.get(probe.path) ?? {};
    if (probe.eol && got.eol !== probe.eol) {
        attrFailures.push(`   ${probe.path}: eol is "${got.eol ?? 'unspecified'}", expected "${probe.eol}"`);
    }
    if (probe.text && got.text !== probe.text) {
        attrFailures.push(`   ${probe.path}: text is "${got.text ?? 'unspecified'}", expected "${probe.text}"`);
    }
}

if (attrFailures.length) {
    console.error('\n[line-endings] .gitattributes is not doing what this gate assumes:\n');
    console.error(attrFailures.join('\n'));
    console.error('\nThe files on disk may still be LF today — that is not the point. Without');
    console.error('these rules a Windows clone checks them back out as CRLF and the next');
    console.error('in-place rewrite commits it. Restore the rules in .gitattributes, or update');
    console.error('ATTR_PROBES here if the policy genuinely changed.\n');
    process.exit(1);
}

// ── The scan ────────────────────────────────────────────────────────────────

const FIX = process.argv.slice(2).includes('--fix');

const tracked = execSync('git ls-files -z', { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter((p) => p !== '');

const attrs = gitAttributes(tracked);
if (tracked.length && attrs.size === 0) {
    console.error('[line-endings] git check-attr returned attributes for ZERO paths — the');
    console.error('  attribute lookup is broken, so every exemption below is unverifiable.\n');
    process.exit(1);
}

const hits = [];
let scanned = 0;
let skippedDeclaredBinary = 0;
let skippedBinary = 0;
let declaredCrlf = 0;
let unreadable = 0;
let fixedCount = 0;

for (const path of tracked) {
    const attr = attrs.get(path) ?? {};
    // Declared binary in .gitattributes (`binary` macro, or `-text`). The
    // repository said so; that outranks anything inferred here.
    if (attr.text === 'unset') { skippedDeclaredBinary += 1; continue; }
    // Second line of defence, kept in step with check-raw-nul.mjs: a byte format
    // that nobody has declared yet. Counted separately so the difference between
    // "declared" and "guessed by extension" stays visible on every run.
    if (BINARY_EXTS.has(extOf(path))) { skippedBinary += 1; continue; }
    let buf;
    try {
        buf = readFileSync(path);
    } catch {
        // A tracked path the working tree does not hold (a deletion staged
        // elsewhere). Counted, never silently folded into "clean".
        unreadable += 1;
        continue;
    }
    scanned += 1;
    const { crlf, lonecr } = countCarriageReturns(buf);
    if (!crlf && !lonecr) continue;

    // A file `.gitattributes` pins to `eol=crlf` — a `.bat`, or a fixture whose
    // CRLF is the thing under test — is SUPPOSED to have CRLF. A lone CR is
    // still a fault there: nothing wants a half-terminator, and it makes the
    // file binary to git whatever its eol attribute says.
    if (attr.eol === 'crlf') {
        declaredCrlf += 1;
        if (!lonecr) continue;
        hits.push({ path, crlf: 0, lonecr, declaredCrlf: true });
        continue;
    }

    hits.push({ path, crlf, lonecr });
    if (FIX) {
        writeFileSync(path, toLf(buf));
        fixedCount += 1;
    }
}

// Both numbers, always. This gate expects zero hits forever, so "nothing wrong"
// and "looked at nothing" would otherwise print the same word.
console.log(`\n[line-endings] ${tracked.length} tracked path(s): ${scanned} scanned · `
    + `${skippedDeclaredBinary} declared binary in .gitattributes · `
    + `${skippedBinary} skipped as binary by extension · `
    + `${declaredCrlf} declared eol=crlf · ${unreadable} unreadable`);

if (scanned === 0) {
    console.error('[line-endings] scanned ZERO files. A scan of nothing is not a clean scan.\n');
    process.exit(1);
}

if (FIX) {
    console.log(`[line-endings] --fix rewrote ${fixedCount} of ${scanned} scanned file(s) to LF:\n`);
    for (const h of hits) {
        console.log(`   ${h.path} (${h.crlf} CRLF, ${h.lonecr} lone CR)`);
    }
    console.log('\nRe-run without --fix to confirm, then review the diff before committing.\n');
    process.exit(0);
}

if (hits.length) {
    const withLoneCr = hits.filter((h) => h.lonecr).length;
    console.error(`\n${hits.length} of ${scanned} scanned text file(s) are not stored with LF endings`
        + `${withLoneCr ? ` — ${withLoneCr} of them BINARY to git because of a lone CR` : ''}:\n`);
    for (const h of hits) {
        const marks = [];
        if (h.crlf) marks.push(`${h.crlf} CRLF`);
        if (h.lonecr) marks.push(`${h.lonecr} lone CR → git calls this file BINARY`);
        if (h.declaredCrlf) marks.push('its CRLF is declared and fine; the lone CR is not');
        console.error(`   ${h.path} (${marks.join(', ')})`);
    }
    console.error('\nA CRLF rewrite turns a three-line edit into a whole-file diff, and a merge');
    console.error('into a conflict on every line. A lone CR additionally makes the file binary');
    console.error('to git grep, ripgrep and every review diff.');
    console.error('\nFix: npm run lint:eol -- --fix   (rewrites the files above to LF in place)');
    console.error('If a file genuinely holds bytes, add its extension to BINARY_EXTS instead.');
    console.error('If a CR is genuinely wanted in source, write the escape `\\r`, not the byte.\n');
    process.exit(1);
}

console.log(`   ✓ all ${scanned} tracked text file(s) use LF.\n`);
