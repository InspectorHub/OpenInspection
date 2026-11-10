import { describe, expect, it } from 'vitest';
import { generateChecksums, parseChecksums, sha256Hex } from '../../../server/lib/data-package/checksums';
import { compareEntryNames, MediaIndexWriter, MIN_MEDIA_INDEX_ROW_BYTES, readMediaIndex, verifyMediaIndex, type MediaIndexRow } from '../../../server/lib/data-package/media-index';
import { keyProblem, mapKeyToEntryName } from '../../../server/lib/data-package/media-key';
import { encodeNdjsonRow } from '../../../server/lib/data-package/ndjson';
import type { JsonObject } from '../../../server/lib/data-package/safe-json';
import { collect, prng, rejectsWithCode, streamOf, text } from './helpers';

const E_ACUTE = String.fromCharCode(0xe9);
const HAN = String.fromCharCode(0x4e2d);
const sha = (i: number): string => (i + 1).toString(16).padStart(8, '0').repeat(8);

function row(key: string, i = 0, volume = 'media-001.zip'): MediaIndexRow {
  return { key, entry: mapKeyToEntryName(key).entry, bytes: 10 + i, sha256: sha(i), volume, content_type: 'image/jpeg', referenced_by: [{ table: 'inspection_media_pool', id: `id${i}` }] };
}
const withEntry = (entry: string, i = 0): MediaIndexRow => ({ ...row('k', i), entry });

function concat(lines: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(lines.reduce((n, l) => n + l.length, 0));
  let o = 0;
  for (const l of lines) { out.set(l, o); o += l.length; }
  return out;
}
/** Index bytes written WITHOUT the writer's checks, so the reader can be shown refusing what the writer would not write. */
const raw = (rows: JsonObject[]): Uint8Array => concat(rows.map((r) => encodeNdjsonRow(r)));
const read = (bytes: Uint8Array, expectedRows: number, chunks?: number[], volumes?: ReadonlySet<string>) => collect(readMediaIndex(streamOf(bytes, chunks), { expectedRows, volumes }));
const asObj = (r: MediaIndexRow): JsonObject => r as unknown as JsonObject;
/** Compact JSON lines written without the NDJSON writer's own checks (it refuses what these tests need to hand the reader). */
const rawText = (rows: JsonObject[]): Uint8Array => concat(rows.map((r) => text(`${JSON.stringify(r)}
`)));

describe('compareEntryNames', () => {
  it('orders per path segment, case-folded, a directory before its contents', () => {
    expect(compareEntryNames('media/a', 'media/a/b')).toBeLessThan(0);
    expect(compareEntryNames('media/a/b', 'media/a.jpg')).toBeLessThan(0); // segment "a" sorts before "a.jpg"
    expect(compareEntryNames('media/A', 'media/a')).toBe(0);
    expect(compareEntryNames('media/b', 'media/A')).toBeGreaterThan(0);
    expect(compareEntryNames('media/a', 'media/a')).toBe(0);
  });

  it('is antisymmetric and transitive over generated names', () => {
    const rand = prng(5);
    const pool = ['a', 'A', 'b', 'a.jpg', 'x', 'X'];
    const names = Array.from({ length: 60 }, () => `media/${Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pool[Math.floor(rand() * pool.length)]).join('/')}`);
    for (const a of names) for (const b of names) expect(Math.sign(compareEntryNames(a, b)) === -Math.sign(compareEntryNames(b, a))).toBe(true);
    const sorted = [...names].sort(compareEntryNames);
    for (let i = 1; i < sorted.length; i++) expect(compareEntryNames(sorted[i - 1]!, sorted[i]!)).toBeLessThanOrEqual(0);
  });
});

