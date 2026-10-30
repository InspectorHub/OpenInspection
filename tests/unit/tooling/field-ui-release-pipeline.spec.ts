import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no type declarations
import { checkCoherence, formatReport, parsePackJson } from '../../../scripts/release-check-field-ui.mjs';
// @ts-expect-error - plain .mjs script, no type declarations
import { PACKAGE_NAME, STAGED, dirtyLines, isOfficialRegistry, parseRegistry, publishTarget, versionExists, versionsEqual } from '../../../scripts/publish-field-ui.mjs';

const OFFICIAL_REGISTRY = 'https://registry.npmjs.org';

const ROOT = resolve(__dirname, '..', '..', '..');
type Exec = (cmd: string, args: string[]) => { status: number; stdout: string; stderr: string };

describe('release-check coherence', () => {
  it('passes when manifest and package agree, with or without a matching tag', () => {
    expect(checkCoherence({ manifestVersion: '0.1.0', packageVersion: '0.1.0' })).toEqual([]);
    expect(checkCoherence({ manifestVersion: '0.1.0', packageVersion: '0.1.0', tag: 'field-ui-v0.1.0' })).toEqual([]);
  });

  it('names the mismatch between manifest and package.json', () => {
    const problems: string[] = checkCoherence({ manifestVersion: '0.2.0', packageVersion: '0.1.0' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/says 0\.2\.0 but .* says 0\.1\.0/);
  });

  it('names a tag that does not match the package version', () => {
    const problems: string[] = checkCoherence({ manifestVersion: '0.1.0', packageVersion: '0.1.0', tag: 'field-ui-v0.1.1' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/tag is field-ui-v0\.1\.1 .*expected field-ui-v0\.1\.0/);
  });

  it('reports a missing version or manifest entry instead of passing', () => {
    expect(checkCoherence({ packageVersion: '0.1.0' }).length).toBeGreaterThan(0);
    expect(checkCoherence({ manifestVersion: '0.1.0' }).length).toBeGreaterThan(0);
  });

  it('the repository itself is coherent right now', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', 'field-ui', 'package.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(ROOT, '.release-please-manifest.json'), 'utf8'));
    expect(checkCoherence({ manifestVersion: manifest['packages/field-ui'], packageVersion: pkg.version })).toEqual([]);
  });
});

describe('release-check coherence for offline-package', () => {
  const slug = 'offline-package';

  it('passes when manifest, package and tag agree on the offline-package prefix', () => {
    expect(checkCoherence({ slug, manifestVersion: '0.1.0', packageVersion: '0.1.0' })).toEqual([]);
    expect(checkCoherence({ slug, manifestVersion: '0.1.0', packageVersion: '0.1.0', tag: 'offline-package-v0.1.0' })).toEqual([]);
  });

  it('fails a field-ui tag and a version mismatch, naming the offline-package files', () => {
    const wrongTag: string[] = checkCoherence({ slug, manifestVersion: '0.1.0', packageVersion: '0.1.0', tag: 'field-ui-v0.1.0' });
    expect(wrongTag).toHaveLength(1);
    expect(wrongTag[0]).toMatch(/expected offline-package-v0\.1\.0/);
    const skew: string[] = checkCoherence({ slug, manifestVersion: '0.2.0', packageVersion: '0.1.0' });
    expect(skew).toHaveLength(1);
    expect(skew[0]).toContain('packages/offline-package/package.json');
    expect(skew[0]).toContain('.release-please-manifest.json');
  });

  it('the default slug is still field-ui (a field-ui tag passes without naming a slug)', () => {
    expect(checkCoherence({ manifestVersion: '0.1.0', packageVersion: '0.1.0', tag: 'field-ui-v0.1.0' })).toEqual([]);
    expect(checkCoherence({ manifestVersion: '0.1.0', packageVersion: '0.1.0', tag: 'offline-package-v0.1.0' })).toHaveLength(1);
  });

  it('the repository itself is coherent right now', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', 'offline-package', 'package.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(ROOT, '.release-please-manifest.json'), 'utf8'));
    expect(checkCoherence({ slug, manifestVersion: manifest['packages/offline-package'], packageVersion: pkg.version })).toEqual([]);
  });
});

