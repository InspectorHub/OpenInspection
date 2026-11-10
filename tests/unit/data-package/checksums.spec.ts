import { describe, expect, it } from 'vitest';
import {
  createDigestTap, createSha256Hasher, generateChecksums, MAX_CHECKSUM_ENTRIES, MAX_CHECKSUMS_BYTES, parseChecksums, sha256Hex, sha256OfStream,
  type DigestStreamCtor, type ChecksumEntry,
} from '../../../server/lib/data-package/checksums';
import { prng, randomBytes, rejectsWithCode, streamOf } from './helpers';

const H1 = '0123456789abcdef'.repeat(4);
const H2 = 'fedcba9876543210'.repeat(4);

describe('GNU sha256sum format', () => {
  it('writes "<hash>  <path>" lines, sorted, each terminated by LF', () => {
    const out = generateChecksums([
      { path: 'data/b.ndjson', sha256: H2 },
      { path: 'data/a.ndjson', sha256: H1 },
    ]);
    expect(out).toBe(`${H1}  data/a.ndjson\n${H2}  data/b.ndjson\n`);
  });

  it('round-trips generated entry sets (order-insensitive, names with spaces)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rand = prng(seed);
      const entries: ChecksumEntry[] = [];
      const n = 1 + Math.floor(rand() * 40);
      for (let i = 0; i < n; i++) {
        const hex = Array.from(randomBytes(rand, 32), (b) => b.toString(16).padStart(2, '0')).join('');
        entries.push({ path: `media/t/photo ${i} (copy).jpg`, sha256: hex });
      }
      const parsed = parseChecksums(generateChecksums(entries));
      const key = (e: ChecksumEntry): string => e.path;
      expect([...parsed].sort((a, b) => key(a).localeCompare(key(b)))).toEqual([...entries].sort((a, b) => key(a).localeCompare(key(b))));
      expect(generateChecksums(parsed)).toBe(generateChecksums(entries));
    }
  });

  it('produces the line `sha256sum` prints for a known input (digest of "hello\n", two spaces, name)', async () => {
    const bytes = new TextEncoder().encode('hello\n');
    const sum = await sha256Hex(bytes);
    // `printf 'hello\n' | sha256sum` prints exactly this digest followed by two spaces and the name.
    expect(sum).toBe('5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03');
    expect(generateChecksums([{ path: 'README.txt', sha256: sum }])).toBe(`${sum}  README.txt\n`);
  });

  it.each([
    ['empty file', ''],
    ['no final newline (truncated)', `${H1}  data/a.ndjson`],
    ['CRLF', `${H1}  data/a.ndjson\r\n`],
    ['single space separator', `${H1} data/a.ndjson\n`],
    ['binary-mode marker', `${H1} *data/a.ndjson\n`],
    ['three spaces', `${H1}   data/a.ndjson\n`],
    ['upper-case digest', `${H1.toUpperCase()}  data/a.ndjson\n`],
    ['short digest', `${H1.slice(1)}  data/a.ndjson\n`],
    ['long digest', `${H1}0  data/a.ndjson\n`],
    ['escaped-name marker', `\\${H1}  data/a.ndjson\n`],
    ['blank line', `${H1}  data/a.ndjson\n\n`],
    ['byte order mark', `\ufeff${H1}  data/a.ndjson\n`],
    ['traversal', `${H1}  ../a\n`],
    ['absolute', `${H1}  /a\n`],
    ['backslash', `${H1}  data\\a\n`],
    ['duplicate', `${H1}  data/a.ndjson\n${H2}  data/a.ndjson\n`],
    ['duplicate after case folding', `${H1}  data/a.ndjson\n${H2}  DATA/A.ndjson\n`],
    ['empty name', `${H1}  \n`],
  ])('rejects %s', (_label, text) => {
    expect(() => parseChecksums(text)).toThrowError(expect.objectContaining({ code: expect.stringMatching(/^(checksums_invalid|entry_name_invalid|entry_name_duplicate)$/) }));
  });

  it('refuses to generate what it would refuse to parse', () => {
    expect(() => generateChecksums([{ path: '../x', sha256: H1 }])).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
    expect(() => generateChecksums([{ path: 'README.txt', sha256: 'XYZ' }])).toThrowError(expect.objectContaining({ code: 'checksums_invalid' }));
    expect(() => generateChecksums([{ path: 'media/x/a.jpg', sha256: H1 }, { path: 'media/x/A.jpg', sha256: H2 }])).toThrowError(expect.objectContaining({ code: 'entry_name_duplicate' }));
  });
});