describe('media index round trip', () => {
  /** What an exporter must do: map keys, sort, and force-rename a key whose entry is a directory prefix of the next. */
  function buildEntries(keys: string[]): MediaIndexRow[] {
    const forced = new Set<string>();
    for (let attempt = 0; attempt < 10; attempt++) {
      const rows = keys.map((key, i) => ({ ...row(key, i), entry: mapKeyToEntryName(key, { forceRename: forced.has(key) }).entry })).sort((a, b) => compareEntryNames(a.entry, b.entry));
      let clash = false;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i]!.entry.toLowerCase().startsWith(`${rows[i - 1]!.entry.toLowerCase()}/`)) { forced.add(rows[i - 1]!.key); clash = true; }
      }
      if (!clash) return rows;
    }
    throw new Error('did not converge');
  }

  it('writes then reads back exactly the rows, in order, for generated keys (non-ASCII, case twins, file/directory clashes)', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rand = prng(seed);
      const keys = new Set<string>(['x', 'x/y', 'A/b.JPG', 'a/b.jpg', `${E_ACUTE}/${HAN}.png`]);
      const pool = ['a', 'B', 'c', '1', '.', '-', ' ', '%', E_ACUTE];
      while (keys.size < 120) {
        const key = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pool[Math.floor(rand() * pool.length)]).join('')).join('/');
        if (keyProblem(key) === null) keys.add(key);
      }
      const rows = buildEntries([...keys]);
      const writer = new MediaIndexWriter();
      const bytes = concat(rows.map((r) => writer.write(r)));
      expect(writer.rows).toBe(rows.length);
      expect(writer.bytes).toBe(bytes.length);
      const back = await read(bytes, rows.length, [1 + Math.floor(rand() * 40), 3, 97]);
      expect(back).toEqual(rows);
    }
  });

  it('the smallest row is as long as the manifest assumes', () => {
    const minimal: MediaIndexRow = { key: 'a', entry: 'media/a', bytes: 0, sha256: '0'.repeat(64), volume: 'media-001.zip', content_type: 'a/b', referenced_by: [] };
    expect(new MediaIndexWriter().write(minimal).length).toBe(MIN_MEDIA_INDEX_ROW_BYTES);
  });

  it('the index file is listable in checksums.sha256 (the chain covers it)', async () => {
    const digest = await sha256Hex(text('x'));
    const out = generateChecksums([{ path: 'media/index.ndjson', sha256: digest }, { path: 'data/a.ndjson', sha256: digest }]);
    expect(parseChecksums(out).map((e) => e.path)).toEqual(['data/a.ndjson', 'media/index.ndjson']);
  });
});

describe('ordering, duplicates and file/directory clashes', () => {
  const rows = [row('a/1.jpg', 0), row('a/2.jpg', 1), row('b/1.jpg', 2)];

  it('the writer accepts ascending rows and refuses a duplicate, an out-of-order row, a case-folded duplicate and a directory prefix', () => {
    const ok = new MediaIndexWriter();
    for (const r of rows) ok.write(r);
    expect(ok.rows).toBe(3);

    const refuse = (second: MediaIndexRow, why: RegExp): void => {
      const w = new MediaIndexWriter();
      w.write(withEntry('media/m/b.jpg', 0));
      expect(() => w.write(second)).toThrowError(expect.objectContaining({ code: 'media_index_invalid', message: expect.stringMatching(why) }));
    };
    refuse(withEntry('media/m/b.jpg', 1), /strictly ascending/);
    refuse(withEntry('media/m/B.JPG', 1), /strictly ascending/);
    refuse(withEntry('media/m/a.jpg', 1), /strictly ascending/);
    refuse(withEntry('media/m/b.jpg/x', 1), /directory prefix/);
  });

  it('the reader refuses the same faults in bytes the writer never produced, and accepts the ascending control', async () => {
    const lines = (...entries: string[]): Uint8Array => raw(entries.map((e, i) => asObj(withEntry(e, i))));
    expect(await read(lines('media/a', 'media/b', 'media/c/d'), 3)).toHaveLength(3);
    await rejectsWithCode(read(lines('media/a', 'media/a'), 2), 'media_index_invalid');
    await rejectsWithCode(read(lines('media/b', 'media/a'), 2), 'media_index_invalid');
    await rejectsWithCode(read(lines('media/a', 'media/A'), 2), 'media_index_invalid');
    await rejectsWithCode(read(lines('media/a', 'media/a/b'), 2), 'media_index_invalid');
  });

  it('the shorter path of a file/directory pair is caught even though other entries could sort between them', async () => {
    const lines = raw(['media/a', 'media/a.jpg', 'media/a/b'].map((e, i) => asObj(withEntry(e, i))));
    // "media/a/b" sorts before "media/a.jpg" (segment "a" < "a.jpg"), so this order is simply out of order ...
    await rejectsWithCode(read(lines, 3), 'media_index_invalid');
    // ... and the in-order version exposes the clash between neighbours.
    const sorted = raw(['media/a', 'media/a/b', 'media/a.jpg'].map((e, i) => asObj(withEntry(e, i))));
    await rejectsWithCode(read(sorted, 3), 'media_index_invalid');
  });
});

