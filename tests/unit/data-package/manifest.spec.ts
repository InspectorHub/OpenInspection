import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateChecksums, parseChecksums } from '../../../server/lib/data-package/checksums';
import { assertRootChecksums, FORMAT_VERSION, MAX_MANIFEST_BYTES, parseManifest, serializeManifest, type Manifest } from '../../../server/lib/data-package/manifest';
import { MIN_MEDIA_INDEX_ROW_BYTES } from '../../../server/lib/data-package/media-index';
import { dataFileName } from '../../../server/lib/data-package/shard';
import { text } from './helpers';

const goldenText = readFileSync(new URL('../../fixtures/data-package/v1-manifest.json', import.meta.url), 'utf8');
type Obj = Record<string, unknown>;
const golden = (): Obj => JSON.parse(goldenText) as Obj;
// golden files: 0 inspections, 1 inspections.2, 2 users, 3 esign/events.ndjson, 4 README.txt
const files = (m: Obj): Obj[] => m.files as Obj[];
const volumes = (m: Obj): Obj[] => m.volumes as Obj[];
const media = (m: Obj): Obj => m.media as Obj;
const mediaIndex = (m: Obj): Obj => media(m).index as Obj;
const canonical = (m: Obj): string => `${JSON.stringify(m, null, 2)}\n`;

function failure(input: string): { code: string; message: string } {
  try {
    parseManifest(input);
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? 'none', message: e.message ?? '' };
  }
  return { code: 'accepted', message: '' };
}

/** The mutated manifest must be refused with exactly `code`, and (when given) with a message naming the check that fired. */
function expectRejected(mutate: (m: Obj) => void, code: 'manifest_invalid' | 'json_unsafe' = 'manifest_invalid', why?: RegExp): void {
  const m = golden();
  mutate(m);
  const got = failure(canonical(m));
  expect(got.code, got.message).toBe(code);
  if (why) expect(got.message).toMatch(why);
}

/** The mutated manifest must be accepted (the positive control of a rejection test). */
function expectAccepted(mutate: (m: Obj) => void): void {
  const m = golden();
  mutate(m);
  expect(failure(canonical(m))).toEqual({ code: 'accepted', message: '' });
}

describe('manifest golden sample', () => {
  it('parses, and serializes back to exactly the bytes of the sample (canonical form)', () => {
    const parsed = parseManifest(goldenText);
    expect(parsed.formatVersion).toBe(FORMAT_VERSION);
    expect(parsed.counts).toEqual({ inspections: 812, users: 3 });
    expect(parsed.media).toEqual({ count: 1, index: { path: 'media/index.ndjson', bytes: 330, sha256: '8123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' } });
    expect(parsed.excluded.map((e) => e.class)).toEqual(['withheld_secret', 'out_of_scope', 'external_media']);
    expect(new TextDecoder().decode(serializeManifest(parsed))).toBe(goldenText);
    expect(parseManifest(serializeManifest(parsed))).toEqual(parsed);
  });

  it('lists no media object and no per-object hash: media is a count plus the index file', () => {
    const parsed = parseManifest(goldenText);
    expect(parsed.files.some((f) => f.path.startsWith('media/'))).toBe(false);
    expect(Object.keys(parsed.media)).toEqual(['count', 'index']);
  });

  it('accepts bytes as well as text', () => {
    expect(parseManifest(text(goldenText)).packageId).toBe('3f2c0a8e-1111-4222-8333-444455556666');
  });

  it('serializing refuses a manifest the parser would refuse', () => {
    const bad = { ...parseManifest(goldenText), counts: { inspections: 1, users: 3 } } as Manifest;
    expect(() => serializeManifest(bad)).toThrow();
  });
});

describe('manifest canonical form', () => {
  it.each([
    ['compact', () => JSON.stringify(golden())],
    ['CRLF line endings', () => canonical(golden()).replace(/\n/g, '\r\n')],
    ['no trailing newline', () => canonical(golden()).trimEnd()],
    ['four-space indent', () => `${JSON.stringify(golden(), null, 4)}\n`],
    ['keys in another order', () => { const m = golden(); const { formatVersion, ...rest } = m; return canonical({ ...rest, formatVersion }); }],
    ['a repeated key (the parser keeps the last)', () => canonical(golden()).replace('"formatVersion": 1,', '"formatVersion": 1,\n  "formatVersion": 1,')],
  ])('refuses %s', (_label, make) => {
    expect(failure(make()).code).toBe('manifest_not_canonical');
  });

  it('refuses a number written in a non-canonical form', () => {
    expect(failure(canonical(golden()).replace('"bytes": 900', '"bytes": 9e2')).code).toBe('manifest_not_canonical');
    expect(failure(canonical(golden()).replace('"bytes": 900', '"bytes": 900.0')).code).toBe('manifest_not_canonical');
  });
});

