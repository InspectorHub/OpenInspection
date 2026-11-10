import { describe, expect, it } from 'vitest';
import { createNdjsonEncoder, DEFAULT_MAX_NDJSON_ROWS, encodeNdjsonRow, MAX_NDJSON_LINE_BYTES, readNdjson } from '../../../server/lib/data-package/ndjson';
import type { JsonObject, JsonValue } from '../../../server/lib/data-package/safe-json';
import { collect, prng, rejectsWithCode, streamOf, text } from './helpers';

const read = (bytes: Uint8Array, chunks?: number[], options?: Parameters<typeof readNdjson>[1]) => collect(readNdjson(streamOf(bytes, chunks), options));

function randomString(rand: () => number, max: number): string {
  // Mixes ASCII, quotes, backslashes, control characters, BMP, astral (emoji), U+2028/2029 and a lone-surrogate-free tail.
  const pool = ['a', 'Z', ' ', '"', '\\', '\n', '\r', '\t', '\u0008', '\u2028', '\u2029', '\u00e9', '\u4e2d', '\u{1f600}', '\u{10ffff}', '\ufeff', '/'];
  let out = '';
  for (let i = 0, n = Math.floor(rand() * max); i < n; i++) out += pool[Math.floor(rand() * pool.length)];
  return out;
}

function randomValue(rand: () => number, depth: number): JsonValue {
  const k = Math.floor(rand() * (depth > 3 ? 5 : 7));
  if (k === 0) return null;
  if (k === 1) return rand() < 0.5;
  if (k === 2) return Math.floor((rand() - 0.5) * 2 ** 40);
  if (k === 3) return (rand() - 0.5) * 1e6;
  if (k === 4) return randomString(rand, 30);
  if (k === 5) return Array.from({ length: Math.floor(rand() * 4) }, () => randomValue(rand, depth + 1));
  const o: JsonObject = {};
  for (let i = 0, n = Math.floor(rand() * 4); i < n; i++) o[`k${i}${randomString(rand, 3).replace(/[^a-z]/g, '')}`] = randomValue(rand, depth + 1);
  return o;
}

function randomRow(rand: () => number): JsonObject {
  const row: JsonObject = {};
  for (let i = 0, n = 1 + Math.floor(rand() * 6); i < n; i++) row[`col_${i}`] = randomValue(rand, 0);
  return row;
}

async function encodeAll(rows: JsonObject[]): Promise<Uint8Array> {
  const parts = rows.map((r) => encodeNdjsonRow(r));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('NDJSON round trip', () => {
  it('returns exactly what was written for generated rows, whatever the chunk boundaries (unicode, controls, quotes)', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = prng(seed);
      const rows = Array.from({ length: 1 + Math.floor(rand() * 30) }, () => randomRow(rand));
      const bytes = await encodeAll(rows);
      const sizes = Array.from({ length: 4 }, () => 1 + Math.floor(rand() * 17));
      const back = await read(bytes, sizes);
      expect(back.map((r) => r.value)).toEqual(rows);
      expect(back.map((r) => r.line)).toEqual(rows.map((_, i) => i + 1));
    }
  });

  it('round-trips a 1 MiB line and a line of exactly the limit, and refuses one byte more', async () => {
    const big: JsonObject = { id: 'x', body: 'y'.repeat(1024 * 1024) };
    const [row] = await read(encodeNdjsonRow(big), [65_536]);
    expect(row?.value).toEqual(big);

    const limit = 1000;
    const overhead = encodeNdjsonRow({ b: '' }).length - 1;
    const exact = encodeNdjsonRow({ b: 'z'.repeat(limit - overhead) }, limit);
    expect(exact.length).toBe(limit + 1);
    expect(() => encodeNdjsonRow({ b: 'z'.repeat(limit - overhead + 1) }, limit)).toThrowError(expect.objectContaining({ code: 'ndjson_line_too_long' }));
    expect(await read(exact, [50], { maxLineBytes: limit })).toHaveLength(1);
    await rejectsWithCode(read(encodeNdjsonRow({ b: 'z'.repeat(limit - overhead + 1) }), [50], { maxLineBytes: limit }), 'ndjson_line_too_long');
  });

  it('writes U+2028 and U+2029 raw and does not split on them', async () => {
    const row = { s: 'a\u2028b\u2029c' };
    const bytes = encodeNdjsonRow(row);
    expect((await read(bytes, [1])).map((r) => r.value)).toEqual([row]);
  });

  it('the stream encoder counts rows and bytes', async () => {
    const { stream, stats } = createNdjsonEncoder();
    const writer = stream.writable.getWriter();
    const out = collect(stream.readable as unknown as AsyncIterable<Uint8Array>);
    await writer.write({ a: 1 });
    await writer.write({ a: 2 });
    await writer.close();
    const chunks = await out;
    expect(stats).toEqual({ rows: 2, bytes: chunks.reduce((n, c) => n + c.length, 0) });
    expect(new TextDecoder().decode(chunks[0])).toBe('{"a":1}\n');
  });
});