describe('row validation', () => {
  const good = (): JsonObject => asObj(row('t/p.jpg', 3));
  const bad = (mutate: (r: JsonObject) => void): Uint8Array => { const r = good(); mutate(r); return rawText([r]); };

  it('accepts the good row (the control for every refusal below)', async () => {
    expect(await read(raw([good()]), 1)).toEqual([row('t/p.jpg', 3)]);
  });

  it('names that merely resemble the index file are fine (the positive control for the index-file refusals)', async () => {
    for (const entry of ['media/index.ndjson2', 'media/x/index.ndjson', 'media/index.ndjso']) {
      expect(await read(bad((r) => { r.entry = entry; }), 1), entry).toHaveLength(1);
    }
  });

  it.each([
    ['an unknown field', (r: JsonObject) => { r.extra = 1; }],
    ['a missing key', (r: JsonObject) => { delete r.key; }],
    ['a missing entry', (r: JsonObject) => { delete r.entry; }],
    ['a missing sha256', (r: JsonObject) => { delete r.sha256; }],
    ['a non-hex sha256', (r: JsonObject) => { r.sha256 = 'g'.repeat(64); }],
    ['an upper-case sha256', (r: JsonObject) => { r.sha256 = 'A'.repeat(64); }],
    ['the root volume as the object volume', (r: JsonObject) => { r.volume = 'package.zip'; }],
    ['a malformed volume name', (r: JsonObject) => { r.volume = 'media-000.zip'; }],
    ['a traversal in the entry', (r: JsonObject) => { r.entry = 'media/../x'; }],
    ['an absolute entry', (r: JsonObject) => { r.entry = '/media/x'; }],
    ['an entry outside media/', (r: JsonObject) => { r.entry = 'data/x.ndjson'; }],
    ['the index itself as an entry', (r: JsonObject) => { r.entry = 'media/index.ndjson'; }],
    ['an entry below the index file', (r: JsonObject) => { r.entry = 'media/index.ndjson/x'; }],
    ['the index file under another case', (r: JsonObject) => { r.entry = 'media/INDEX.NDJSON'; }],
    ['an entry below the index file under another case', (r: JsonObject) => { r.entry = 'media/Index.ndjson/y'; }],
    ['an entry with a backslash', (r: JsonObject) => { r.entry = 'media/a\\b'; }],
    ['an upper-case non-allowlist entry', (r: JsonObject) => { r.entry = 'media/caf\u00e9'; }],
    ['a traversal in the key', (r: JsonObject) => { r.key = 'a/../b'; }],
    ['an absolute key', (r: JsonObject) => { r.key = '/a'; }],
    ['a key with a backslash', (r: JsonObject) => { r.key = 'a\\b'; }],
    ['an empty key', (r: JsonObject) => { r.key = ''; }],
    ['a bad content type', (r: JsonObject) => { r.content_type = 'jpeg'; }],
    ['a content type with a space', (r: JsonObject) => { r.content_type = 'image/j peg'; }],
    ['65 references', (r: JsonObject) => { r.referenced_by = Array.from({ length: 65 }, (_, i) => ({ table: 'inspection_media_pool', id: `i${i}` })); }],
    ['a reference with an extra field', (r: JsonObject) => { r.referenced_by = [{ table: 'inspection_media_pool', id: 'a', extra: 1 }]; }],
    ['a reference to a device-named table', (r: JsonObject) => { r.referenced_by = [{ table: 'con', id: 'a' }]; }],
    ['a negative byte count', (r: JsonObject) => { r.bytes = -1; }],
    ['a fractional byte count', (r: JsonObject) => { r.bytes = 1.5; }],
    ['a string byte count', (r: JsonObject) => { r.bytes = '5'; }],
  ])('refuses %s', async (_label, mutate) => {
    await rejectsWithCode(read(bad(mutate), 1), 'media_index_invalid');
  });

  it('a byte count beyond 2^53 is refused as unsafe JSON, and a non-canonical line as non-canonical', async () => {
    await rejectsWithCode(read(bad((r) => { r.contentType = r.content_type; delete r.content_type; }), 1), 'json_unsafe'); // camelCase columns never reach the schema: the NDJSON column rule refuses them
    await rejectsWithCode(read(bad((r) => { r.bytes = 2 ** 60; }), 1), 'json_unsafe');
    await rejectsWithCode(read(text(`${JSON.stringify(good(), null, 1)}\n`.replace(/\n(?=.)/g, ' ')), 1), 'ndjson_not_canonical');
    await rejectsWithCode(read(text('{"key":"a","key":"b"}\n'), 1), 'ndjson_not_canonical');
  });

  it('a line over the limit is refused as it arrives, before the schema sees it', async () => {
    await rejectsWithCode(read(bad((r) => { r.padding = 'x'.repeat(70 * 1024); }), 1, [4096]), 'ndjson_line_too_long');
  });

  it('a row whose volume is not in the manifest list is refused, and one that is listed is accepted', async () => {
    const bytes = raw([asObj(row('t/p.jpg', 1, 'media-002.zip'))]);
    expect(await read(bytes, 1, undefined, new Set(['media-002.zip']))).toHaveLength(1);
    await rejectsWithCode(read(bytes, 1, undefined, new Set(['media-001.zip'])), 'media_index_invalid');
  });
});