describe('streaming sha256', () => {
  it('matches the one-shot digest for random inputs split at random places', async () => {
    const rand = prng(11);
    for (const length of [0, 1, 63, 64, 65, 1000, 70_000]) {
      const bytes = randomBytes(rand, length);
      const sizes = Array.from({ length: 5 }, () => 1 + Math.floor(rand() * 5000));
      const got = await sha256OfStream(streamOf(bytes, sizes), 1_000_000);
      expect(got).toEqual({ sha256: await sha256Hex(bytes), bytes: length });
    }
  });

  it('stops reading once the byte limit is passed', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1000));
      },
    });
    await rejectsWithCode(sha256OfStream(endless, 5_000), 'stream_too_large');
    expect(pulled).toBeLessThan(20);
  });

  it('accepts exactly the limit', async () => {
    const got = await sha256OfStream(streamOf(new Uint8Array(100)), 100);
    expect(got.bytes).toBe(100);
  });

  it('a tap passes bytes through unchanged and reports the digest of what passed', async () => {
    const rand = prng(3);
    const bytes = randomBytes(rand, 9000);
    const tap = createDigestTap(100_000);
    const reader = streamOf(bytes, [700, 1, 3000]).pipeThrough(tap.stream).getReader();
    const out: number[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(...value);
    }
    expect(Uint8Array.from(out)).toEqual(bytes);
    expect(await tap.result()).toEqual({ sha256: await sha256Hex(bytes), bytes: 9000 });
  });

  it('a tap errors the stream when the limit is passed', async () => {
    const tap = createDigestTap(500);
    const reader = streamOf(new Uint8Array(2000), [100]).pipeThrough(tap.stream).getReader();
    await rejectsWithCode(
      (async () => {
        for (;;) if ((await reader.read()).done) return;
      })(),
      'stream_too_large',
    );
  });

  it('prefers a native DigestStream when the runtime has one', async () => {
    const fed: number[] = [];
    class FakeDigestStream extends WritableStream<Uint8Array> {
      readonly digest: Promise<ArrayBuffer>;
      constructor(_algorithm: 'SHA-256') {
        let resolve!: (b: ArrayBuffer) => void;
        const digest = new Promise<ArrayBuffer>((r) => { resolve = r; });
        super({
          write: (chunk) => { fed.push(chunk.length); },
          close: () => { resolve(new Uint8Array(32).fill(0xab).buffer); },
        });
        this.digest = digest;
      }
    }
    const hasher = createSha256Hasher(FakeDigestStream as unknown as DigestStreamCtor);
    await hasher.update(new Uint8Array(5));
    await hasher.update(new Uint8Array(7));
    expect(await hasher.digestHex()).toBe('ab'.repeat(32));
    expect(fed).toEqual([5, 7]);
  });

  it('rejects a bad byte limit', async () => {
    await rejectsWithCode(sha256OfStream(streamOf(new Uint8Array(1)), -1), 'limit_invalid');
  });
});