describe('NDJSON reader refuses malformed input', () => {
  it('stops buffering as soon as a line passes the limit, before it ends', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1000).fill(0x61)); // never a newline
      },
    });
    await rejectsWithCode(collect(readNdjson(endless, { maxLineBytes: 5000 })), 'ndjson_line_too_long');
    expect(pulled).toBeLessThan(20);
  });

  it('refuses an oversize line that arrives in one chunk', async () => {
    await rejectsWithCode(read(text(`{"a":"${'x'.repeat(2000)}"}\n`), undefined, { maxLineBytes: 1000 }), 'ndjson_line_too_long');
  });

  it('refuses a stream that ends inside a line (truncated), even if the partial line parses', async () => {
    await rejectsWithCode(read(text('{"a":1}\n{"a":2}')), 'ndjson_truncated');
    await rejectsWithCode(read(text('{"a":1}\n{"a":')), 'ndjson_truncated');
  });

  it('yields rows that precede the fault, then throws', async () => {
    const seen: number[] = [];
    await rejectsWithCode(
      (async () => { for await (const r of readNdjson(streamOf(text('{"a":1}\n{"a":2}\nnope\n')))) seen.push(r.line); })(),
      'ndjson_not_object',
    );
    expect(seen).toEqual([1, 2]);
  });

  it.each([
    ['blank line', '{"a":1}\n\n{"a":2}\n', 'ndjson_blank_line'],
    ['leading blank line', '\n{"a":1}\n', 'ndjson_blank_line'],
    ['CRLF line ending', '{"a":1}\r\n', 'ndjson_crlf'],
    ['bare CR inside a line', '{"a":\r1}\n', 'ndjson_crlf'],
    ['not an object (array)', '[1]\n', 'ndjson_not_object'],
    ['not an object (number)', '1\n', 'ndjson_not_object'],
    ['padding before the object', ' {"a":1}\n', 'ndjson_not_object'],
    ['padding after the object', '{"a":1} \n', 'ndjson_not_object'],
    ['invalid JSON', '{"a":}\n', 'json_invalid'],
    ['two objects on one line', '{"a":1}{"a":2}\n', 'json_invalid'],
    ['__proto__ column', '{"__proto__":{"x":1}}\n', 'json_unsafe'],
    ['__proto__ nested in a value', '{"a":{"b":[{"__proto__":1}]}}\n', 'json_unsafe'],
    ['constructor column', '{"constructor":1}\n', 'json_unsafe'],
    ['prototype column', '{"prototype":1}\n', 'json_unsafe'],
    ['upper-case column name', '{"A":1}\n', 'json_unsafe'],
    ['column name with a dot', '{"a.b":1}\n', 'json_unsafe'],
    ['number that overflows to Infinity', '{"a":1e999}\n', 'json_unsafe'],
    ['integer beyond 2^53', '{"a":12345678901234567890}\n', 'json_unsafe'],
    ['nesting beyond the depth limit', `{"a":${'['.repeat(100)}${']'.repeat(100)}}\n`, 'json_unsafe'],
  ])('refuses %s', async (_label, input, code) => {
    await rejectsWithCode(read(text(input)), code);
  });

  it('refuses a byte order mark, at the start and on later lines', async () => {
    await rejectsWithCode(read(Uint8Array.from([0xef, 0xbb, 0xbf, ...text('{"a":1}\n')])), 'ndjson_bom');
    await rejectsWithCode(read(Uint8Array.from([...text('{"a":1}\n'), 0xef, 0xbb, 0xbf, ...text('{"a":1}\n')])), 'ndjson_bom');
  });

  it('refuses invalid UTF-8 (lone continuation, overlong, truncated sequence, encoded surrogate)', async () => {
    const wrap = (inner: number[]): Uint8Array => Uint8Array.from([...text('{"a":"'), ...inner, ...text('"}\n')]);
    for (const inner of [[0x80], [0xc0, 0xaf], [0xe4, 0xb8], [0xed, 0xa0, 0x80], [0xff]]) {
      await rejectsWithCode(read(wrap(inner)), 'ndjson_invalid_utf8');
    }
  });

  it('refuses more rows than the cap', async () => {
    await rejectsWithCode(read(text('{"a":1}\n{"a":2}\n{"a":3}\n'), [3], { maxRows: 2 }), 'ndjson_too_many_rows');
    expect(await read(text('{"a":1}\n{"a":2}\n'), [3], { maxRows: 2 })).toHaveLength(2);
  });

  it('an empty stream has no rows', async () => {
    expect(await read(new Uint8Array(0))).toEqual([]);
  });

  it('keeps a legitimate string value that merely contains the word __proto__', async () => {
    const [row] = await read(text('{"note":"the __proto__ key is special"}\n'));
    expect(row?.value).toEqual({ note: 'the __proto__ key is special' });
  });
});