describe('row count against the manifest', () => {
  const three = raw([row('a', 0), row('b', 1), row('c', 2)].map(asObj));

  it('accepts exactly the expected count and refuses fewer or more', async () => {
    expect(await read(three, 3)).toHaveLength(3);
    await rejectsWithCode(read(three, 2), 'ndjson_too_many_rows');
    await rejectsWithCode(read(three, 4), 'media_index_invalid');
  });

  it('an expected count of zero accepts an empty index and refuses any row', async () => {
    expect(await read(new Uint8Array(0), 0)).toEqual([]);
    await rejectsWithCode(read(three, 0), 'media_index_invalid');
  });

  it('refuses a stream that ends inside a row, and a bad expected count', async () => {
    await rejectsWithCode(read(three.subarray(0, three.length - 1), 3), 'ndjson_truncated');
    await rejectsWithCode(read(three, -1), 'limit_invalid');
    await rejectsWithCode(read(three, 1.5), 'limit_invalid');
  });
});

describe('verifyMediaIndex against the manifest declaration', () => {
  const rows = [row('a/1.jpg', 0, 'media-001.zip'), row('a/2.jpg', 1, 'media-001.zip'), row('b/1.jpg', 2, 'media-002.zip')];
  const bytes = concat(rows.map((r) => new MediaIndexWriter().write(r)));
  const declaration = async (patch: { sha?: string; indexBytes?: number; count?: number; v1?: number; v1bytes?: number; v2?: number } = {}) => ({
    media: { count: patch.count ?? 3, index: { bytes: patch.indexBytes ?? bytes.length, sha256: patch.sha ?? (await sha256Hex(bytes)) } },
    volumes: [
      { name: 'media-001.zip', entries: patch.v1 ?? 2, bytes: patch.v1bytes ?? 1_000 },
      { name: 'media-002.zip', entries: patch.v2 ?? 1, bytes: 1_000 },
    ],
  });
  const verify = async (patch?: Parameters<typeof declaration>[0], data: Uint8Array = bytes) => verifyMediaIndex(streamOf(data, [64]), await declaration(patch));

  it('accepts an index that matches its declaration and returns the row count', async () => {
    expect(await verify()).toBe(3);
  });

  it('refuses a wrong digest, a wrong size (smaller and larger), and altered bytes', async () => {
    await rejectsWithCode(verify({ sha: 'f'.repeat(64) }), 'media_index_invalid');
    await rejectsWithCode(verify({ indexBytes: bytes.length - 1 }), 'stream_too_large');
    await rejectsWithCode(verify({ indexBytes: bytes.length + 1 }), 'media_index_invalid');
    const altered = bytes.slice();
    const at = new TextDecoder().decode(bytes).indexOf('"sha256":"') + 10; // flip one hex digit of the first row's sha256: still a valid row, a different digest
    altered[at] = altered[at] === 0x30 ? 0x31 : 0x30;
    await rejectsWithCode(verify(undefined, altered), 'media_index_invalid');
  });

  it('refuses a count that differs, a volume whose entry count differs, and a volume too small for its objects', async () => {
    await rejectsWithCode(verify({ count: 2 }), 'ndjson_too_many_rows');
    await rejectsWithCode(verify({ count: 4 }), 'media_index_invalid');
    await rejectsWithCode(verify({ v1: 1, v2: 2 }), 'media_index_invalid');
    await rejectsWithCode(verify({ v1bytes: 5 }), 'media_index_invalid');
  });

  it('refuses a row in a volume the manifest does not list', async () => {
    const stray = concat([row('a/1.jpg', 0, 'media-009.zip')].map((r) => new MediaIndexWriter().write(r)));
    await expect(verifyMediaIndex(streamOf(stray), { media: { count: 1, index: { bytes: stray.length, sha256: await sha256Hex(stray) } }, volumes: [{ name: 'media-001.zip', entries: 1, bytes: 100 }] })).rejects.toMatchObject({ code: 'media_index_invalid' });
  });
});