describe('digest tap completeness and hasher lifecycle', () => {
  const enc = new TextEncoder();
  const failingAfter = (first: string): ReadableStream<Uint8Array> => {
    let sent = false;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) { sent = true; controller.enqueue(enc.encode(first)); } else controller.error(new Error('source failed'));
      },
    });
  };
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const reader = stream.getReader();
    for (;;) if ((await reader.read()).done) return;
  };

  it('result() throws when the source errored after "hello " (no digest of a prefix)', async () => {
    const tap = createDigestTap(1000);
    await expect(drain(failingAfter('hello ').pipeThrough(tap.stream))).rejects.toThrow('source failed');
    await rejectsWithCode(tap.result(), 'stream_incomplete');
  });

  it('result() throws when the consumer cancelled after the first chunk', async () => {
    const tap = createDigestTap(1000);
    const reader = streamOf(enc.encode('hello world'), [6]).pipeThrough(tap.stream).getReader();
    await reader.read();
    await reader.cancel();
    await rejectsWithCode(tap.result(), 'stream_incomplete');
  });

  it('result() throws before the stream has ended, and is stable once it has', async () => {
    const tap = createDigestTap(1000);
    const reader = streamOf(enc.encode('hello world'), [6, 5]).pipeThrough(tap.stream).getReader();
    await reader.read();
    await rejectsWithCode(tap.result(), 'stream_incomplete');
    while (!(await reader.read()).done) { /* drain */ }
    const first = await tap.result();
    expect(first).toEqual({ sha256: await sha256Hex(enc.encode('hello world')), bytes: 11 });
    expect(await tap.result()).toEqual(first);
  });

  it('a tap refuses chunks that are not byte arrays', async () => {
    for (const bad of ['text', new ArrayBuffer(4)]) {
      const tap = createDigestTap(1000);
      const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bad as unknown as Uint8Array); c.close(); } });
      await rejectsWithCode(drain(source.pipeThrough(tap.stream)), 'stream_chunk_invalid');
      await rejectsWithCode(tap.result(), 'stream_incomplete');
    }
  });

  it('sha256OfStream refuses string and ArrayBuffer chunks instead of treating NaN as under the limit', async () => {
    for (const bad of ['text', new ArrayBuffer(4)]) {
      const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bad as unknown as Uint8Array); c.close(); } });
      await rejectsWithCode(sha256OfStream(source, 1), 'stream_chunk_invalid');
    }
  });

  function fakeDigestStream(log: string[]): DigestStreamCtor {
    return class extends WritableStream<Uint8Array> {
      readonly digest: Promise<ArrayBuffer>;
      constructor(_algorithm: 'SHA-256') {
        let resolve!: (b: ArrayBuffer) => void;
        let reject!: (e: Error) => void;
        const digest = new Promise<ArrayBuffer>((res, rej) => { resolve = res; reject = rej; });
        super({
          write: () => { log.push('write'); },
          close: () => { log.push('close'); resolve(new Uint8Array(32).fill(1).buffer); },
          abort: (reason) => { log.push('abort'); reject(reason as Error); },
        });
        this.digest = digest;
      }
    } as unknown as DigestStreamCtor;
  }

  it.each([['pure JS', null], ['native', 'native']] as const)('%s hasher: digestHex is idempotent and update after it throws hasher_finished', async (_name, mode) => {
    const log: string[] = [];
    const hasher = createSha256Hasher(mode === 'native' ? fakeDigestStream(log) : null);
    await hasher.update(enc.encode('abc'));
    const [a, b] = [await hasher.digestHex(), await hasher.digestHex()];
    expect(b).toBe(a);
    await rejectsWithCode(hasher.update(enc.encode('more')), 'hasher_finished');
    expect(await hasher.digestHex()).toBe(a);
    if (mode === null) expect(a).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    else expect(log.filter((x) => x === 'close')).toHaveLength(1);
  });

  it.each([['pure JS', null], ['native', 'native']] as const)('%s hasher: after abort nothing can be digested or fed', async (_name, mode) => {
    const hasher = createSha256Hasher(mode === 'native' ? fakeDigestStream([]) : null);
    await hasher.update(enc.encode('abc'));
    await hasher.abort();
    await rejectsWithCode(hasher.digestHex(), 'hasher_finished');
    await rejectsWithCode(hasher.update(enc.encode('x')), 'hasher_finished');
  });

  it('sha256OfStream aborts the hasher when the stream fails and leaves no unhandled rejection', async () => {
    const log: string[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const hasher = createSha256Hasher(fakeDigestStream(log));
      await expect(sha256OfStream(failingAfter('hello '), 100, hasher)).rejects.toThrow('source failed');
      await new Promise((r) => setTimeout(r, 20));
      expect(log).toContain('abort');
      expect(log).not.toContain('close');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('parseChecksums limits and name set', () => {
  it('lists exactly the names a manifest may list: manifest.json and checksums.sha256 are not covered', () => {
    expect(() => parseChecksums(`${H1}  manifest.json\n`)).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
    expect(() => parseChecksums(`${H1}  checksums.sha256\n`)).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
    expect(() => generateChecksums([{ path: 'manifest.json', sha256: H1 }])).toThrowError(expect.objectContaining({ code: 'entry_name_invalid' }));
    expect(parseChecksums(`${H1}  README.txt\n`)).toEqual([{ path: 'README.txt', sha256: H1 }]);
  });

  it('refuses an entry that is a directory prefix of another', () => {
    expect(() => parseChecksums(`${H1}  media/index.ndjson\n${H2}  media/index.ndjson/x\n`)).toThrowError(expect.objectContaining({ code: 'entry_name_duplicate' }));
  });

  it('refuses a line longer than the cap and a file larger than the cap, before parsing lines', () => {
    expect(() => parseChecksums(`${H1}  data/${'a'.repeat(600)}.ndjson\n`)).toThrowError(expect.objectContaining({ code: 'checksums_invalid', message: 'line too long' }));
    expect(() => parseChecksums(`${'x'.repeat(MAX_CHECKSUMS_BYTES)}\n`)).toThrowError(expect.objectContaining({ code: 'checksums_invalid', message: 'file too large' }));
  });

  it('refuses more entries than the cap but accepts exactly the cap', () => {
    const line = (i: number): string => `${H1}  media/t/${String(i).padStart(6, '0')}.jpg\n`;
    const many = (n: number): string => Array.from({ length: n }, (_, i) => line(i)).join('');
    expect(parseChecksums(many(MAX_CHECKSUM_ENTRIES))).toHaveLength(MAX_CHECKSUM_ENTRIES);
    expect(() => parseChecksums(many(MAX_CHECKSUM_ENTRIES + 1))).toThrowError(expect.objectContaining({ code: 'checksums_invalid', message: 'too many entries' }));
  }, 60_000);
});

describe('checksums size caps derive from the manifest limits, and an empty list is refused both ways', () => {
  const line = (i: number): string => `${H1}  media/t/${String(i).padStart(6, '0')}.jpg\n`;

  it('the entry cap is the manifest file cap plus two', () => {
    expect(MAX_CHECKSUM_ENTRIES).toBe(50_002);
  });

  it('generateChecksums refuses an empty list, as parseChecksums refuses an empty file (round trip, with a positive control)', () => {
    expect(() => generateChecksums([])).toThrowError(expect.objectContaining({ code: 'checksums_invalid' }));
    expect(() => parseChecksums('')).toThrowError(expect.objectContaining({ code: 'checksums_invalid' }));
    const one = [{ path: 'README.txt', sha256: H1 }];
    expect(parseChecksums(generateChecksums(one))).toEqual(one);
  });

  it('accepts bytes and checks their size before decoding', () => {
    const text = line(1);
    expect(parseChecksums(new TextEncoder().encode(text))).toEqual(parseChecksums(text));
    expect(() => parseChecksums(new Uint8Array(MAX_CHECKSUMS_BYTES + 1))).toThrowError(expect.objectContaining({ code: 'checksums_invalid', message: 'file too large' }));
    expect(() => parseChecksums(Uint8Array.from([0x30, 0xff, 0x0a]))).toThrowError(expect.objectContaining({ code: 'checksums_invalid', message: 'not valid UTF-8' }));
  });

  it('the byte cap is in bytes, not characters (a string of 3-byte characters over the cap is refused)', () => {
    const wide = String.fromCharCode(0x20ac).repeat(Math.ceil(MAX_CHECKSUMS_BYTES / 3) + 1);
    expect(wide.length).toBeLessThan(MAX_CHECKSUMS_BYTES);
    expect(() => parseChecksums(wide)).toThrowError(expect.objectContaining({ code: 'checksums_invalid', message: 'file too large' }));
  });

  it('generateChecksums refuses output over the byte cap', () => {
    const longName = `media/${'a'.repeat(250)}/${'b'.repeat(240)}.jpg`;
    const entries = Array.from({ length: 25_000 }, (_, i) => ({ path: `${longName.slice(0, -4)}${i}.jpg`, sha256: H1 }));
    expect(() => generateChecksums(entries)).toThrowError(expect.objectContaining({ code: 'checksums_invalid', message: 'file too large' }));
  }, 60_000);
});

describe('digest tap releases a native hasher when the stream is incomplete', () => {
  it('abort() releases a native hasher that never saw a chunk (the path for a runtime that skips the cancel hook)', async () => {
    const log: string[] = [];
    const Fake = class extends WritableStream<Uint8Array> {
      readonly digest: Promise<ArrayBuffer>;
      constructor(_algorithm: 'SHA-256') {
        let reject!: (e: Error) => void;
        const digest = new Promise<ArrayBuffer>((_res, rej) => { reject = rej; });
        super({ abort: (reason) => { log.push('abort'); reject(reason as Error); } });
        this.digest = digest;
      }
    } as unknown as DigestStreamCtor;
    const tap = createDigestTap(1000, createSha256Hasher(Fake));
    expect(log).toEqual([]);
    await tap.abort();
    expect(log).toEqual(['abort']);
    await rejectsWithCode(tap.result(), 'stream_incomplete');
  });

  it('abort() releases a native hasher after a source error, whether or not the runtime called cancel; result() stays refused', async () => {
    const log: string[] = [];
    const Fake = class extends WritableStream<Uint8Array> {
      readonly digest: Promise<ArrayBuffer>;
      constructor(_algorithm: 'SHA-256') {
        let reject!: (e: Error) => void;
        const digest = new Promise<ArrayBuffer>((_res, rej) => { reject = rej; });
        super({ abort: (reason) => { log.push('abort'); reject(reason as Error); } });
        this.digest = digest;
      }
    } as unknown as DigestStreamCtor;
    const tap = createDigestTap(1000, createSha256Hasher(Fake));
    let sent = false;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode('hello ')); } else controller.error(new Error('source failed'));
      },
    });
    const reader = source.pipeThrough(tap.stream).getReader();
    await expect((async () => { for (;;) if ((await reader.read()).done) return; })()).rejects.toThrow('source failed');
    await rejectsWithCode(tap.result(), 'stream_incomplete');
    await tap.abort();
    expect(log).toContain('abort');
  });
});