describe('NDJSON writer refuses what the reader would refuse', () => {
  it('rejects non-finite numbers, __proto__ keys, bad column names and non-objects', () => {
    expect(() => encodeNdjsonRow({ a: Number.NaN })).toThrowError(expect.objectContaining({ code: 'json_unsafe' }));
    expect(() => encodeNdjsonRow({ a: Number.POSITIVE_INFINITY })).toThrowError(expect.objectContaining({ code: 'json_unsafe' }));
    expect(() => encodeNdjsonRow(JSON.parse('{"__proto__":1}') as JsonObject)).toThrowError(expect.objectContaining({ code: 'ndjson_row_unwritable' }));
    expect(() => encodeNdjsonRow({ A: 1 })).toThrowError(expect.objectContaining({ code: 'ndjson_row_unwritable' }));
    expect(() => encodeNdjsonRow({ a: JSON.parse('{"__proto__":1}') as JsonValue })).toThrowError(expect.objectContaining({ code: 'json_unsafe' }));
    expect(() => encodeNdjsonRow([] as unknown as JsonObject)).toThrowError(expect.objectContaining({ code: 'ndjson_row_unwritable' }));
  });

  it('the default limit is the documented one', () => {
    expect(MAX_NDJSON_LINE_BYTES).toBe(4 * 1024 * 1024);
    expect(() => encodeNdjsonRow({ b: 'z'.repeat(MAX_NDJSON_LINE_BYTES) })).toThrowError(expect.objectContaining({ code: 'ndjson_line_too_long' }));
  });
});

const BS = String.fromCharCode(92);
const esc = (hex: string): string => `${BS}u${hex}`;