describe('writer state is read-only, and the writer refuses the index file below it', () => {
  it('rows and bytes cannot be assigned from outside', () => {
    const writer = new MediaIndexWriter();
    writer.write(row('a', 0));
    expect(() => { (writer as unknown as { rows: number }).rows = 99; }).toThrow(TypeError);
    expect(() => { (writer as unknown as { bytes: number }).bytes = 99; }).toThrow(TypeError);
    expect(writer.rows).toBe(1);
  });

  it('the writer refuses an entry below media/index.ndjson, and accepts a lookalike', () => {
    expect(() => new MediaIndexWriter().write(withEntry('media/index.ndjson/x'))).toThrowError(expect.objectContaining({ code: 'media_index_invalid' }));
    expect(new MediaIndexWriter().write(withEntry('media/index.ndjson2')).length).toBeGreaterThan(0);
  });
});

describe('verifyMediaIndex with no media at all', () => {
  const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const empty = { media: { count: 0, index: { bytes: 0, sha256: EMPTY_SHA } }, volumes: [] };

  it('an empty stream, count 0, 0 bytes, the SHA-256 of nothing and no volumes verifies with zero rows', async () => {
    expect(await verifyMediaIndex(streamOf(new Uint8Array(0)), empty)).toBe(0);
  });

  it('refuses a wrong digest for the empty index, and any row when count is 0', async () => {
    await rejectsWithCode(verifyMediaIndex(streamOf(new Uint8Array(0)), { ...empty, media: { count: 0, index: { bytes: 0, sha256: 'f'.repeat(64) } } }), 'media_index_invalid');
    const one = new MediaIndexWriter().write(row('a', 0));
    await rejectsWithCode(verifyMediaIndex(streamOf(one), empty), 'stream_too_large');
    await rejectsWithCode(verifyMediaIndex(streamOf(one), { media: { count: 0, index: { bytes: one.length, sha256: await sha256Hex(one) } }, volumes: [] }), 'media_index_invalid');
  });
});
