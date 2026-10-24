#!/usr/bin/env node
/**
 * Content scan of the npm tarball for @inspectorhub/field-ui, run before `npm publish`.
 *
 * The package is public and permanent: a published version cannot be unpublished
 * after a short window and stays in mirrors. Source gates read the repository; this
 * one reads what will actually be shipped — the tarball `npm pack` produces — so a
 * stray build artefact, an alias that leaked through the bundler, a key, or a path
 * from a developer machine is caught at the last point it can still be stopped.
 *
 * It scans the PACKED files (never the working tree), and prints both numbers: files
 * scanned and findings. Zero files scanned is a failure, not a pass (an empty set
 * reads as green).
 *
 * Extra patterns for terms that must not be written into a public repository can be
 * supplied at run time: PACKAGE_SCAN_EXTRA_PATTERNS is a JSON array of regex sources,
 * e.g. from a CI secret or a local shell. They are applied to every packed text file.
 *
 * Requiring the run-time patterns: without `--require-extra` (or PACKAGE_SCAN_REQUIRE_EXTRA=1) an
 * unset variable simply means "no extra patterns" and the scan says so. A release pipeline sets the
 * requirement, so a secret that was never configured, or was deleted, FAILS the run instead of silently
 * dropping the private-term check. An explicit empty list (`[]`) is the accepted way to opt out.
 *
 * Scanning a tarball that already exists: `--tarball=<file>` reads that file instead of packing the
 * workspace, so a pipeline can scan the exact bytes it is about to publish.
 *
 * What is scanned by default: the STAGED directory packages/field-ui/.publish (built by
 * `npm run stage:field-ui`), packed with `npm pack <dir>`. That directory is what gets published,
 * and it carries the plain AGPL LICENSE, so the scan also checks the licence text: the LICENSE must
 * be the plain AGPL notice, and neither it nor the README or package.json may mention an additional
 * permission. The workspace mode (`--workspace <name>`) packs the source package instead.
 *
 * Usage:
 *   node scripts/check-package-tarball.mjs [--dir <path> | --workspace <name> | --tarball=<file.tgz>] [--require-extra]
 *   (no target: the staged directory; it must exist, run `npm run stage:field-ui` first)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** Only these top-level entries may appear in the tarball. */
export const ALLOWED_TOP_LEVEL = ['dist/', 'README.md', 'LICENSE', 'package.json'];

/** Code-point ranges, so this file holds no CJK of its own: ideographs, extension A, symbols, fullwidth, Kana, Hangul. */
const CJK_RANGES = [
    [0x4e00, 0x9fff],
    [0x3400, 0x4dbf],
    [0x3000, 0x303f],
    [0xff00, 0xffef],
    [0x3040, 0x30ff], // Hiragana and Katakana
    [0xac00, 0xd7af], // Hangul syllables
    [0x1100, 0x11ff], // Hangul Jamo
];

const hasCjk = (text) => {
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        if (CJK_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) return true;
    }
    return false;
};

