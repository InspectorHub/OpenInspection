import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no type declarations
import { DEFAULT_PACKAGE, PACKAGES, getPackage, packageSlugFromArgs } from '../../../scripts/lib/release-packages.mjs';

const ROOT = resolve(__dirname, '..', '..', '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

describe('release package table', () => {
  it('lists exactly the two published packages, field-ui first and as the default', () => {
    expect(Object.keys(PACKAGES)).toEqual(['field-ui', 'offline-package']);
    expect(DEFAULT_PACKAGE).toBe('field-ui');
  });

  it('keeps the field-ui values the existing scripts relied on', () => {
    const p = getPackage();
    expect(p).toMatchObject({
      slug: 'field-ui',
      name: '@inspectorhub/field-ui',
      dir: 'packages/field-ui',
      manifestKey: 'packages/field-ui',
      tagPrefix: 'field-ui-v',
      workflow: 'publish-field-ui.yml',
    });
  });

  it('describes offline-package with its own tag prefix, workflow file and directory', () => {
    expect(getPackage('offline-package')).toMatchObject({
      slug: 'offline-package',
      name: '@inspectorhub/offline-package',
      dir: 'packages/offline-package',
      manifestKey: 'packages/offline-package',
      tagPrefix: 'offline-package-v',
      workflow: 'publish-offline-package.yml',
    });
  });

  it('rejects an unknown slug instead of falling back to a default', () => {
    expect(() => getPackage('nope')).toThrow(/unknown package "nope".*field-ui, offline-package/);
  });

  it('reads --package from argv in both spellings and defaults to field-ui', () => {
    expect(packageSlugFromArgs([])).toBe('field-ui');
    expect(packageSlugFromArgs(['--confirm'])).toBe('field-ui');
    expect(packageSlugFromArgs(['--package', 'offline-package'])).toBe('offline-package');
    expect(packageSlugFromArgs(['--package=offline-package', '--confirm'])).toBe('offline-package');
    expect(() => packageSlugFromArgs(['--package'])).toThrow(/needs a value/);
    expect(() => packageSlugFromArgs(['--package=bogus'])).toThrow(/unknown package/);
  });

  it('every table entry matches the repository: package.json name, workflow file, manifest key', () => {
    const manifest = readJson('.release-please-manifest.json');
    let checked = 0;
    for (const p of Object.values(PACKAGES) as Array<{ name: string; dir: string; manifestKey: string; workflow: string; slug: string }>) {
      // field-ui is already published; offline-package is renamed by the packaging task. Both must agree with the table.
      expect(readJson(`${p.dir}/package.json`).name, p.slug).toBe(p.name);
      expect(manifest[p.manifestKey], p.slug).toBeTypeOf('string');
      expect(readFileSync(join(ROOT, '.github', 'workflows', p.workflow), 'utf8'), p.slug).toContain(`name: ${p.workflow.replace(/\.yml$/, '')}`);
      checked += 1;
    }
    expect(checked).toBe(2);
  });
});
