#!/usr/bin/env node
/**
 * Manual publish helper for @inspectorhub/field-ui (the first publish, or any publish done by
 * hand). Dry run by default; `--confirm` publishes. It never runs in CI: CI publishes through
 * trusted publishing in .github/workflows/publish-field-ui.yml.
 *
 * Checks, in order:
 *   1. the git tree is clean (the gitignored staging directory does not count); a warning in a
 *      dry run, a refusal with --confirm
 *   2. the staged package exists and its version equals the source package.json version
 *   3. the version is not already on the registry (an E404 means "not published")
 *   4. no scoped registry setting points the package somewhere else; the registry is ALWAYS
 *      passed explicitly (some machines default to a mirror, which a publish must never reach)
 *   5. npm is logged in (`npm whoami`); in a dry run a failure is a warning
 *   6. the same scan as CI, right before publishing (--require-extra only when
 *      PACKAGE_SCAN_EXTRA_PATTERNS is set)
 * then `npm publish <staged dir> --access public --registry <official>` with inherited stdio,
 * so npm's own prompt takes the one-time code (it is never read or stored here), and finally a
 * post-publish `npm view` check printing the version and dist.integrity.
 *
 * Usage: node scripts/publish-field-ui.mjs [--confirm]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = process.platform === 'win32';
export const OFFICIAL_REGISTRY = 'https://registry.npmjs.org';
export const PACKAGE_NAME = '@inspectorhub/field-ui';
export const STAGED = join(ROOT, 'packages', 'field-ui', '.publish');

/** Pure. `npm config get` prints "undefined" or "null" for an unset key. Returns the URL without a trailing slash, or null. */
export function parseRegistry(output) {
    const v = String(output ?? '').trim();
    if (v === '' || v === 'undefined' || v === 'null') return null;
    return v.replace(/\/+$/, '');
}

export const isOfficialRegistry = (url) => url !== null && parseRegistry(url) === OFFICIAL_REGISTRY;

/** Pure. Equal only when both are the same non-empty string. */
export const versionsEqual = (a, b) => typeof a === 'string' && a !== '' && a === b;

/**
 * Is `name@version` on the registry? `exec(cmd, args)` returns `{ status, stdout, stderr }`.
 * E404 (no such version or package) means not published; any other failure throws, because
 * "could not tell" must not read as "not published".
 */
export function versionExists(exec, name, version, registry = OFFICIAL_REGISTRY) {
    const r = exec('npm', ['view', `${name}@${version}`, 'version', '--registry', registry]);
    if (r.status === 0) return String(r.stdout).trim() === version;
    if (/E404|404 Not Found/i.test(`${r.stderr}${r.stdout}`)) return false;
    throw new Error(`could not read ${name}@${version} from ${registry}: ${String(r.stderr).trim().slice(0, 200) || `exit ${r.status}`}`);
}

/** Pure. Lines of `git status --porcelain` that make the tree dirty. */
export const dirtyLines = (porcelain) => String(porcelain).split('\n').map((l) => l.trimEnd()).filter((l) => l !== '');

const run = (cmd, args, opts = {}) => {
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: SHELL, ...opts });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

