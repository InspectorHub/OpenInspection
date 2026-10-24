import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs script, no type declarations
import { NOTICE_RELATIVE, stageFieldUi } from '../../../scripts/stage-field-ui-package.mjs';

const ROOT = resolve(__dirname, '..', '..', '..');
const PKG = join(ROOT, 'packages', 'field-ui');
/** latin1 maps every byte to one character, so string equality is byte equality. */
const read = (p: string): string => readFileSync(p, 'latin1');
const notice = () => read(join(PKG, NOTICE_RELATIVE as string));

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});

/** A throwaway copy of the package inputs with a fake dist, so staging never touches the real tree. */
function fakePackage(withDist = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'field-ui-stage-'));
  temps.push(dir);
  mkdirSync(join(dir, 'publish-license'), { recursive: true });
  cpSync(join(PKG, NOTICE_RELATIVE as string), join(dir, NOTICE_RELATIVE as string));
  writeFileSync(join(dir, 'LICENSE'), 'REPO COPY WITH ADDITIONAL PERMISSION\n');
  writeFileSync(join(dir, 'README.md'), '# readme\n');
  writeFileSync(join(dir, 'PUBLISHING.md'), 'maintainers only\n');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'x.ts'), 'export {};\n');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@x/y', version: '1.2.3', license: 'AGPL-3.0-only', main: './dist/index.js', devDependencies: { a: '1' }, scripts: { build: 'x' } }),
  );
  if (withDist) {
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist', 'index.js'), 'export const x = 1;\n');
  }
  return dir;
}

describe('field-ui licence design', () => {
  it('the repository copy of the package LICENSE equals the root LICENSE byte for byte', () => {
    expect(read(join(PKG, 'LICENSE'))).toBe(read(join(ROOT, 'LICENSE')));
  });

  it('the published notice is the plain AGPL notice, with no additional permission', () => {
    const text = notice();
    expect(text).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(text).not.toMatch(/ADDITIONAL PERMISSION/i);
    expect(text).not.toMatch(/Section 7/i);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\r');
  });

  it('the published README and the source package.json say nothing about a permission or self-hosting', () => {
    const readme = read(join(PKG, 'README.md'));
    expect(readme).not.toMatch(/additional permission|section 7|self-hosted/i);
    const manifest = JSON.parse(read(join(PKG, 'package.json')));
    expect(manifest.license).toBe('AGPL-3.0-only');
    expect(JSON.stringify(manifest)).not.toMatch(/additional permission|section 7|self-hosted/i);
  });

  it('staging produces dist, package.json, README.md and the notice as LICENSE, and nothing else', () => {
    const pkg = fakePackage();
    const outDir = join(pkg, '.publish');
    const before = read(join(pkg, 'LICENSE'));
    const { manifest, files } = stageFieldUi({ packageDir: pkg, outDir });
    expect(files).toEqual(['LICENSE', 'README.md', 'dist/index.js', 'package.json']);
    expect(read(join(outDir, 'LICENSE'))).toBe(notice());
    expect(read(join(pkg, 'LICENSE'))).toBe(before);
    const staged = JSON.parse(read(join(outDir, 'package.json')));
    expect(staged).toEqual(manifest);
    expect(staged.name).toBe('@x/y');
    expect(staged.version).toBe('1.2.3');
    expect(staged.devDependencies).toBeUndefined();
    expect(staged.scripts).toBeUndefined();
  });

  it('staging is rebuilt from scratch: a stray file in the output directory does not survive', () => {
    const pkg = fakePackage();
    const outDir = join(pkg, '.publish');
    stageFieldUi({ packageDir: pkg, outDir });
    writeFileSync(join(outDir, 'stray.txt'), 'x');
    const { files } = stageFieldUi({ packageDir: pkg, outDir });
    expect(files).not.toContain('stray.txt');
    expect(existsSync(join(outDir, 'stray.txt'))).toBe(false);
  });

  it('staging refuses when dist is missing', () => {
    const pkg = fakePackage(false);
    expect(() => stageFieldUi({ packageDir: pkg, outDir: join(pkg, '.publish') })).toThrow(/npm run build/);
    expect(existsSync(join(pkg, '.publish'))).toBe(false);
  });

  it('.gitignore ignores the staging directory', () => {
    const lines = read(join(ROOT, '.gitignore')).split('\n');
    expect(lines).toContain('/packages/field-ui/.publish/');
  });
});
