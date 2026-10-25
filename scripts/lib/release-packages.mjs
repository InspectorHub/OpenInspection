/**
 * The packages this repository publishes to npm, and the one place their release facts live.
 *
 * The staging, release-check, publish and tarball-scan scripts all serve every entry here; each
 * takes `--package <slug>` and defaults to `field-ui`, so a call that names no package behaves
 * exactly as it did when field-ui was the only one.
 *
 * - `dir`         the workspace directory, relative to the repository root
 * - `manifestKey` the key in .release-please-manifest.json
 * - `tagPrefix`   release-please tags are `<tagPrefix><version>`
 * - `workflow`    the publish workflow FILE NAME. It is bound to the npm trusted-publisher entry,
 *                 so renaming it breaks publishing until that entry is edited to match.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PACKAGES = {
    'field-ui': {
        slug: 'field-ui',
        name: '@inspectorhub/field-ui',
        dir: 'packages/field-ui',
        manifestKey: 'packages/field-ui',
        tagPrefix: 'field-ui-v',
        workflow: 'publish-field-ui.yml',
    },
    'offline-package': {
        slug: 'offline-package',
        name: '@inspectorhub/offline-package',
        dir: 'packages/offline-package',
        manifestKey: 'packages/offline-package',
        tagPrefix: 'offline-package-v',
        workflow: 'publish-offline-package.yml',
    },
};

export const DEFAULT_PACKAGE = 'field-ui';

/** The table entry for `slug`; throws on an unknown slug rather than falling back to the default. */
export function getPackage(slug = DEFAULT_PACKAGE) {
    const entry = Object.hasOwn(PACKAGES, slug) ? PACKAGES[slug] : undefined;
    if (!entry) throw new Error(`unknown package "${slug}". Known packages: ${Object.keys(PACKAGES).join(', ')}.`);
    return entry;
}

/** Pure. The `--package` value in `args` (both `--package x` and `--package=x`), or the default. */
export function packageSlugFromArgs(args) {
    const eq = args.find((a) => a.startsWith('--package='));
    if (eq) return getPackage(eq.slice('--package='.length)).slug;
    const i = args.indexOf('--package');
    if (i < 0) return DEFAULT_PACKAGE;
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error('--package needs a value (one of: ' + Object.keys(PACKAGES).join(', ') + ').');
    return getPackage(value).slug;
}

/** Absolute path of a package's workspace directory. */
export const packageDirFor = (slug = DEFAULT_PACKAGE) => join(ROOT, ...getPackage(slug).dir.split('/'));

/** Absolute path of a package's gitignored staging directory. */
export const stagedDirFor = (slug = DEFAULT_PACKAGE) => join(packageDirFor(slug), '.publish');
