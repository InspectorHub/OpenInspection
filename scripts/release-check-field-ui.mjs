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
 * It serves every package in scripts/lib/release-packages.mjs; `--package <slug>` picks one
 * (default field-ui) and the names above change accordingly (tag prefix, manifest key, directory).
 *
 * Usage: node scripts/release-check-field-ui.mjs [--package <slug>] [--skip-build] [--require-extra]
 *   --skip-build     reuse the existing packages/field-ui/dist
 *   --require-extra  passed to the scan (a release pipeline sets it; pull requests do not,
 *                    because secrets are absent on fork PRs)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, getPackage, packageSlugFromArgs } from './lib/release-packages.mjs';

const SHELL = process.platform === 'win32';
export const TAG_PREFIX = getPackage('field-ui').tagPrefix;

/**
 * Pure. Returns the list of problems (empty when coherent). `tag` is optional; `slug` names the package
 * (default field-ui).
 * @param {{ slug?: string, manifestVersion?: string, packageVersion?: string, tag?: string }} v
 */
export function checkCoherence({ slug = 'field-ui', manifestVersion, packageVersion, tag }) {
    const { dir, manifestKey, tagPrefix } = getPackage(slug);
    const problems = [];
    if (!packageVersion) problems.push(`${dir}/package.json has no version.`);
    if (!manifestVersion) problems.push(`.release-please-manifest.json has no "${manifestKey}" entry.`);
    if (manifestVersion && packageVersion && manifestVersion !== packageVersion) {
        problems.push(
            `version mismatch: .release-please-manifest.json says ${manifestVersion} but ${dir}/package.json says ${packageVersion}. They must be bumped together.`,
        );
    }
    if (tag !== undefined && packageVersion && tag !== `${tagPrefix}${packageVersion}`) {
        problems.push(`tag mismatch: the tag is ${tag} but ${dir}/package.json says ${packageVersion} (expected ${tagPrefix}${packageVersion}).`);
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

/**
 * Pure. The names a built declaration file exports: the specifiers of its `export { ... }` (values)
 * and `export type { ... }` (types) statements, using the exported name of `x as y`. Throws when it
 * finds none, because an empty surface would read as a match against an empty list.
 */
export function parseDtsExports(text) {
    const values = [];
    const types = [];
    for (const m of text.matchAll(/^export (type )?\{([^}]*)\}/gm)) {
        const into = m[1] ? types : values;
        for (const raw of m[2].split(',')) {
            const spec = raw.trim();
            if (spec === '') continue;
            const inlineType = /^type\s+/.test(spec);
            const name = spec.replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
            (inlineType ? types : into).push(name);
        }
    }
    if (values.length + types.length === 0) throw new Error('the declaration file has no export statement to read.');
    return { values: [...new Set(values)].sort(), types: [...new Set(types)].sort() };
}

/**
 * Pure. Compares the committed surface (api-surface.json) with the built one; returns the problems
 * (empty when they match). A committed surface with no names is itself a problem.
 */
export function surfaceProblems(expected, built) {
    const problems = [];
    if (expected.values.length + expected.types.length === 0) {
        problems.push('api-surface.json is empty: an empty list proves nothing.');
        return problems;
    }
    const diff = (kind, want, got) => {
        const missing = want.filter((n) => !got.includes(n));
        const extra = got.filter((n) => !want.includes(n));
        if (missing.length > 0) problems.push(`${kind} exports missing from the build: ${missing.join(', ')}`);
        if (extra.length > 0) problems.push(`${kind} exports in the build that are not in api-surface.json: ${extra.join(', ')}`);
    };
    diff('value', expected.values, built.values);
    diff('type', expected.types, built.types);
    return problems;
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

/**
 * When the package commits an api-surface.json, the built declaration file must export exactly those
 * names. With `"loadable": true` the built dist/index.js is also imported in a child process and its
 * runtime keys must equal `values`. A package without the file is not checked (field-ui has none).
 */
function checkBuiltSurface(dir) {
    const file = join(ROOT, ...dir.split('/'), 'api-surface.json');
    if (!existsSync(file)) {
        console.log('\n== surface\nno api-surface.json for this package; skipped');
        return;
    }
    console.log('\n== surface');
    const expected = readJson(file);
    const built = parseDtsExports(readFileSync(join(ROOT, ...dir.split('/'), 'dist', 'index.d.ts'), 'utf8'));
    const problems = surfaceProblems(expected, built);
    if (expected.loadable === true) {
        const url = pathToFileURL(join(ROOT, ...dir.split('/'), 'dist', 'index.js')).href;
        const out = execFileSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(url)}).then((m) => console.log(JSON.stringify(Object.keys(m).sort())))`], { encoding: 'utf8' });
        const runtime = JSON.parse(out);
        const want = [...expected.values].sort();
        if (JSON.stringify(runtime) !== JSON.stringify(want)) problems.push(`runtime keys of dist/index.js differ from api-surface.json: built ${runtime.length} keys, listed ${want.length}.`);
    }
    if (problems.length > 0) {
        for (const p of problems) console.error(`release-check-field-ui: ${p}`);
        process.exit(1);
    }
    console.log(`built declaration file matches api-surface.json: ${built.values.length} values, ${built.types.length} types${expected.loadable === true ? '; runtime keys match' : ''}`);
}

function main() {
    const args = process.argv.slice(2);
    const slug = packageSlugFromArgs(args);
    const { name, dir, manifestKey } = getPackage(slug);
    const pkg = readJson(join(ROOT, dir, 'package.json'));
    const manifest = readJson(join(ROOT, '.release-please-manifest.json'));
    const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;

    console.log('== coherence');
    const problems = checkCoherence({ slug, manifestVersion: manifest[manifestKey], packageVersion: pkg.version, tag });
    if (problems.length > 0) {
        for (const p of problems) console.error(`release-check-field-ui: ${p}`);
        process.exit(1);
    }
    console.log(`manifest, package.json${tag ? ' and tag' : ''} agree on ${pkg.version}`);

    if (!args.includes('--skip-build')) step('build', 'npm', ['run', 'build', '-w', name]);
    checkBuiltSurface(dir);
    step('stage', 'npm', ['run', `stage:${slug}`]);
    const scanArgs = ['scripts/check-package-tarball.mjs', '--package', slug];
    if (args.includes('--require-extra')) scanArgs.push('--require-extra');
    step('scan', process.execPath, scanArgs);

    console.log('\n== pack (dry run)');
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', join(...dir.split('/'), '.publish')], {
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