describe('manifest rejects', () => {
  it.each(['formatVersion', 'schemaVersion', 'columnFingerprint', 'engineVersion', 'packageId', 'exportedAt', 'sourceMode', 'sourceTenantId', 'sourceHost', 'encryption', 'counts', 'media', 'files', 'volumes', 'excluded'])(
    'a missing %s',
    (field) => expectRejected((m) => { delete m[field]; }, 'manifest_invalid', field === 'formatVersion' ? /formatVersion/ : undefined),
  );

  it('unknown fields at every level, including inside media', () => {
    expectRejected((m) => { m.extra = 1; });
    expectRejected((m) => { files(m)[0]!.extra = 1; });
    expectRejected((m) => { volumes(m)[0]!.extra = 1; });
    expectRejected((m) => { (m.excluded as Obj[])[0]!.extra = 1; });
    expectRejected((m) => { media(m).extra = 1; });
    expectRejected((m) => { mediaIndex(m).extra = 1; });
  });

  it('a bad sha256 (short, upper-case, non-hex, wrong type), including the media index digest', () => {
    for (const bad of ['abc', 'A'.repeat(64), 'g'.repeat(64), 5, null, `${'a'.repeat(63)} `]) {
      expectRejected((m) => { files(m)[0]!.sha256 = bad; });
      expectRejected((m) => { mediaIndex(m).sha256 = bad; });
    }
    expectRejected((m) => { m.columnFingerprint = 'x'; });
    expectRejected((m) => { volumes(m)[0]!.sha256 = 'x'; });
  });

  it('hostile file paths', () => {
    for (const bad of ['/etc/passwd', '../x', 'data/../x.ndjson', 'media/../../x', 'C:/x', 'media\\x', 'data/x\u0000.ndjson', 'manifest.json', 'checksums.sha256', 'other/x.bin', 'data/users.1.ndjson', 'data/Users.ndjson', '', 'data/con.ndjson', 'media/x/con .txt']) {
      expectRejected((m) => { files(m)[2]!.path = bad; }, bad.includes('\u0000') ? 'json_unsafe' : 'manifest_invalid');
    }
  });

  it('the same path twice', () => {
    expectRejected((m) => { files(m).push({ ...files(m)[4]! }); }, 'manifest_invalid', /duplicate file path/);
  });

  it('listing a media object, the media index itself, or an entry inside the index name is refused (media is described by media.*)', () => {
    expectRejected((m) => { files(m).push({ path: 'media/t/p.jpg', volume: 'media-001.zip', bytes: 1, sha256: 'a'.repeat(64) }); }, 'manifest_invalid', /described by the media index/);
    expectRejected((m) => { files(m).push({ path: 'media/index.ndjson', volume: 'package.zip', bytes: 1, sha256: 'a'.repeat(64) }); }, 'manifest_invalid', /media\.index, not listed/);
    expectRejected((m) => { files(m).push({ path: 'media/index.ndjson/x', volume: 'package.zip', bytes: 1, sha256: 'a'.repeat(64) }); }, 'manifest_invalid', /directory prefix/);
  });

  it('listed files must be in the root volume', () => {
    expectRejected((m) => { files(m)[2]!.volume = 'media-001.zip'; }, 'manifest_invalid', /only the root volume holds listed files/);
    expectRejected((m) => { files(m)[2]!.volume = 'media-009.zip'; }, 'manifest_invalid', /only the root volume holds listed files/);
  });

  it('bad volume names, the root volume inside volumes, duplicate volumes', () => {
    expectRejected((m) => { volumes(m)[0]!.name = '../media-001.zip'; });
    expectRejected((m) => { volumes(m)[0]!.name = 'package.zip'; }, 'manifest_invalid', /root volume is not listed/);
    expectRejected((m) => { volumes(m).push({ ...volumes(m)[0]! }); }, 'manifest_invalid', /duplicate volume name/);
  });

  it('media volumes must be numbered consecutively from 001', () => {
    expectRejected((m) => { volumes(m)[0]!.name = 'media-002.zip'; }, 'manifest_invalid', /consecutively/);
    expectRejected((m) => { volumes(m).push({ ...volumes(m)[0]!, name: 'media-003.zip' }); media(m).count = 2; }, 'manifest_invalid', /consecutively/);
    expectAccepted((m) => { volumes(m).push({ ...volumes(m)[0]!, name: 'media-002.zip' }); media(m).count = 2; mediaIndex(m).bytes = 700; });
  });

  it('volume entry counts must add up to media.count, and every media volume holds at least one entry', () => {
    expectRejected((m) => { volumes(m)[0]!.entries = 2; }, 'manifest_invalid', /do not add up to media\.count/);
    expectRejected((m) => { media(m).count = 2; mediaIndex(m).bytes = 700; }, 'manifest_invalid', /do not add up to media\.count/);
    expectRejected((m) => { volumes(m)[0]!.entries = 0; }, 'manifest_invalid', /holds no entries/);
    expectAccepted((m) => { volumes(m)[0]!.entries = 5_000; media(m).count = 5_000; mediaIndex(m).bytes = 5_000 * 400; });
  });

  it('an empty media set has no volumes and an empty index; media objects need volumes', () => {
    const empty = (m: Obj): void => { media(m).count = 0; mediaIndex(m).bytes = 0; m.volumes = []; };
    expectAccepted(empty);
    expectRejected((m) => { empty(m); mediaIndex(m).bytes = 5; }, 'manifest_invalid', /empty media index has no bytes/);
    expectRejected((m) => { empty(m); m.volumes = [{ name: 'media-001.zip', bytes: 1, entries: 1, sha256: 'a'.repeat(64) }]; }, 'manifest_invalid', /empty media index has no media volumes/);
    expectRejected((m) => { m.volumes = []; }, 'manifest_invalid', /need at least one media volume/);
  });

  it('the media index must be large enough for its row count, and be the fixed name', () => {
    expect(MIN_MEDIA_INDEX_ROW_BYTES).toBeGreaterThan(100);
    expectRejected((m) => { mediaIndex(m).bytes = MIN_MEDIA_INDEX_ROW_BYTES - 1; }, 'manifest_invalid', /media index is too small/);
    expectAccepted((m) => { mediaIndex(m).bytes = MIN_MEDIA_INDEX_ROW_BYTES; });
    expectRejected((m) => { mediaIndex(m).path = 'media/index.json'; });
    expectRejected((m) => { mediaIndex(m).path = 'media/other.ndjson'; });
    expectRejected((m) => { mediaIndex(m).path = '../media/index.ndjson'; });
  });

  it('the root volume cannot need ZIP64 (listed files plus the index)', () => {
    expectRejected((m) => { files(m)[0]!.bytes = 4 * 1024 ** 3; }, 'manifest_invalid', /ZIP64/);
    expectRejected((m) => { mediaIndex(m).bytes = 4 * 1024 ** 3; }, 'manifest_invalid', /ZIP64/);
    expectAccepted((m) => { files(m)[0]!.bytes = 2 * 1024 ** 3; });
  });

  it('counts that disagree with the shard rows, orphan counts, missing counts and missing shards', () => {
    expectRejected((m) => { (m.counts as Obj).inspections = 811; }, 'manifest_invalid', /counts\.inspections does not equal/);
    expectRejected((m) => { (m.counts as Obj).ghost = 0; }, 'manifest_invalid', /counts\.ghost has no data file/);
    expectRejected((m) => { delete (m.counts as Obj).users; }, 'manifest_invalid', /counts\.users/);
    expectRejected((m) => { m.files = files(m).filter((f) => f.path !== 'data/inspections.ndjson'); }, 'manifest_invalid', /not consecutive/);
    expectRejected((m) => { delete files(m)[0]!.rows; }, 'manifest_invalid', /must state its row count/);
  });

  it('rows and bytes cannot contradict each other (every row is at least 3 bytes; no rows means no bytes)', () => {
    expectRejected((m) => { files(m)[2]!.rows = 3; files(m)[2]!.bytes = 8; }, 'manifest_invalid', /too small for its row count/);
    expectAccepted((m) => { files(m)[2]!.rows = 3; files(m)[2]!.bytes = 9; });
    expectRejected((m) => { files(m)[2]!.rows = 0; files(m)[2]!.bytes = 5; (m.counts as Obj).users = 0; }, 'manifest_invalid', /no rows has no bytes/);
    expectAccepted((m) => { files(m)[2]!.rows = 0; files(m)[2]!.bytes = 0; (m.counts as Obj).users = 0; });
  });

  it('a row count is allowed only on data files and esign ndjson files', () => {
    expectRejected((m) => { files(m)[4]!.rows = 1; }, 'manifest_invalid', /only data and esign ndjson files carry a row count/);
    expectAccepted((m) => { files(m)[3]!.rows = 11; });
  });

  it('numbers that are negative, fractional, huge or not numbers', () => {
    for (const bad of [-1, 1.5, '5', null]) {
      expectRejected((m) => { files(m)[0]!.bytes = bad; });
      expectRejected((m) => { media(m).count = bad; });
    }
    for (const bad of [2 ** 53, 1e300]) {
      expectRejected((m) => { files(m)[0]!.bytes = bad; }, 'json_unsafe');
    }
    expectRejected((m) => { (m.counts as Obj).inspections = -812; });
  });

  it('unknown excluded classes, bad table names and over-long reasons', () => {
    expectRejected((m) => { (m.excluded as Obj[])[0]!.class = 'mystery'; });
    expectRejected((m) => { (m.excluded as Obj[])[0]!.table = 'Users'; });
    expectRejected((m) => { (m.excluded as Obj[])[0]!.reason = 'x'.repeat(501); });
    expectRejected((m) => { (m.excluded as Obj[])[0]!.columns = ['Bad Name']; });
  });

  it('bad identifiers, timestamps and modes', () => {
    expectRejected((m) => { m.packageId = 'not-a-uuid'; });
    expectRejected((m) => { m.exportedAt = 'yesterday'; });
    expectRejected((m) => { m.sourceMode = 'cloud'; });
    expectRejected((m) => { m.sourceTenantId = '../x'; });
    expectRejected((m) => { m.sourceHost = 'a b'; });
    expectRejected((m) => { m.schemaVersion = 'x y'; });
  });

  it('prototype keys, NUL and unpaired surrogates, anywhere', () => {
    expect(failure(goldenText.replace('"counts": {', '"counts": {"__proto__": 1,')).code).toBe('json_unsafe');
    expect(failure(goldenText.replace('"formatVersion": 1,', '"formatVersion": 1, "__proto__": {"x": 1},')).code).toBe('json_unsafe');
    expect(({} as Obj).x).toBeUndefined();
    expectRejected((m) => { (m.excluded as Obj[])[0]!.reason = 'bad\u0000nul'; }, 'json_unsafe');
    expectRejected((m) => { (m.excluded as Obj[])[0]!.reason = `lone${String.fromCharCode(0xd800)}`; }, 'json_unsafe');
  });

  it('counts keyed by a name outside the table-name pattern, or by a device name', () => {
    expectRejected((m) => { (m.counts as Obj)['constructor.x'] = 1; });
    expectRejected((m) => { (m.counts as Obj).Users = 1; });
    expectRejected((m) => { (m.counts as Obj).con = 1; });
  });

  it('any encryption value: format 1 defines no encrypted layout, so only null is accepted', () => {
    for (const bad of ['aes', { scheme: 'x' }, { scheme: 'age-passphrase-v1', params: { iterations: 1 } }, true, 0]) {
      expectRejected((m) => { m.encryption = bad; }, 'manifest_invalid', /encryption/);
    }
    expectAccepted((m) => { m.encryption = null; });
  });

  it('not JSON, not an object, empty, BOM, invalid UTF-8, oversize', () => {
    for (const bad of ['', '{', '[]', 'null', '"x"', '1']) expect(failure(bad).code, bad).toBe('manifest_invalid');
    expect(failure(`\ufeff${goldenText}`).code).toBe('manifest_invalid');
    expect(() => parseManifest(Uint8Array.from([0x7b, 0xff, 0x7d]))).toThrowError(expect.objectContaining({ code: 'manifest_invalid' }));
    expect(() => parseManifest(new Uint8Array(MAX_MANIFEST_BYTES + 1))).toThrowError(expect.objectContaining({ code: 'manifest_too_large' }));
  });

  it('the size limit is in bytes, not characters: 6 million 3-byte characters are too large', () => {
    const wide = String.fromCharCode(0x20ac).repeat(Math.ceil(MAX_MANIFEST_BYTES / 3) + 1);
    expect(wide.length).toBeLessThan(MAX_MANIFEST_BYTES);
    expect(failure(wide).code).toBe('manifest_too_large');
  });
});

