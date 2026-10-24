import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no type declarations
import { checkCoherence, formatReport, parsePackJson } from '../../../scripts/release-check-field-ui.mjs';
// @ts-expect-error - plain .mjs script, no type declarations
import { dirtyLines, isOfficialRegistry, parseRegistry, versionExists, versionsEqual } from '../../../scripts/publish-field-ui.mjs';

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
    expect(calls.every((a) => a.includes('--registry') && a.includes('https://registry.npmjs.org'))).toBe(true);
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

describe('workflows', () => {
  const load = (f: string) => parse(readFileSync(join(ROOT, '.github', 'workflows', f), 'utf8'));
  const publish = load('publish-field-ui.yml');

  it('publish: concurrency group without cancellation, dry_run input, guards kept, id-token only on publish', () => {
    expect(publish.concurrency).toEqual({ group: 'publish-field-ui', 'cancel-in-progress': false });
    expect(publish.on.workflow_dispatch.inputs.dry_run).toMatchObject({ type: 'boolean', default: false });
    for (const job of ['build', 'publish']) {
      expect(publish.jobs[job].if).toContain("github.repository == 'InspectorHub/OpenInspection'");
      expect(publish.jobs[job].if).toContain("github.ref_type == 'tag'");
      expect(publish.jobs[job].if).toContain("startsWith(github.ref_name, 'field-ui-v')");
    }
    expect(publish.jobs.build.permissions['id-token']).toBeUndefined();
    expect(publish.jobs.publish.permissions['id-token']).toBe('write');
  });

  it('publish: the publish step is skipped for dry runs and for an already published version', () => {
    const steps = publish.jobs.publish.steps;
    const step = steps.find((s: { name?: string }) => s.name === 'Publish the scanned tarball');
    expect(step.if).toContain('inputs.dry_run');
    expect(step.if).toContain("steps.exists.outputs.published != 'true'");
    expect(steps.some((s: { id?: string }) => s.id === 'exists')).toBe(true);
    expect(step.run).toContain('npm publish "$1" --provenance --access public');
  });

  it('publish: the build job runs the release check with --require-extra', () => {
    const run = publish.jobs.build.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(run).toContain('release:check:field-ui -- --require-extra');
  });

  it('ci: the build job runs the release check WITHOUT --require-extra', () => {
    const ci = load('ci.yml');
    const run = ci.jobs.build.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(run).toContain('npm run release:check:field-ui');
    expect(run).not.toContain('--require-extra');
    expect(ci.jobs.verify.needs).toContain('build');
  });
});