describe('release-check report', () => {
  const sample = JSON.stringify([
    {
      name: '@x/y',
      version: '1.0.0',
      filename: 'x-y-1.0.0.tgz',
      size: 100,
      unpackedSize: 300,
      integrity: 'sha512-abc',
      shasum: 'def',
      files: [
        { path: 'package.json', size: 10 },
        { path: 'LICENSE', size: 20 },
      ],
    },
  ]);

  it('parses npm pack output, sorts the files, and keeps the sha512', () => {
    const pack = parsePackJson(sample);
    expect(pack.files.map((f: { path: string }) => f.path)).toEqual(['LICENSE', 'package.json']);
    expect(pack.integrity).toBe('sha512-abc');
    expect(formatReport(pack)).toContain('sha512 sha512-abc');
    expect(formatReport(pack, { markdown: true })).toContain('| `LICENSE` | 20 |');
  });

  it('rejects output with no files or no sha512, instead of reporting an empty pass', () => {
    expect(() => parsePackJson('[]')).toThrow(/no files/);
    expect(() => parsePackJson(JSON.stringify([{ name: 'a', version: '1', files: [] }]))).toThrow(/no files/);
    expect(() => parsePackJson(JSON.stringify([{ name: 'a', version: '1', files: [{ path: 'a', size: 1 }] }]))).toThrow(/sha512/);
    expect(() => parsePackJson(JSON.stringify([{ name: 'a', version: '1', integrity: 'sha1-x', files: [{ path: 'a', size: 1 }] }]))).toThrow(/sha512/);
  });
});

describe('publish helper checks', () => {
  it('reads a registry setting, treating unset values as null', () => {
    expect(parseRegistry('https://registry.npmjs.org/\n')).toBe('https://registry.npmjs.org');
    expect(parseRegistry('undefined\n')).toBeNull();
    expect(parseRegistry('null')).toBeNull();
    expect(parseRegistry('')).toBeNull();
    expect(isOfficialRegistry('https://registry.npmjs.org/')).toBe(true);
    expect(isOfficialRegistry('https://registry.npmmirror.com/')).toBe(false);
    expect(isOfficialRegistry(null)).toBe(false);
  });

  it('compares versions strictly', () => {
    expect(versionsEqual('0.1.0', '0.1.0')).toBe(true);
    expect(versionsEqual('0.1.0', '0.1.1')).toBe(false);
    expect(versionsEqual('', '')).toBe(false);
    expect(versionsEqual(undefined, undefined)).toBe(false);
  });

  it('lists dirty lines and ignores blank ones', () => {
    expect(dirtyLines('')).toEqual([]);
    expect(dirtyLines('\n')).toEqual([]);
    expect(dirtyLines(' M a\n?? b\n')).toEqual([' M a', '?? b']);
  });

  it('versionExists: true when the registry returns the version, false on E404, throws on anything else', () => {
    const calls: string[][] = [];
    const exec =
      (r: { status: number; stdout?: string; stderr?: string }): Exec =>
      (_cmd, args) => {
        calls.push(args);
        return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
      };
    expect(versionExists(exec({ status: 0, stdout: '0.1.0\n' }), '@x/y', '0.1.0')).toBe(true);
    expect(versionExists(exec({ status: 1, stderr: 'npm error code E404\nnpm error 404 Not Found' }), '@x/y', '0.1.0')).toBe(false);
    expect(() => versionExists(exec({ status: 1, stderr: 'npm error code ENOTFOUND' }), '@x/y', '0.1.0')).toThrow(/could not read/);
    expect(() => versionExists(exec({ status: 1, stderr: '' }), '@x/y', '0.1.0')).toThrow(/exit 1/);
    // Every lookup names the registry explicitly.
    // The value that follows --registry is exactly the official registry (an exact comparison, not a substring match).
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((a) => a[a.indexOf('--registry') + 1] === OFFICIAL_REGISTRY)).toBe(true);
  });

  it('versionExists does not treat a different version string as published', () => {
    const exec: Exec = () => ({ status: 0, stdout: '0.0.9\n', stderr: '' });
    expect(versionExists(exec, '@x/y', '0.1.0')).toBe(false);
  });

  it('the helper refuses to run in CI and publishes only with --confirm', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'publish-field-ui.mjs'), 'utf8');
    expect(src).toMatch(/if \(process\.env\.CI\)/);
    expect(src).toContain("process.argv.includes('--confirm')");
    expect(src).toMatch(/if \(!confirm\) \{[\s\S]*return;/);
  });
});

