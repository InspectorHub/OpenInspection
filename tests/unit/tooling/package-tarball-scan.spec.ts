import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain .mjs gate script, no type declarations
import { readTarball, resolveExtraPatterns, scanFiles } from '../../../scripts/check-package-tarball.mjs';

type Finding = { path: string; id: string };
const scan = (files: Record<string, string>, extra: string[] = []): Finding[] => scanFiles(files, extra);
const ids = (files: Record<string, string>, extra?: string[]) => scan(files, extra).map((f) => f.id);

/** Build a gzip'd ustar archive the way `npm pack` lays one out (everything under `package/`). */
function tarball(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.from(body, 'utf8');
    const header = Buffer.alloc(512);
    header.write(`package/${name}`, 0, 'utf8');
    header.write(data.length.toString(8).padStart(11, '0'), 124, 'ascii');
    header.write('0', 156, 'ascii');
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

describe('check-package-tarball', () => {
  const plainLicense = 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n';
  const clean = { 'dist/index.js': 'export const x = 1;\n', 'README.md': '# pkg\n', LICENSE: plainLicense, 'package.json': '{}' };

  it('passes a clean package and counts the files it scanned', () => {
    expect(scan(clean)).toEqual([]);
  });

  it('reads back exactly what a packed archive holds, with the package/ prefix removed', () => {
    expect(readTarball(tarball(clean))).toEqual(clean);
  });

  it('flags each leak class against a clean control', () => {
    const cjk = String.fromCodePoint(0x4e2d, 0x6587);
    expect(ids({ ...clean, 'dist/a.js': `// ${cjk}` })).toEqual(['cjk']);
    expect(ids({ ...clean, 'dist/a.js': 'import x from "@core/field-ui/x";' })).toEqual(['alias-leak']);
    expect(ids({ ...clean, 'dist/a.js': '//# sourceMappingURL=a.js.map' })).toEqual(['source-map']);
    expect(ids({ ...clean, 'dist/a.js.map': '{}' })).toContain('source-map');
    expect(ids({ ...clean, 'dist/a.js': 'const k = "sk_live_abcdefghijklmnop";' })).toEqual(['secret-shape']);
    expect(ids({ ...clean, 'dist/a.js': '// built in C:\\Users\\someone' })).toEqual(['local-path']);
    expect(ids({ ...clean, 'dist/a.js': 'const p = "C:\\\\Users\\\\someone";' })).toEqual(['local-path']);
    expect(ids({ ...clean, 'dist/a.js': '// see /home/someone/proj/x' })).toEqual(['local-path']);
  });

  it('flags Kana and Hangul as well as ideographs, each against a clean control', () => {
    const samples: Record<string, string> = {
      hiragana: String.fromCodePoint(0x3042),
      katakana: String.fromCodePoint(0x30a2),
      'hangul syllable': String.fromCodePoint(0xd55c),
      'hangul jamo': String.fromCodePoint(0x1112),
    };
    for (const [name, ch] of Object.entries(samples)) {
      expect(ids({ ...clean, 'dist/a.js': `// ${ch}` }), name).toEqual(['cjk']);
    }
    // Neighbours just outside the ranges stay clean (accented Latin, Greek, Cyrillic, and code points either side of the Hangul ranges).
    const outside = String.fromCodePoint(0x3b1, 0x44f, 0xe9, 0x10ff, 0x1200, 0xd7b0);
    expect(ids({ ...clean, 'dist/a.js': `// ${outside}` })).toEqual([]);
  });

  it('requires the LICENSE to be the AGPL notice, and flags an extra permission in it', () => {
    expect(ids({ ...clean, LICENSE: 'MIT License' })).toEqual(['license-missing-agpl']);
    expect(ids({ ...clean, LICENSE: `${plainLicense}\nADDITIONAL PERMISSION FOR X` })).toEqual(['license-extra-permission']);
    expect(ids({ ...clean, LICENSE: `${plainLicense}\nunder section 7 of the licence` })).toEqual(['license-extra-permission']);
  });

  it('flags a permission or self-hosting mention in the README and package.json', () => {
    for (const word of ['additional permission', 'Section 7', 'self-hosted']) {
      expect(ids({ ...clean, 'README.md': `# pkg\n${word}\n` }), `README ${word}`).toEqual(['license-extra-permission-mention']);
      expect(ids({ ...clean, 'package.json': `{"x":"${word}"}` }), `package.json ${word}`).toEqual(['license-extra-permission-mention']);
    }
    // The same words elsewhere in the tarball are not this rule's business.
    expect(ids({ ...clean, 'dist/a.js': '// self-hosted' })).toEqual([]);
  });

  it('rejects files outside the allowed set', () => {
    expect(ids({ ...clean, 'src/index.ts': 'x', '.env': 'A=1' })).toEqual(['unexpected-file', 'unexpected-file']);
  });

  it('applies run-time patterns, and only when given', () => {
    const files = { ...clean, 'dist/a.js': '// mentions Widgetron' };
    expect(ids(files)).toEqual([]);
    expect(ids(files, ['widgetron'])).toEqual(['extra-pattern']);
  });
});

describe('resolveExtraPatterns', () => {
  it('without the requirement an unset or empty variable means no extra patterns', () => {
    expect(resolveExtraPatterns(undefined)).toEqual([]);
    expect(resolveExtraPatterns('')).toEqual([]);
  });

  it('with the requirement an unset or empty variable is a failure, not a quiet skip', () => {
    expect(() => resolveExtraPatterns(undefined, true)).toThrow(/not set/);
    expect(() => resolveExtraPatterns('', true)).toThrow(/not set/);
    expect(() => resolveExtraPatterns('   ', true)).toThrow(/not set/);
  });

  it('an explicit empty list is the accepted opt-out, with or without the requirement', () => {
    expect(resolveExtraPatterns('[]', true)).toEqual([]);
    expect(resolveExtraPatterns('[]')).toEqual([]);
  });

  it('returns the patterns when given, and rejects anything that is not a JSON array of strings', () => {
    expect(resolveExtraPatterns('["a","b"]', true)).toEqual(['a', 'b']);
    expect(() => resolveExtraPatterns('not json')).toThrow(/valid JSON/);
    expect(() => resolveExtraPatterns('{"a":1}')).toThrow(/array of strings/);
    expect(() => resolveExtraPatterns('[1]')).toThrow(/array of strings/);
  });
});