describe('NDJSON canonical form, unpaired surrogates, NUL, limits and chunk types', () => {
  it.each([
    ['unpaired high surrogate escape in a value', `{"a":"${esc('d800')}"}\n`],
    ['unpaired low surrogate escape in a value', `{"a":"x${esc('dc00')}"}\n`],
    ['reversed surrogate pair', `{"a":"${esc('dc00')}${esc('d800')}"}\n`],
    ['NUL escape in a value', `{"a":"${esc('0000')}x"}\n`],
    ['NUL escape in a nested key', `{"a":{"k${esc('0000')}":1}}\n`],
    ['unpaired surrogate in a nested key', `{"a":{"${esc('d800')}":1}}\n`],
  ])('refuses %s', async (_label, input) => {
    await rejectsWithCode(read(text(input)), 'json_unsafe');
  });

  it('accepts a valid surrogate pair written as raw UTF-8 and keeps it', async () => {
    const row = { a: String.fromCodePoint(0x1f600) };
    expect((await read(encodeNdjsonRow(row))).map((r) => r.value)).toEqual([row]);
  });

  it('the writer refuses unpaired surrogates and NUL symmetrically', () => {
    expect(() => encodeNdjsonRow({ a: String.fromCharCode(0xd800) })).toThrowError(expect.objectContaining({ code: 'json_unsafe' }));
    expect(() => encodeNdjsonRow({ a: `x${String.fromCharCode(0)}` })).toThrowError(expect.objectContaining({ code: 'json_unsafe' }));
    expect(() => encodeNdjsonRow({ a: { [String.fromCharCode(0)]: 1 } })).toThrowError(expect.objectContaining({ code: 'json_unsafe' }));
  });

  it.each([
    ['a repeated key (the parser keeps the last)', '{"a":1,"a":2}\n'],
    ['negative zero', '{"a":-0}\n'],
    ['a number with too many digits', '{"a":1.0000000000000000001}\n'],
    ['a number that underflows to zero', '{"a":1e-999}\n'],
    ['a trailing-zero fraction', '{"a":1.0}\n'],
    ['an exponent form of an integer', '{"a":1e2}\n'],
    ['whitespace after a colon', '{"a": 1}\n'],
    ['whitespace after a comma', '{"a":1, "b":2}\n'],
    ['an escaped letter', `{"a":"${esc('0061')}"}\n`],
    ['an escaped slash', `{"a":"${BS}/"}\n`],
  ])('refuses non-canonical %s', async (_label, input) => {
    await rejectsWithCode(read(text(input)), 'ndjson_not_canonical');
  });

  it('nesting of exactly 64 containers is accepted and 65 is refused', async () => {
    const nested = (levels: number): string => `{"a":${'['.repeat(levels - 1)}${']'.repeat(levels - 1)}}\n`; // the row object is level 1
    expect(await read(text(nested(64)))).toHaveLength(1);
    await rejectsWithCode(read(text(nested(65))), 'json_unsafe');
  });

  it('a 1 MiB line delivered one byte at a time round-trips', async () => {
    const row = { id: 'x', body: 'y'.repeat(1024 * 1024 - 20) };
    const [back] = await read(encodeNdjsonRow(row), [1]);
    expect(back?.value).toEqual(row);
  }, 120_000);

  it('rows keep their order and content across lines delivered in tiny chunks', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ n: i, s: `row ${i} ${'z'.repeat(i * 7)}` }));
    const back = await read(await encodeAll(rows), [1, 2, 3]);
    expect(back.map((r) => r.value)).toEqual(rows);
  });

  it('validates its limits: NaN, zero, negative, fractional and infinite are refused', async () => {
    const one = text('{"a":1}\n');
    for (const bad of [Number.NaN, 0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      await rejectsWithCode(read(one, undefined, { maxLineBytes: bad }), 'limit_invalid');
      await rejectsWithCode(read(one, undefined, { maxRows: bad }), 'limit_invalid');
      expect(() => encodeNdjsonRow({ a: 1 }, bad)).toThrowError(expect.objectContaining({ code: 'limit_invalid' }));
    }
    expect(DEFAULT_MAX_NDJSON_ROWS).toBe(2_000_000);
  });

  it('refuses chunks that are not byte arrays instead of letting NaN switch a limit off', async () => {
    const strings = new ReadableStream<Uint8Array>({ start(c) { c.enqueue('{"a":1}\n' as unknown as Uint8Array); c.close(); } });
    await rejectsWithCode(collect(readNdjson(strings)), 'stream_chunk_invalid');
    const buffer = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new ArrayBuffer(8) as unknown as Uint8Array); c.close(); } });
    await rejectsWithCode(collect(readNdjson(buffer)), 'stream_chunk_invalid');
  });

  it('accepts typed-array views other than Uint8Array (a DataView or Uint16Array over the same bytes)', async () => {
    const bytes = text('{"a":1}\n');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(view as unknown as Uint8Array); c.close(); } });
    expect((await collect(readNdjson(stream))).map((r) => r.value)).toEqual([{ a: 1 }]);
  });
});