describe('manifest file-count limit', () => {
  /** n one-row shards of one table: the only way left to list many distinct files now that media objects are not listed. */
  const withShards = (n: number): Obj => {
    const m = golden();
    m.files = Array.from({ length: n }, (_, i) => ({ path: dataFileName('t', i + 1), volume: 'package.zip', rows: 1, bytes: 3, sha256: 'a'.repeat(64) }));
    m.counts = { t: n };
    return m;
  };

  it('accepts exactly 50,000 listed files and refuses 50,001 (the limit is the checksums entry cap minus two)', () => {
    expect(failure(canonical(withShards(50_000)))).toEqual({ code: 'accepted', message: '' });
    const refused = failure(canonical(withShards(50_001)));
    expect(refused.code).toBe('manifest_invalid');
    expect(refused.message).toMatch(/files\[depth 1\]: too_big/);
  }, 60_000);
});

describe('manifest error messages never echo attacker text', () => {
  it('a 5000-character unknown key is not repeated, and the message stays short', () => {
    const m = golden();
    m['Z'.repeat(5000)] = 1;
    const got = failure(canonical(m));
    expect(got.code).toBe('manifest_invalid');
    expect(got.message).not.toContain('ZZZZ');
    expect(got.message.length).toBeLessThanOrEqual(5 * 80 + 4 * 2);
  });

  it('a 5000-character counts key, file path and reason do not appear in the message', () => {
    for (const mutate of [
      (m: Obj) => { (m.counts as Obj)['Q'.repeat(5000)] = 1; },
      (m: Obj) => { files(m)[2]!.path = `data/${'Q'.repeat(5000)}.ndjson`; },
      (m: Obj) => { (m.excluded as Obj[])[0]!.reason = 'Q'.repeat(5000); },
    ]) {
      const m = golden();
      mutate(m);
      const got = failure(canonical(m));
      expect(got.code).toBe('manifest_invalid');
      expect(got.message).not.toContain('QQQQ');
      expect(got.message.length).toBeLessThanOrEqual(5 * 80 + 4 * 2);
    }
  });
});