function main() {
    if (process.env.CI) {
        console.error('publish-field-ui: refusing to run in CI. CI publishes through .github/workflows/publish-field-ui.yml.');
        process.exit(1);
    }
    const confirm = process.argv.includes('--confirm');
    const fail = (msg) => {
        console.error(`publish-field-ui: ${msg}`);
        process.exit(1);
    };
    console.log(confirm ? 'mode: PUBLISH (--confirm)' : 'mode: dry run (nothing will be published; pass --confirm to publish)');

    const dirty = dirtyLines(run('git', ['status', '--porcelain']).stdout);
    if (dirty.length > 0) {
        const list = `the git tree is not clean:\n${dirty.map((l) => `  ${l}`).join('\n')}`;
        if (confirm) fail(list);
        console.warn(`warn  ${list}\n      (a warning in a dry run; --confirm refuses)`);
    } else {
        console.log('ok  git tree is clean');
    }

    const source = JSON.parse(readFileSync(join(ROOT, 'packages', 'field-ui', 'package.json'), 'utf8'));
    if (!existsSync(join(STAGED, 'package.json'))) fail('the staged package is missing. Run: npm run build -w @inspectorhub/field-ui && npm run stage:field-ui');
    const staged = JSON.parse(readFileSync(join(STAGED, 'package.json'), 'utf8'));
    if (staged.name !== PACKAGE_NAME) fail(`the staged package is ${staged.name}, expected ${PACKAGE_NAME}.`);
    if (!versionsEqual(staged.version, source.version)) fail(`the staged version ${staged.version} differs from the source version ${source.version}. Re-run: npm run stage:field-ui`);
    console.log(`ok  staged ${staged.name}@${staged.version} matches the source`);

    let exists = false;
    try {
        exists = versionExists(run, staged.name, staged.version);
    } catch (err) {
        fail(err.message);
    }
    if (exists) fail(`${staged.name}@${staged.version} is already on ${OFFICIAL_REGISTRY}. Bump the version.`);
    console.log(`ok  ${staged.version} is not on ${OFFICIAL_REGISTRY} yet`);

    const scoped = parseRegistry(run('npm', ['config', 'get', '@inspectorhub:registry']).stdout);
    if (scoped !== null && !isOfficialRegistry(scoped)) {
        fail(`npm is configured to send the @inspectorhub scope to ${scoped}, which takes precedence over --registry. Remove that setting before publishing.`);
    }
    const effective = parseRegistry(run('npm', ['config', 'get', 'registry']).stdout);
    console.log(
        isOfficialRegistry(effective)
            ? `ok  default registry is ${OFFICIAL_REGISTRY}`
            : `ok  default registry is ${effective} (a mirror?); every command here passes --registry ${OFFICIAL_REGISTRY} explicitly`,
    );

    const who = run('npm', ['whoami', '--registry', OFFICIAL_REGISTRY]);
    if (who.status === 0) console.log(`ok  logged in as ${who.stdout.trim()}`);
    else if (confirm) fail('npm whoami failed: log in first (npm login --registry https://registry.npmjs.org).');
    else console.warn('warn  npm whoami failed (not logged in). A real publish needs: npm login --registry https://registry.npmjs.org');

    const requireExtra = Boolean(process.env.PACKAGE_SCAN_EXTRA_PATTERNS && process.env.PACKAGE_SCAN_EXTRA_PATTERNS.trim());
    console.log(`scan mode: ${requireExtra ? 'with run-time patterns (--require-extra)' : 'generic rules only (PACKAGE_SCAN_EXTRA_PATTERNS is not set)'}`);
    const scan = spawnSync(process.execPath, ['scripts/check-package-tarball.mjs', ...(requireExtra ? ['--require-extra'] : [])], { cwd: ROOT, stdio: 'inherit' });
    if (scan.status !== 0) fail('the scan found problems; nothing was published.');

    const publishArgs = ['publish', STAGED, '--access', 'public', '--registry', OFFICIAL_REGISTRY];
    if (!confirm) {
        console.log(`\nwould run: npm ${publishArgs.join(' ')}\ndry run complete; nothing was published.`);
        return;
    }
    console.log(`\nnpm ${publishArgs.join(' ')}`);
    const pub = spawnSync('npm', publishArgs, { cwd: ROOT, stdio: 'inherit', shell: SHELL });
    if (pub.status !== 0) fail(`npm publish failed (exit ${pub.status}).`);

    const view = run('npm', ['view', `${staged.name}@${staged.version}`, 'version', 'dist.integrity', '--registry', OFFICIAL_REGISTRY]);
    if (view.status !== 0) fail(`published, but \`npm view\` could not confirm it yet (the registry can lag a minute): ${view.stderr.trim().slice(0, 200)}`);
    console.log(`\npublished:\n${view.stdout.trim()}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