describe('NDJSON diversified hostile lines (generated)', () => {
  type Case = { bytes: Uint8Array; codes: string[] };
  const wrap = (rand: () => number, inner: string): string => {
    const depth = Math.floor(rand() * 5);
    let out = inner;
    for (let i = 0; i < depth; i++) out = rand() < 0.5 ? `[${out}]` : `{"k${i}":${out}}`;
    return out;
  };
  const line = (s: string): Case['bytes'] => text(`${s}\n`);
  const digits = (rand: () => number, n: number): string => Array.from({ length: n }, () => String(1 + Math.floor(rand() * 9))).join('');
  const makers: Array<(rand: () => number) => Case> = [
    (r) => ({ bytes: line(`{"a":${wrap(r, '{"__proto__":{"polluted":1}}')}}`), codes: ['json_unsafe'] }),
    (r) => ({ bytes: line(`{"a":${wrap(r, `"p${esc('d800')}q"`)}}`), codes: ['json_unsafe'] }),
    (r) => ({ bytes: line(`{"a":${wrap(r, `"p${esc('0000')}q"`)}}`), codes: ['json_unsafe'] }),
    (r) => ({ bytes: line(`{"a":${wrap(r, digits(r, 17 + Math.floor(r() * 20)))}}`), codes: ['json_unsafe'] }),
    (r) => ({ bytes: line(`{"a":${wrap(r, `1e${309 + Math.floor(r() * 500)}`)}}`), codes: ['json_unsafe'] }),
    (r) => { const n = 65 + Math.floor(r() * 100); return { bytes: line(`{"a":${'['.repeat(n)}${']'.repeat(n)}}`), codes: ['json_unsafe'] }; },
    (r) => ({ bytes: line(`{"a":${wrap(r, '1')}${' '.repeat(1 + Math.floor(r() * 3))}}`), codes: ['ndjson_not_canonical', 'ndjson_not_object'] }),
    (r) => ({ bytes: line(`{"a":1,"a":${wrap(r, '2')}}`), codes: ['ndjson_not_canonical'] }),
    (r) => ({ bytes: line(`{"a":${wrap(r, ['-0', '1.0', '1e2', '0.10', '1E5'][Math.floor(r() * 5)] as string)}}`), codes: ['ndjson_not_canonical'] }),
    (r) => ({ bytes: text(`{"a":${wrap(r, '1')}}\r\n`), codes: ['ndjson_crlf'] }),
    (r) => ({ bytes: Uint8Array.from([...text('{"a":"'), ...[[0x80], [0xc0, 0xaf], [0xe4, 0xb8], [0xed, 0xa0, 0x80], [0xff]][Math.floor(r() * 5)] as number[], ...text('"}\n')]), codes: ['ndjson_invalid_utf8'] }),
    (r) => ({ bytes: text(`{"a":${wrap(r, '1')}}`), codes: ['ndjson_truncated'] }),
    (r) => ({ bytes: line(`{"${['A', 'a b', 'a.b', '1a', 'constructor', 'prototype', '__proto__'][Math.floor(r() * 7)] as string}":1}`), codes: ['json_unsafe'] }),
    (r) => ({ bytes: Uint8Array.from([0xef, 0xbb, 0xbf, ...text(`{"a":${wrap(r, '1')}}\n`)]), codes: ['ndjson_bom'] }),
  ];

  it('rejects every kind, at random chunk boundaries, with the expected code and no prototype pollution', async () => {
    const before = Object.getOwnPropertyNames(Object.prototype).sort().join(',');
    for (let seed = 1; seed <= 40; seed++) {
      const rand = prng(1000 + seed);
      for (const [index, make] of makers.entries()) {
        const { bytes, codes } = make(rand);
        const sizes = Array.from({ length: 3 }, () => 1 + Math.floor(rand() * 9));
        let got = 'nothing thrown';
        try {
          await read(bytes, sizes);
        } catch (error) {
          got = (error as { code?: string }).code ?? String(error);
        }
        expect(codes, `maker ${index} seed ${seed}: ${got}`).toContain(got);
      }
    }
    expect(Object.getOwnPropertyNames(Object.prototype).sort().join(',')).toBe(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
