import { describe, expect, it } from 'vitest';
import { entryNameProblem } from '../../../server/lib/data-package/entry-name';
import { keyProblem, mapKeyToEntryName } from '../../../server/lib/data-package/media-key';
import { prng } from './helpers';

const BS = String.fromCharCode(92);
const E_ACUTE = String.fromCharCode(0xe9);
const HAN = String.fromCharCode(0x4e2d);

/** Random but valid object keys: mixed case, digits, separators, characters outside the entry allowlist, non-ASCII. */
function randomKey(rand: () => number): string {
  const pool = ['a', 'b', 'z', 'A', 'B', 'Z', '0', '9', '-', '_', '.', ' ', '%', '#', ':', '&', '+', '=', E_ACUTE, HAN, '(', ')', '~'];
  const segments = 1 + Math.floor(rand() * 4);
  const parts: string[] = [];
  for (let s = 0; s < segments; s++) {
    let part = '';
    for (let c = 0, n = 1 + Math.floor(rand() * 8); c < n; c++) part += pool[Math.floor(rand() * pool.length)];
    parts.push(part);
  }
  return parts.join('/');
}

describe('keyProblem', () => {
  it('accepts ordinary keys, including non-ASCII ones (the mapping handles those)', () => {
    for (const key of ['t/inspections/i/photos/p.jpg', 'a', `dir/${E_ACUTE}${HAN}.jpg`, 'A B/c d.JPG']) expect(keyProblem(key), key).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['absolute', '/a'],
    ['trailing slash', 'a/'],
    ['double slash', 'a//b'],
    ['dot segment', 'a/./b'],
    ['parent segment', 'a/../b'],
    ['only parent', '..'],
    ['backslash', `a${BS}b`],
    ['NUL', `a${String.fromCharCode(0)}b`],
    ['tab', `a${String.fromCharCode(9)}b`],
    ['DEL', `a${String.fromCharCode(127)}b`],
    ['newline', `a${String.fromCharCode(10)}b`],
    ['over 1024 bytes', 'a'.repeat(1025)],
    ['under 1024 characters but over 1024 bytes', HAN.repeat(342)],
  ])('refuses %s', (_label, key) => {
    expect(keyProblem(key)).not.toBeNull();
    expect(() => mapKeyToEntryName(key)).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
  });

  it('refuses an unpaired surrogate and accepts a valid pair', () => {
    expect(keyProblem(`a${String.fromCharCode(0xd800)}b`)).toBe('unpaired surrogate');
    expect(keyProblem(`a${String.fromCharCode(0xdc00)}`)).toBe('unpaired surrogate');
    expect(keyProblem(`a${String.fromCodePoint(0x1f600)}b`)).toBeNull();
    expect(() => mapKeyToEntryName(`a${String.fromCharCode(0xd800)}`)).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
  });

  it('accepts exactly 1024 bytes', () => {
    expect(keyProblem('a'.repeat(1024))).toBeNull();
    expect(keyProblem(`${HAN.repeat(341)}a`)).toBeNull(); // 1023 + 1 bytes
  });
});