describe('publish helper target', () => {
  it('defaults to field-ui and keeps the exports the older callers read', () => {
    expect(PACKAGE_NAME).toBe('@inspectorhub/field-ui');
    expect(STAGED).toBe(join(ROOT, 'packages', 'field-ui', '.publish'));
    expect(publishTarget()).toMatchObject({ name: '@inspectorhub/field-ui', staged: STAGED });
  });

  it('points at the offline-package directory for --package offline-package', () => {
    const t = publishTarget('offline-package');
    expect(t.name).toBe('@inspectorhub/offline-package');
    expect(t.staged).toBe(join(ROOT, 'packages', 'offline-package', '.publish'));
    expect(t.sourceManifest).toBe(join(ROOT, 'packages', 'offline-package', 'package.json'));
    expect(t.stageCommand).toContain('stage:offline-package');
  });
});

const loadWorkflow = (f: string) => parse(readFileSync(join(ROOT, '.github', 'workflows', f), 'utf8'));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every hardening point of the field-ui workflow must hold for each published package.
describe.each([
  { slug: 'field-ui', file: 'publish-field-ui.yml', prefix: 'field-ui-v', name: '@inspectorhub/field-ui' },
  { slug: 'offline-package', file: 'publish-offline-package.yml', prefix: 'offline-package-v', name: '@inspectorhub/offline-package' },
])('publish workflow: $slug', ({ slug, file, prefix, name }) => {
  const publish = loadWorkflow(file);

  it('publish: concurrency group without cancellation, dry_run input, guards kept, id-token only on publish', () => {
    expect(publish.concurrency).toEqual({ group: `publish-${slug}`, 'cancel-in-progress': false });
    expect(publish.on.workflow_dispatch.inputs.dry_run).toMatchObject({ type: 'boolean', default: false });
    for (const job of ['build', 'publish']) {
      expect(publish.jobs[job].if).toContain("github.repository == 'InspectorHub/OpenInspection'");
      expect(publish.jobs[job].if).toContain("github.ref_type == 'tag'");
      expect(publish.jobs[job].if).toContain(`startsWith(github.ref_name, '${prefix}')`);
    }
    expect(publish.jobs.build.permissions['id-token']).toBeUndefined();
    expect(publish.jobs.publish.permissions['id-token']).toBe('write');
  });

  it('publish: exactly two jobs; the publish job checks nothing out and runs no npm ci, the build job does both', () => {
    expect(Object.keys(publish.jobs).sort()).toEqual(['build', 'publish']);
    const uses = (job: string) => publish.jobs[job].steps.map((s: { uses?: string }) => s.uses ?? '');
    const runs = (job: string) => publish.jobs[job].steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(uses('build').some((u: string) => u.startsWith('actions/checkout'))).toBe(true);
    expect(runs('build')).toContain('npm ci');
    expect(uses('publish').some((u: string) => u.startsWith('actions/checkout'))).toBe(false);
    expect(runs('publish')).not.toContain('npm ci');
    expect(publish.jobs.publish.needs).toBe('build');
  });

  it('publish: the tag must equal the package version, and the tarball must be this package', () => {
    const build = publish.jobs.build.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(build).toContain(`expected="${prefix}$(node -p "require('./packages/${slug}/package.json').version")"`);
    const run: string = publish.jobs.publish.steps.find((x: { run?: string }) => x.run?.includes('does not name')).run;
    expect(run).toContain(`"${name}"`);
  });

  it('publish: the tarball-versus-tag check reads the version after the LAST @ of a scoped name', () => {
    const step = publish.jobs.publish.steps.find((x: { run?: string }) => x.run?.includes('does not name'));
    expect(step, 'the tag check step must exist').toBeDefined();
    const run: string = step.run;
    // The scoped name starts with an @: stripping up to the FIRST @ leaves "inspectorhub/<slug>@0.2.0", so the
    // check refused every real release (it did, on the first CI publish).
    expect(run).toContain('${packed##*@}');
    expect(run).not.toContain('${packed#*@}');
    // Run the real condition in bash when bash is available (CI always has it).
    const probe = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
    if (probe.status !== 0 || probe.stdout.trim() !== 'ok') return;
    const cond = new RegExp(`^\\s*if (\\[ "${escapeRe(prefix)}.*\\]); then$`, 'm').exec(run)?.[1];
    expect(cond, 'the condition line must be found').toBeDefined();
    const verdict = (packed: string, ref: string) =>
      spawnSync('bash', ['-c', `packed='${packed}'; GITHUB_REF_NAME='${ref}'; if ${cond}; then echo MISMATCH; else echo MATCH; fi`], { encoding: 'utf8' }).stdout.trim();
    expect(verdict(`${name}@0.2.0`, `${prefix}0.2.0`)).toBe('MATCH');
    expect(verdict(`${name}@0.2.0`, `${prefix}0.2.1`)).toBe('MISMATCH');
    expect(verdict(`@other/${slug}@0.2.0`, `${prefix}0.2.0`)).toBe('MISMATCH');
  });

  it('publish: the post-publish visibility check waits up to 5 minutes and warns instead of failing the job', () => {
    const steps = publish.jobs.publish.steps;
    const step = steps.find((x: { name?: string }) => x.name === 'Check the registry shows the version');
    expect(step, 'the visibility check step must exist').toBeDefined();
    const run: string = step.run;
    // 30 attempts x 10 seconds = 5 minutes.
    expect(run).toContain('seq 1 30');
    expect(run).toContain('sleep 10');
    // The publish already succeeded: a version that is slow to appear is a warning, never a failed run.
    expect(run).toContain('::warning::');
    expect(run).not.toMatch(/exit 1/);
    expect(step.if).toContain('!inputs.dry_run');
    // It must come after the publish step itself.
    const names = steps.map((x: { name?: string }) => x.name);
    expect(names.indexOf('Check the registry shows the version')).toBeGreaterThan(names.indexOf('Publish the scanned tarball'));
  });

  it('publish: the publish step is skipped for dry runs and for an already published version', () => {
    const steps = publish.jobs.publish.steps;
    const step = steps.find((s: { name?: string }) => s.name === 'Publish the scanned tarball');
    expect(step.if).toContain('inputs.dry_run');
    expect(step.if).toContain("steps.exists.outputs.published != 'true'");
    expect(steps.some((s: { id?: string }) => s.id === 'exists')).toBe(true);
    expect(step.run).toContain('npm publish "$1" --provenance --access public');
  });

  it('publish: the build job runs the release check with --require-extra, for its own package', () => {
    const run = publish.jobs.build.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(run).toContain(`release:check:${slug} -- --require-extra`);
    // Not the other package's check.
    const other = slug === 'field-ui' ? 'offline-package' : 'field-ui';
    expect(run).not.toContain(`release:check:${other}`);
  });

  it('release-please dispatches this exact workflow file for this package', () => {
    const rp = loadWorkflow('release-please.yml');
    const step = rp.jobs['release-please'].steps.find((s: { name?: string }) => s.name === `Publish ${name}`);
    expect(step, 'the dispatch step must exist').toBeDefined();
    expect(step.if).toContain(`steps.release.outputs['packages/${slug}--release_created'] == 'true'`);
    expect(step.env.TAG).toContain(`packages/${slug}--tag_name`);
    expect(step.run).toContain(`gh workflow run ${file} `);
  });
});

describe('workflows: ci', () => {
  it('the build job runs both release checks WITHOUT --require-extra', () => {
    const ci = loadWorkflow('ci.yml');
    const run = ci.jobs.build.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(run).toContain('npm run release:check:field-ui');
    expect(run).toContain('npm run release:check:offline-package');
    expect(run).not.toContain('--require-extra');
    expect(ci.jobs.verify.needs).toContain('build');
  });
});

describe('release-please configuration', () => {
  const config = JSON.parse(readFileSync(join(ROOT, 'release-please-config.json'), 'utf8'));

  it('the root package excludes both published packages, and each has its own component and tag prefix', () => {
    expect(config.packages['.']['exclude-paths']).toEqual(['packages/field-ui', 'packages/offline-package']);
    for (const slug of ['field-ui', 'offline-package']) {
      expect(config.packages[`packages/${slug}`]).toMatchObject({ component: slug, 'include-component-in-tag': true, 'bump-minor-pre-major': true });
    }
  });
});
