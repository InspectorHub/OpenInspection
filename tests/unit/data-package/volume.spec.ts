import { describe, expect, it } from 'vitest';
import {
  assertEntryName, assertNoDuplicateEntryNames, assertNoPrefixCollisions, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, classifyPackageEntry, entryNameProblem, mediaVolumeName,
  parseVolumeName, VolumePlanner, zipEntryOverhead,
} from '../../../server/lib/data-package/volume';
import { prng } from './helpers';

describe('entry names', () => {
  it('accepts the names a package really carries', () => {
    for (const name of [
      'data/inspections.ndjson', 'media/index.json', 'README.txt', 'esign/events.ndjson',
      'media/3f2c0a8e-1111-4222-8333-444455556666/inspections/9b1c/photos/IMG_0001 (2).jpg',
    ]) expect(entryNameProblem(name), name).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['absolute path', '/etc/passwd'],
    ['parent segment', 'data/../../etc/passwd'],
    ['leading parent', '../x'],
    ['dot segment', 'data/./x'],
    ['backslash', 'data\\x.ndjson'],
    ['drive letter', 'C:/x'],
    ['drive letter without slash', 'C:x'],
    ['NUL byte', 'data/x\u0000.ndjson'],
    ['newline', 'data/x\n.ndjson'],
    ['double slash', 'data//x'],
    ['trailing slash', 'data/'],
    ['non-ASCII', 'media/caf\u00e9.jpg'],
    ['right-to-left override', 'media/\u202egpj.exe'],
    ['percent escape', 'media/%2e%2e/x'],
    ['hash', 'media/a#b'],
    ['star', 'media/a*b'],
    ['trailing space segment', 'media/a /b'],
    ['leading space segment', 'media/ a/b'],
    ['trailing dot segment', 'media/a./b'],
    ['Windows device', 'media/NUL.txt'],
    ['Windows device lower case', 'media/com1'],
    ['Windows device with spaces before the dot', 'media/con .txt'],
    ['Windows device, mixed case, two spaces', 'media/CoN  .x'],
    ['Windows device with spaces and no extension is a trailing-space name', 'media/lpt1 '],
    ['segment too long', `media/${'a'.repeat(256)}`],
    ['name too long', Array.from({ length: 11 }, () => 'a'.repeat(60)).join('/')],
    ['too many segments', Array.from({ length: 13 }, () => 'a').join('/')],
  ])('rejects %s', (_label, name) => {
    expect(entryNameProblem(name)).not.toBeNull();
    expect(() => assertEntryName(name)).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
  });

  it('never accepts a name containing a forbidden character, whatever else surrounds it (generated)', () => {
    const rand = prng(7);
    const bad = ['\\', ':', '\u0000', '\n', '\r', '*', '?', '"', '<', '>', '|', '%', '#', '\u00e9', '\u202e'];
    const good = 'abcXYZ019._-';
    for (let i = 0; i < 500; i++) {
      let name = '';
      const parts = 1 + Math.floor(rand() * 4);
      for (let p = 0; p < parts; p++) {
        let seg = '';
        for (let c = 0; c < 1 + Math.floor(rand() * 8); c++) seg += good[Math.floor(rand() * good.length)];
        name += (p ? '/' : '') + seg;
      }
      const at = Math.floor(rand() * (name.length + 1));
      const poisoned = name.slice(0, at) + bad[Math.floor(rand() * bad.length)] + name.slice(at);
      expect(entryNameProblem(poisoned), JSON.stringify(poisoned)).not.toBeNull();
    }
  });

  it('refuses names that collide once case is folded', () => {
    expect(() => assertNoDuplicateEntryNames(['data/a.ndjson', 'DATA/A.ndjson'])).toThrowError(
      expect.objectContaining({ code: 'entry_name_duplicate' }),
    );
    expect(() => assertNoDuplicateEntryNames(['data/a.ndjson', 'data/b.ndjson'])).not.toThrow();
  });
});

describe('classifyPackageEntry', () => {
  it('knows the fixed names, data shards and media objects, and nothing else', () => {
    expect(classifyPackageEntry('README.txt')).toBe('fixed');
    expect(classifyPackageEntry('media/index.ndjson')).toBe('fixed');
    expect(classifyPackageEntry('media/index.json')).toBe('media'); // the old fixed name is now an ordinary media object name
    expect(classifyPackageEntry('data/users.ndjson')).toBe('data');
    expect(classifyPackageEntry('data/users.2.ndjson')).toBe('data');
    expect(classifyPackageEntry('media/t/inspections/i/photos/p.jpg')).toBe('media');
    expect(classifyPackageEntry('manifest.json')).toBeNull();
    expect(classifyPackageEntry('checksums.sha256')).toBeNull();
    expect(classifyPackageEntry('data/users.1.ndjson')).toBeNull();
    expect(classifyPackageEntry('data/Users.ndjson')).toBeNull();
    expect(classifyPackageEntry('other/x')).toBeNull();
    expect(classifyPackageEntry('media/')).toBeNull();
  });
});

