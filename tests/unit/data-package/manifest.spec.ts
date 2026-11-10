import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, MAX_MANIFEST_BYTES, parseManifest, serializeManifest, type Manifest } from '../../../server/lib/data-package/manifest';
import { text } from './helpers';

const goldenText = readFileSync(new URL('../../fixtures/data-package/v1-manifest.json', import.meta.url), 'utf8');
type Obj = Record<string, unknown>;
const golden = (): Obj => JSON.parse(goldenText) as Obj;
const files = (m: Obj): Obj[] => m.files as Obj[];
const volumes = (m: Obj): Obj[] => m.volumes as Obj[];
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
    expect(parsed.excluded.map((e) => e.class)).toEqual(['withheld_secret', 'out_of_scope', 'external_media']);
    expect(new TextDecoder().decode(serializeManifest(parsed))).toBe(goldenText);
    expect(parseManifest(serializeManifest(parsed))).toEqual(parsed);
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
  it.each(['formatVersion', 'schemaVersion', 'columnFingerprint', 'engineVersion', 'packageId', 'exportedAt', 'sourceMode', 'sourceTenantId', 'sourceHost', 'encryption', 'counts', 'files', 'volumes', 'excluded'])(
    'a missing %s',
    (field) => expectRejected((m) => { delete m[field]; }, 'manifest_invalid', field === 'formatVersion' ? /formatVersion/ : undefined),
  );

  it('unknown fields at every level', () => {
    expectRejected((m) => { m.extra = 1; });
    expectRejected((m) => { files(m)[0]!.extra = 1; });
    expectRejected((m) => { volumes(m)[0]!.extra = 1; });
    expectRejected((m) => { (m.excluded as Obj[])[0]!.extra = 1; });
  });

  it('a bad sha256 (short, upper-case, non-hex, wrong type)', () => {
    for (const bad of ['abc', 'A'.repeat(64), 'g'.repeat(64), 5, null, `${'a'.repeat(63)} `]) {
      expectRejected((m) => { files(m)[0]!.sha256 = bad; });
    }
    expectRejected((m) => { m.columnFingerprint = 'x'; });
    expectRejected((m) => { volumes(m)[0]!.sha256 = 'x'; });
  });

  it('hostile file paths', () => {
    for (const bad of ['/etc/passwd', '../x', 'data/../x.ndjson', 'media/../../x', 'C:/x', 'media\\x', 'data/x\u0000.ndjson', 'manifest.json', 'checksums.sha256', 'other/x.bin', 'data/users.1.ndjson', 'data/Users.ndjson', '', 'data/con.ndjson', 'media/x/con .txt']) {
      expectRejected((m) => { files(m)[2]!.path = bad; }, bad.includes('\u0000') ? 'json_unsafe' : 'manifest_invalid');
    }
  });

  it('paths that collide once case is folded, and the same path twice', () => {
    expectRejected((m) => { files(m).push({ ...files(m)[6]!, path: 'media/9b1c7e52-aaaa-4bbb-8ccc-ddddeeeeffff/inspections/i1/photos/P1.JPG' }); }, 'manifest_invalid', /duplicate file path/);
    expectRejected((m) => { files(m).push({ ...files(m)[6]! }); }, 'manifest_invalid', /duplicate file path/);
  });

  it('a path that is a directory prefix of another (media/index.json and media/index.json/x)', () => {
    expectRejected((m) => { files(m).push({ ...files(m)[6]!, path: 'media/index.json/x' }); volumes(m)[0]!.entries = 2; }, 'manifest_invalid', /directory prefix/);
    expectAccepted((m) => { files(m).push({ ...files(m)[6]!, path: 'media/index.json2' }); volumes(m)[0]!.entries = 2; volumes(m)[0]!.bytes = 200_000; });
  });

  it('a file in an unlisted volume, a data file in a media volume and a media object in the root volume', () => {
    expectRejected((m) => { files(m)[6]!.volume = 'media-002.zip'; }, 'manifest_invalid', /volume that is not listed/);
    expectRejected((m) => { files(m)[2]!.volume = 'media-001.zip'; }, 'manifest_invalid', /only media objects travel/);
    expectRejected((m) => { files(m)[6]!.volume = 'package.zip'; }, 'manifest_invalid', /belongs in a media volume/);
  });

  it('bad volume names, the root volume inside volumes, duplicate volumes', () => {
    expectRejected((m) => { volumes(m)[0]!.name = '../media-001.zip'; files(m)[6]!.volume = '../media-001.zip'; });
    expectRejected((m) => { volumes(m)[0]!.name = 'package.zip'; }, 'manifest_invalid', /root volume is not listed/);
    expectRejected((m) => { volumes(m).push({ ...volumes(m)[0]! }); }, 'manifest_invalid', /duplicate volume name/);
  });

  it('media volumes must be numbered consecutively from 001', () => {
    expectRejected((m) => { volumes(m)[0]!.name = 'media-002.zip'; files(m)[6]!.volume = 'media-002.zip'; }, 'manifest_invalid', /consecutively/);
    expectRejected((m) => { volumes(m).push({ ...volumes(m)[0]!, name: 'media-003.zip' }); }, 'manifest_invalid', /consecutively/);
    expectAccepted((m) => { volumes(m).push({ ...volumes(m)[0]!, name: 'media-002.zip' }); });
  });

  it('a volume entry count must equal the files listed in it, and its bytes cannot be below their sum', () => {
    expectRejected((m) => { volumes(m)[0]!.entries = 2; }, 'manifest_invalid', /entry count differs/);
    expectRejected((m) => { volumes(m)[0]!.bytes = 88_120; }, 'manifest_invalid', /smaller than the files/);
    expectAccepted((m) => { volumes(m)[0]!.bytes = 88_121; });
  });

  it('a media volume with no files listed (hashes kept in media/index.json) must still hold entries', () => {
    expectAccepted((m) => { m.files = files(m).filter((f) => f.volume === 'package.zip'); volumes(m)[0]!.entries = 5_000; });
    expectRejected((m) => { m.files = files(m).filter((f) => f.volume === 'package.zip'); volumes(m)[0]!.entries = 0; }, 'manifest_invalid', /holds no entries/);
  });

  it('the root volume cannot need ZIP64', () => {
    expectRejected((m) => { files(m)[0]!.bytes = 4 * 1024 ** 3; }, 'manifest_invalid', /ZIP64/);
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
    expectRejected((m) => { files(m)[5]!.rows = 1; }, 'manifest_invalid', /only data and esign ndjson files carry a row count/);
    expectRejected((m) => { files(m)[3]!.rows = 1; }, 'manifest_invalid', /only data and esign ndjson files carry a row count/);
    expectRejected((m) => { files(m)[6]!.rows = 1; }, 'manifest_invalid', /only data and esign ndjson files carry a row count/);
    expectAccepted((m) => { files(m)[4]!.rows = 11; });
  });

  it('numbers that are negative, fractional, huge or not numbers', () => {
    for (const bad of [-1, 1.5, '5', null]) {
      expectRejected((m) => { files(m)[0]!.bytes = bad; });
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
  const withFiles = (n: number): Obj => {
    const m = golden();
    m.files = [files(m)[0]!, ...Array.from({ length: n - 1 }, (_, i) => ({ path: `media/x/${i}.jpg`, volume: 'media-001.zip', bytes: 1, sha256: 'a'.repeat(64) }))];
    (m.counts as Obj).inspections = 500;
    delete (m.counts as Obj).users;
    files(m)[0]!.rows = 500;
    m.volumes = [{ name: 'media-001.zip', bytes: 1_000_000, entries: n - 1, sha256: 'b'.repeat(64) }];
    return m;
  };

  it('accepts exactly 50,000 listed files and refuses 50,001 (the limit is the checksums entry cap minus two)', () => {
    expect(failure(canonical(withFiles(50_000)))).toEqual({ code: 'accepted', message: '' });
    const refused = failure(canonical(withFiles(50_001)));
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