describe('mapKeyToEntryName', () => {
  it('passes lower-case keys that are already valid entry names through unchanged', () => {
    for (const key of ['t/inspections/i/photos/p.jpg', 'a', 'a b/c d.jpg', 'x/y/z-1_2.png']) {
      expect(mapKeyToEntryName(key), key).toEqual({ entry: `media/${key}`, renamed: false });
    }
  });

  it.each([
    ['upper case', 'T/Inspections/IMG_0001.JPG'],
    ['non-ASCII', `t/${E_ACUTE}t${E_ACUTE}.jpg`],
    ['percent', 't/100%.jpg'],
    ['hash', 't/a#b.jpg'],
    ['colon', 't/a:b.jpg'],
    ['trailing dot', 't/a.'],
    ['trailing space', 't/a '],
    ['device name', 't/con'],
    ['device name with extension', 't/nul.txt'],
    ['reserved prefix', '_mapped/abc/x.jpg'],
    ['a key that is exactly the reserved directory name', '_mapped'],
    ['a key directly inside the reserved directory', '_mapped/x'],
    ['a key below the index file name', 'index.ndjson/x'],
    ['the index name itself', 'index.ndjson'],
    ['too long for an entry name', `${'a'.repeat(250)}/${'b'.repeat(250)}/c.jpg`],
    ['segment too long', `t/${'a'.repeat(300)}.jpg`],
    ['too many segments', Array.from({ length: 14 }, () => 'a').join('/')],
  ])('renames %s to a valid, reserved-namespace entry', (_label, key) => {
    const { entry, renamed } = mapKeyToEntryName(key);
    expect(renamed).toBe(true);
    expect(entry.startsWith('media/_mapped/')).toBe(true);
    expect(entryNameProblem(entry), entry).toBeNull();
    expect(entry).not.toBe('media/index.ndjson');
  });

  it('is deterministic, and different keys get different names (including keys that differ only by case)', () => {
    expect(mapKeyToEntryName('T/A.JPG')).toEqual(mapKeyToEntryName('T/A.JPG'));
    const names = ['T/A.JPG', 't/a.jpg', 'T/a.jpg', 't/A.JPG'].map((k) => mapKeyToEntryName(k).entry);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(4);
  });

  it('keeps the readable leaf and sanitizes it (spaces and odd characters become underscores)', () => {
    expect(mapKeyToEntryName('T/My Photo #1.JPG').entry).toMatch(/^media\/_mapped\/[0-9a-f]{32}\/My_Photo__1\.JPG$/);
  });

  it('forceRename renames a key that would pass through, resolving a file/directory clash', () => {
    const plain = mapKeyToEntryName('x/y');
    const forced = mapKeyToEntryName('x/y', { forceRename: true });
    expect(plain.renamed).toBe(false);
    expect(forced.renamed).toBe(true);
    expect(forced.entry).not.toBe(plain.entry);
    expect(mapKeyToEntryName('x/y', { forceRename: true })).toEqual(forced);
    // After forcing one of an `x` / `x/y` pair, neither entry is a directory prefix of the other.
    const a = mapKeyToEntryName('x').entry;
    expect(forced.entry.startsWith(`${a}/`)).toBe(false);
  });

  it('every output of 3,000 generated keys is a valid entry, unique once case is folded, and pass-through names are never renamed names (generated)', () => {
    const rand = prng(2026);
    const keys = new Set<string>();
    while (keys.size < 3_000) {
      const key = randomKey(rand);
      if (keyProblem(key) === null) keys.add(key);
    }
    // Adversarial additions: case twins, reserved-prefix look-alikes and the index name.
    for (const extra of ['a/B.jpg', 'a/b.jpg', 'a/B.JPG', '_mapped/00000000000000000000000000000000/b.jpg', 'index.ndjson', 'Index.ndjson', '_mapped', '_mapped/x', 'index.ndjson/x', 'Index.ndjson/y']) keys.add(extra);
    const entries = new Map<string, string>();
    for (const key of keys) {
      const { entry, renamed } = mapKeyToEntryName(key);
      expect(entryNameProblem(entry), `${key} -> ${entry}`).toBeNull();
      expect(entry.startsWith('media/')).toBe(true);
      expect(entry).not.toBe('media/index.ndjson');
      expect(entry.toLowerCase().startsWith('media/index.ndjson/'), key).toBe(false);
      expect(entry, key).not.toBe('media/_mapped'); // a file where the renamed directory must be
      if (!renamed) expect(entry.startsWith('media/_mapped/'), key).toBe(false);
      const folded = entry.toLowerCase();
      expect(entries.has(folded), `${key} collides with ${entries.get(folded)}`).toBe(false);
      entries.set(folded, key);
    }
    expect(entries.size).toBe(keys.size);
  });
});

describe('leaf fallbacks of a renamed name', () => {
  it('a last segment that sanitizes to nothing becomes "object"; a device-named leaf gets an underscore', () => {
    expect(mapKeyToEntryName('t/...').entry).toMatch(/^media\/_mapped\/[0-9a-f]{32}\/object$/);
    expect(mapKeyToEntryName('t/CON').entry).toMatch(/\/_CON$/);
    expect(mapKeyToEntryName('t/nul.txt').entry).toMatch(/\/_nul\.txt$/);
    for (const key of ['t/...', 't/CON', 't/nul.txt', 't/a.', 't/#']) expect(entryNameProblem(mapKeyToEntryName(key).entry), key).toBeNull();
  });
});

describe('first-segment reservations and leaf cutting', () => {
  it('only the FIRST segment is reserved: later segments named like the reserved names pass through', () => {
    for (const key of ['_mapped2/x', 'index.ndjson2', 'x/_mapped', 'x/index.ndjson', '_mappedx']) {
      expect(mapKeyToEntryName(key), key).toEqual({ entry: `media/${key}`, renamed: false });
    }
    for (const key of ['_mapped', '_mapped/x', 'index.ndjson', 'index.ndjson/x']) expect(mapKeyToEntryName(key).renamed, key).toBe(true);
  });

  it('cuts the leaf to 100 characters first and strips trailing dots after, so the cut cannot leave one', () => {
    const entry = mapKeyToEntryName(`T/${'a'.repeat(99)}.bbb`).entry;
    expect(entry).toMatch(new RegExp(`/${'a'.repeat(99)}$`));
    expect(entryNameProblem(entry)).toBeNull();
    const dots = mapKeyToEntryName(`T/${'a'.repeat(97)}...bbb`).entry;
    expect(dots).toMatch(new RegExp(`/${'a'.repeat(97)}$`));
  });
});