describe('volume names', () => {
  it('round-trips and rejects look-alikes', () => {
    expect(mediaVolumeName(1)).toBe('media-001.zip');
    expect(mediaVolumeName(1234)).toBe('media-1234.zip');
    for (const n of [1, 2, 999, 1000, 99_999]) expect(parseVolumeName(mediaVolumeName(n))).toBe(n);
    expect(parseVolumeName('package.zip')).toBe(0);
    for (const bad of ['media-000.zip', 'media-01.zip', 'media-0001.zip', 'Media-001.zip', 'media-001.zip ', '../media-001.zip', 'media-001.ZIP', 'package.zip.zip'])
      expect(parseVolumeName(bad), bad).toBeNull();
    expect(() => mediaVolumeName(0)).toThrowError(expect.objectContaining({ code: 'volume_name_invalid' }));
    expect(() => mediaVolumeName(100_000)).toThrowError(expect.objectContaining({ code: 'volume_name_invalid' }));
  });
});

describe('VolumePlanner', () => {
  const nameOf = (i: number): string => `media/t/inspections/i/photos/${String(i).padStart(6, '0')}.jpg`;

  it('never exceeds its limits, never splits or reorders, and loses nothing (generated)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = prng(seed);
      const limits = { maxEntries: 1 + Math.floor(rand() * 20), maxBytes: 5_000 + Math.floor(rand() * 50_000) };
      const planner = new VolumePlanner(limits);
      const perVolume = new Map<string, { entries: number; bytes: number; oversize: boolean }>();
      let lastIndex = 0;
      const total = 200;
      for (let i = 0; i < total; i++) {
        const payload = Math.floor(rand() * rand() * 30_000);
        const placed = planner.add(nameOf(i), payload);
        expect(placed.volumeIndex).toBeGreaterThanOrEqual(lastIndex); // never reorders
        expect(placed.volumeIndex - lastIndex).toBeLessThanOrEqual(1);
        expect(placed.opensVolume).toBe(placed.volumeIndex !== lastIndex);
        lastIndex = placed.volumeIndex;
        const v = perVolume.get(placed.volume) ?? { entries: 0, bytes: 0, oversize: false };
        v.entries += 1;
        v.bytes += payload + zipEntryOverhead(nameOf(i).length);
        v.oversize ||= placed.oversize;
        perVolume.set(placed.volume, v);
      }
      let seen = 0;
      for (const v of perVolume.values()) {
        seen += v.entries;
        if (v.oversize) expect(v.entries).toBe(1); // an oversize object is alone, not split
        else {
          expect(v.entries).toBeLessThanOrEqual(limits.maxEntries);
          expect(v.bytes).toBeLessThanOrEqual(limits.maxBytes);
        }
      }
      expect(seen).toBe(total);
    }
  });

  it('puts an object larger than a volume in a volume of its own and flags it', () => {
    const planner = new VolumePlanner({ maxEntries: 10, maxBytes: 10_000 });
    expect(planner.add(nameOf(1), 100)).toMatchObject({ volume: 'media-001.zip', oversize: false });
    expect(planner.add(nameOf(2), 50_000)).toMatchObject({ volume: 'media-002.zip', oversize: true, opensVolume: true });
    expect(planner.add(nameOf(3), 100)).toMatchObject({ volume: 'media-003.zip', oversize: false, opensVolume: true });
  });

  it('starts the first volume at 001 and fills it up to the entry limit', () => {
    const planner = new VolumePlanner({ maxEntries: 2, maxBytes: 1_000_000 });
    expect(planner.add(nameOf(1), 1)).toMatchObject({ volume: 'media-001.zip', opensVolume: true });
    expect(planner.add(nameOf(2), 1)).toMatchObject({ volume: 'media-001.zip', opensVolume: false });
    expect(planner.add(nameOf(3), 1)).toMatchObject({ volume: 'media-002.zip', opensVolume: true });
  });

  it('refuses limits that could not be written without ZIP64, bad sizes and hostile names', () => {
    for (const bad of [{ maxEntries: 0, maxBytes: 10 }, { maxEntries: 65_536, maxBytes: 10 }, { maxEntries: 5, maxBytes: 2 ** 32 }, { maxEntries: 1.5, maxBytes: 10 }, { maxEntries: 5, maxBytes: 0 }])
      expect(() => new VolumePlanner(bad)).toThrowError(expect.objectContaining({ code: 'limit_invalid' }));
    const planner = new VolumePlanner({ maxEntries: 5, maxBytes: 10_000 });
    expect(() => planner.add(nameOf(1), -1)).toThrowError(expect.objectContaining({ code: 'limit_invalid' }));
    expect(() => planner.add(nameOf(1), 1.5)).toThrowError(expect.objectContaining({ code: 'limit_invalid' }));
    expect(() => planner.add('media/../x', 1)).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
  });
});

describe('prefix collisions and ZIP64 limits', () => {
  it('refuses an entry that is a directory prefix of another (case-folded), accepts siblings', () => {
    expect(() => assertNoPrefixCollisions(['media/index.json', 'media/index.json/x'])).toThrowError(expect.objectContaining({ code: 'entry_name_duplicate' }));
    expect(() => assertNoPrefixCollisions(['MEDIA/a', 'media/A/b'])).toThrowError(expect.objectContaining({ code: 'entry_name_duplicate' }));
    expect(() => assertNoPrefixCollisions(['media/a', 'media/ab', 'media/a.jpg', 'data/a.ndjson'])).not.toThrow();
  });

  it('keeps volume limits under the classic zip limits so no volume needs ZIP64', () => {
    expect(ZIP_MAX_ENTRIES).toBeLessThan(65_535);
    expect(ZIP_MAX_BYTES).toBeLessThan(4 * 1024 ** 3);
  });
});