const RULES = [
    { id: 'alias-leak', why: 'a build-time path alias reached the output', re: /@core\//g },
    { id: 'source-map', why: 'a source map reference or file ships original sources', re: /sourceMappingURL/g },
    {
        id: 'secret-shape',
        why: 'looks like a credential',
        re: /(sk_live_|sk_test_|whsec_|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|Bearer [A-Za-z0-9._-]{24,}|(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9+/_-]{24,}["'])/gi,
    },
    {
        id: 'local-path',
        why: 'a path from a developer machine',
        re: /(?:[A-Za-z]:\\{1,2}(?:Users|Code|Projects)\\{1,2}|\/home\/[a-z][\w.-]*\/|\/Users\/[A-Za-z][\w.-]*\/|\.worktrees)/g,
    },
];

export const STAGED_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'field-ui', '.publish');

/** Wording that must not appear in the shipped README or package.json. */
const PERMISSION_MENTION = /additional permission|section 7|self-hosted/i;

/** Pure scan over `{ path -> text }`, so it is testable without a tarball. */
export function scanFiles(files, extraPatterns = []) {
    const findings = [];
    const extra = extraPatterns.map((src) => ({ id: 'extra-pattern', why: 'matched a run-time pattern', re: new RegExp(src, 'gi') }));
    for (const [path, text] of Object.entries(files)) {
        if (!ALLOWED_TOP_LEVEL.some((a) => (a.endsWith('/') ? path.startsWith(a) : path === a))) {
            findings.push({ path, id: 'unexpected-file', why: 'not in the allowed file set', sample: '' });
        }
        if (path.endsWith('.map')) findings.push({ path, id: 'source-map', why: 'source map file', sample: '' });
        if (path === 'LICENSE') {
            if (!text.includes('GNU AFFERO GENERAL PUBLIC LICENSE')) {
                findings.push({ path, id: 'license-missing-agpl', why: 'LICENSE does not carry the GNU AGPL title', sample: '' });
            }
            const m = /additional permission|section 7/i.exec(text);
            if (m) findings.push({ path, id: 'license-extra-permission', why: 'LICENSE carries an additional permission', sample: m[0] });
        }
        if (path === 'README.md' || path === 'package.json') {
            const m = PERMISSION_MENTION.exec(text);
            if (m) findings.push({ path, id: 'license-extra-permission-mention', why: 'mentions a licence permission or self-hosting', sample: m[0] });
        }
        if (hasCjk(text)) findings.push({ path, id: 'cjk', why: 'non-English CJK text', sample: '' });
        for (const rule of [...RULES, ...extra]) {
            rule.re.lastIndex = 0;
            const m = rule.re.exec(text);
            if (m) findings.push({ path, id: rule.id, why: rule.why, sample: m[0].slice(0, 40) });
        }
    }
    return findings;
}

/** Minimal ustar reader: names and bodies of regular files, `package/` prefix stripped. */
export function readTarball(gz) {
    const tar = gunzipSync(gz);
    const files = {};
    let off = 0;
    while (off + 512 <= tar.length) {
        const header = tar.subarray(off, off + 512);
        if (header.every((b) => b === 0)) break;
        const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
        const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
        const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
        const type = String.fromCharCode(header[156] || 48);
        off += 512;
        if (type === '0' || type === '\0') {
            const full = (prefix ? `${prefix}/` : '') + name;
            files[full.replace(/^package\//, '')] = tar.subarray(off, off + size).toString('utf8');
        }
        off += Math.ceil(size / 512) * 512;
    }
    return files;
}

/**
 * The run-time patterns from the environment. Throws (with the reason) when the value is not a JSON array of
 * strings, or, when `require` is set, when it is unset or empty. `[]` is a deliberate opt-out and is accepted.
 */
export function resolveExtraPatterns(raw, require = false) {
    if (raw === undefined || raw.trim() === '') {
        if (require) {
            throw new Error('PACKAGE_SCAN_EXTRA_PATTERNS is not set (or is empty) but the run requires it. Set it to a JSON array of regex sources, or to [] to run without private-term patterns on purpose.');
        }
        return [];
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('PACKAGE_SCAN_EXTRA_PATTERNS is not valid JSON; expected an array of regex sources.');
    }
    if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) {
        throw new Error('PACKAGE_SCAN_EXTRA_PATTERNS must be a JSON array of strings.');
    }
    return parsed;
}

function pack(target) {
    const dir = mkdtempSync(join(tmpdir(), 'pkg-scan-'));
    try {
        const selector = target.dir ? [target.dir] : ['-w', target.workspace];
        const out = execFileSync('npm', ['pack', ...selector, '--pack-destination', dir, '--json'], {
            encoding: 'utf8',
            shell: process.platform === 'win32',
            stdio: ['ignore', 'pipe', 'inherit'],
        });
        const [{ filename }] = JSON.parse(out);
        return readTarball(readFileSync(join(dir, filename)));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function main() {
    const args = process.argv.slice(2);
    const flagValue = (name) => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const workspace = flagValue('--workspace');
    const dirArg = flagValue('--dir');
    const tarballArg = args.find((a) => a.startsWith('--tarball='));
    const target = workspace ? { workspace } : { dir: resolve(dirArg ?? STAGED_DIR) };
    const label = workspace ?? target.dir;
    const require = args.includes('--require-extra') || process.env.PACKAGE_SCAN_REQUIRE_EXTRA === '1';
    let extra;
    try {
        extra = resolveExtraPatterns(process.env.PACKAGE_SCAN_EXTRA_PATTERNS, require);
    } catch (err) {
        console.error(`check-package-tarball: ${err.message}`);
        process.exit(1);
    }
    if (!tarballArg && target.dir && !existsSync(target.dir)) {
        console.error(`check-package-tarball: ${target.dir} does not exist. Run: npm run stage:field-ui`);
        process.exit(1);
    }
    const files = tarballArg ? readTarball(readFileSync(tarballArg.slice('--tarball='.length))) : pack(target);
    const count = Object.keys(files).length;
    if (count === 0) {
        console.error(`check-package-tarball: 0 files in the tarball of ${label} — an empty scan is not a pass.`);
        process.exit(1);
    }
    const findings = scanFiles(files, extra);
    console.log(`check-package-tarball: ${count} packed files scanned, ${findings.length} findings, ${extra.length} run-time patterns applied.`);
    for (const f of findings) console.error(`  ✗ ${f.path} [${f.id}] ${f.why}${f.sample ? ` — "${f.sample}"` : ''}`);
    process.exit(findings.length === 0 ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
