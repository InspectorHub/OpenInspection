#!/usr/bin/env node
/**
 * One preflight for @inspectorhub/field-ui, identical locally and in CI:
 *
 *   coherence -> build -> stage -> scan -> `npm pack --dry-run` of the staged directory
 *
 * and then a report: the file list, the packed and unpacked size, and the sha512 of the
 * tarball that would be produced. When $GITHUB_STEP_SUMMARY is set the same report is
 * appended to it as markdown.
 *
 * Coherence means three version numbers agree: .release-please-manifest.json
 * ["packages/field-ui"], packages/field-ui/package.json, and, in CI on a tag, the tag
 * (`field-ui-vX.Y.Z`). The first release-please release bumps the first two together.
 *
 * Usage: node scripts/release-check-field-ui.mjs [--skip-build] [--require-extra]
 *   --skip-build     reuse the existing packages/field-ui/dist
 *   --require-extra  passed to the scan (a release pipeline sets it; pull requests do not,
 *                    because secrets are absent on fork PRs)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = process.platform === 'win32';
export const TAG_PREFIX = 'field-ui-v';

/**
 * Pure. Returns the list of problems (empty when coherent). `tag` is optional.
 * @param {{ manifestVersion?: string, packageVersion?: string, tag?: string }} v
 */
export function checkCoherence({ manifestVersion, packageVersion, tag }) {
    const problems = [];
    if (!packageVersion) problems.push('packages/field-ui/package.json has no version.');
    if (!manifestVersion) problems.push('.release-please-manifest.json has no "packages/field-ui" entry.');
    if (manifestVersion && packageVersion && manifestVersion !== packageVersion) {
        problems.push(
            `version mismatch: .release-please-manifest.json says ${manifestVersion} but packages/field-ui/package.json says ${packageVersion}. They must be bumped together.`,
        );
    }
    if (tag !== undefined && packageVersion && tag !== `${TAG_PREFIX}${packageVersion}`) {
        problems.push(`tag mismatch: the tag is ${tag} but packages/field-ui/package.json says ${packageVersion} (expected ${TAG_PREFIX}${packageVersion}).`);
    }
    return problems;
}

/** Pure. `npm pack --dry-run --json` output -> the facts the report needs. */
export function parsePackJson(text) {
    const parsed = JSON.parse(text);
    const entry = Array.isArray(parsed) ? parsed[0] : undefined;
    if (!entry || !Array.isArray(entry.files) || entry.files.length === 0) throw new Error('npm pack reported no files.');
    if (typeof entry.integrity !== 'string' || !entry.integrity.startsWith('sha512-')) throw new Error('npm pack reported no sha512 integrity.');
    return {
        name: entry.name,
        version: entry.version,
        filename: entry.filename,
        size: entry.size,
        unpackedSize: entry.unpackedSize,
        integrity: entry.integrity,
        shasum: entry.shasum,
        files: entry.files.map((f) => ({ path: f.path, size: f.size })).sort((a, b) => a.path.localeCompare(b.path)),
    };
}

/** Pure. A readable report; `markdown` switches to a step-summary table. */
export function formatReport(pack, { markdown = false } = {}) {
    const head = `${pack.name}@${pack.version}  ${pack.files.length} files  packed ${pack.size} B  unpacked ${pack.unpackedSize} B`;
    if (!markdown) {
        return [head, ...pack.files.map((f) => `  ${String(f.size).padStart(9)}  ${f.path}`), `  sha512 ${pack.integrity}`].join('\n');
    }
    return [
        `### ${pack.name}@${pack.version}`,
        '',
        `${pack.files.length} files, packed ${pack.size} B, unpacked ${pack.unpackedSize} B`,
        '',
        '| File | Bytes |',
        '|---|---:|',
        ...pack.files.map((f) => `| \`${f.path}\` | ${f.size} |`),
        '',
        `sha512: \`${pack.integrity}\``,
        '',
    ].join('\n');
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function step(title, cmd, args) {
    console.log(`\n== ${title}`);
    const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: SHELL });
    if (r.status !== 0) {
        console.error(`release-check-field-ui: step "${title}" failed (exit ${r.status}).`);
        process.exit(r.status || 1);
    }
}

function main() {
    const args = process.argv.slice(2);
    const pkg = readJson(join(ROOT, 'packages', 'field-ui', 'package.json'));
    const manifest = readJson(join(ROOT, '.release-please-manifest.json'));
    const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;

    console.log('== coherence');
    const problems = checkCoherence({ manifestVersion: manifest['packages/field-ui'], packageVersion: pkg.version, tag });
    if (problems.length > 0) {
        for (const p of problems) console.error(`release-check-field-ui: ${p}`);
        process.exit(1);
    }
    console.log(`manifest, package.json${tag ? ' and tag' : ''} agree on ${pkg.version}`);

    if (!args.includes('--skip-build')) step('build', 'npm', ['run', 'build', '-w', '@inspectorhub/field-ui']);
    step('stage', 'npm', ['run', 'stage:field-ui']);
    const scanArgs = ['scripts/check-package-tarball.mjs'];
    if (args.includes('--require-extra')) scanArgs.push('--require-extra');
    step('scan', process.execPath, scanArgs);

    console.log('\n== pack (dry run)');
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', join('packages', 'field-ui', '.publish')], {
        cwd: ROOT,
        encoding: 'utf8',
        shell: SHELL,
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    const pack = parsePackJson(out);
    if (pack.version !== pkg.version) {
        console.error(`release-check-field-ui: the staged package is ${pack.version} but the source is ${pkg.version}.`);
        process.exit(1);
    }
    console.log(formatReport(pack));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${formatReport(pack, { markdown: true })}\n`);
    console.log('\nrelease-check-field-ui: OK');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