describe('manifest versioning', () => {
  it('a newer format is refused with its own code, before any other validation', () => {
    expect(() => parseManifest(JSON.stringify({ formatVersion: FORMAT_VERSION + 1, nothing: 'else' }))).toThrowError(
      expect.objectContaining({ code: 'format_version_newer', message: expect.stringContaining(String(FORMAT_VERSION + 1)) }),
    );
  });

  it('a future-format manifest is reported as newer even when it carries content this format would call unsafe', () => {
    const future = [
      '{"formatVersion":2,"__proto__":{"x":1}}',
      `{"formatVersion":2,"deep":${'['.repeat(200)}${']'.repeat(200)}}`,
      '{"formatVersion":2,"n":12345678901234567890}',
      `{"formatVersion":2,"s":"${String.fromCharCode(92)}u0000"}`,
    ];
    for (const input of future) expect(failure(input).code, input.slice(0, 40)).toBe('format_version_newer');
  });

  it('a missing, zero, negative, fractional or huge version is invalid', () => {
    for (const v of [undefined, 0, -1, 1.5, 2 ** 60, '1', null]) {
      const got = failure(JSON.stringify({ ...golden(), formatVersion: v }));
      expect(got.code, String(v)).toBe('manifest_invalid');
      expect(got.message, String(v)).toMatch(/formatVersion/);
    }
  });
});

