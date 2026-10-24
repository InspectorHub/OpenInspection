#!/usr/bin/env node
/**
 * Stages the npm package of @inspectorhub/field-ui into a gitignored directory,
 * packages/field-ui/.publish/, which is the directory that gets packed and published.
 *
 * Why a staging directory: the published package carries the plain GNU AGPL v3 notice,
 * while the repository copy (packages/field-ui/LICENSE) keeps the project's additional
 * permission for its own deployments. npm always packs the LICENSE file that sits next to
 * package.json, so the only way to ship a different one without touching the repository
 * copy is to pack a directory that is built for the purpose. This script builds it.
 *
 * Deterministic: the directory is deleted and recreated on every run, and nothing is read
 * except dist/, package.json, README.md and the notice file. It refuses when dist/ is
 * missing, because an empty package is a worse failure than a loud one.
 *
 * Staged: dist/, package.json (generated from the source one), README.md, LICENSE (the
 * notice). Never staged: PUBLISHING.md, the notice directory, src/.
 *
 * Usage: node scripts/stage-field-ui-package.mjs     (after: npm run build -w @inspectorhub/field-ui)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PACKAGE_DIR = join(ROOT, 'packages', 'field-ui');
/** Not named `license/`: on a case-insensitive filesystem that collides with the LICENSE file. */
export const NOTICE_RELATIVE = join('publish-license', 'LICENSE-AGPL-3.0-only');

/** Manifest fields that survive staging. devDependencies and scripts are dropped on purpose. */
export const KEPT_FIELDS = [
    'name',
    'version',
    'description',
    'license',
    'repository',
    'type',
    'main',
    'types',
    'exports',
    'files',
    'sideEffects',
    'peerDependencies',
    'peerDependenciesMeta',
    'dependencies',
    'publishConfig',
];

/** Pure: the staged manifest for a source manifest. */
export function stagedManifest(source) {
    const out = {};
    for (const key of KEPT_FIELDS) if (source[key] !== undefined) out[key] = source[key];
    if (typeof out.name !== 'string' || out.name === '') throw new Error('stage-field-ui: the staged package.json has no name.');
    if (typeof out.version !== 'string' || out.version === '') throw new Error('stage-field-ui: the staged package.json has no version.');
    return out;
}

function listFiles(dir, base = dir) {
    const out = [];
    for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
        else out.push(full.slice(base.length + 1).split('\\').join('/'));
    }
    return out;
}

/**
 * Builds `outDir` from `packageDir`. Returns the manifest and the staged file list.
 * @param {{ packageDir?: string, outDir?: string }} [opts]
 */
export function stageFieldUi({ packageDir = DEFAULT_PACKAGE_DIR, outDir = join(packageDir, '.publish') } = {}) {
    const dist = join(packageDir, 'dist');
    if (!existsSync(dist) || !existsSync(join(dist, 'index.js'))) {
        throw new Error(`stage-field-ui: ${dist} is missing or has no index.js. Run: npm run build -w @inspectorhub/field-ui`);
    }
    const notice = join(packageDir, NOTICE_RELATIVE);
    if (!existsSync(notice)) throw new Error(`stage-field-ui: the licence notice ${notice} is missing.`);

    const manifest = stagedManifest(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')));

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    cpSync(dist, join(outDir, 'dist'), { recursive: true });
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    JSON.parse(manifestText); // must round-trip
    writeFileSync(join(outDir, 'package.json'), manifestText);
    cpSync(join(packageDir, 'README.md'), join(outDir, 'README.md'));
    writeFileSync(join(outDir, 'LICENSE'), readFileSync(notice));
    return { manifest, files: listFiles(outDir) };
}

function main() {
    try {
        const { manifest, files } = stageFieldUi();
        console.log(`stage-field-ui: staged ${manifest.name}@${manifest.version} into packages/field-ui/.publish (${files.length} files)`);
        for (const f of files) console.log(`  ${f}`);
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