describe('root checksums against the manifest (media volumes carry no checksums file)', () => {
  const manifest = parseManifest(goldenText);
  const good = () => [...manifest.files.map((f) => ({ path: f.path, sha256: f.sha256 })), { path: manifest.media.index.path, sha256: manifest.media.index.sha256 }];
  const refused = (entries: Array<{ path: string; sha256: string }>) => expect(() => assertRootChecksums(entries, manifest)).toThrowError(expect.objectContaining({ code: 'checksums_invalid' }));

  it('accepts exactly the listed files plus the media index (also after a generate/parse round trip)', () => {
    expect(() => assertRootChecksums(good(), manifest)).not.toThrow();
    expect(() => assertRootChecksums(parseChecksums(generateChecksums(good())), manifest)).not.toThrow();
  });

  it('refuses a missing index line, a missing file, an extra file, a media object, and a different digest', () => {
    refused(good().filter((e) => e.path !== 'media/index.ndjson'));
    refused(good().filter((e) => e.path !== 'data/users.ndjson'));
    refused([...good(), { path: 'esign/keys.ndjson', sha256: 'a'.repeat(64) }]);
    refused([...good(), { path: 'media/t/inspections/i/photos/p.jpg', sha256: 'a'.repeat(64) }]);
    refused(good().map((e) => (e.path === 'data/users.ndjson' ? { ...e, sha256: 'a'.repeat(64) } : e)));
    refused(good().map((e) => (e.path === 'media/index.ndjson' ? { ...e, sha256: 'a'.repeat(64) } : e)));
  });

  it('a tenant with 65,000 media objects in one volume is accepted: the media count is unrelated to the checksums entry cap', () => {
    const m = golden();
    media(m).count = 65_000;
    mediaIndex(m).bytes = 65_000 * 400;
    volumes(m)[0]!.entries = 65_000;
    expect(failure(canonical(m))).toEqual({ code: 'accepted', message: '' });
  });
});
