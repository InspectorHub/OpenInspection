import { assertPositiveInt, toBytes } from './bytes';
import { DataPackageFormatError } from './errors';
import { assertSafeJson, type JsonObject, type JsonValue } from './safe-json';

/**
 * Newline-delimited JSON for `data/<table>.ndjson`: one JSON object per line, LF terminated, UTF-8,
 * no BOM, compact. The reader is a trust boundary (it will read uploaded files): it buffers at most one
 * line in a single growing buffer, refuses anything that is not exactly what the writer produces, and never
 * holds a table.
 */

/**
 * Longest accepted line, in bytes, newline excluded. Bounds the one line that is ever buffered
 * (a decoded string is two bytes per char and a parsed object several times that). 4 MiB holds the
 * largest legitimate row (a report snapshot or a template schema) with room to spare.
 */
export const MAX_NDJSON_LINE_BYTES = 4 * 1024 * 1024;

/** Default row cap per shard when the caller does not pass one. An importer should pass the manifest's own row count. */
export const DEFAULT_MAX_NDJSON_ROWS = 2_000_000;

const ROW_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_ROW_KEYS = new Set(['constructor', 'prototype']);

const encoder = new TextEncoder();

function checkRowKeys(row: JsonObject, code: 'ndjson_row_unwritable' | 'json_unsafe', where: string): void {
  for (const key of Object.keys(row)) {
    if (!ROW_KEY_RE.test(key) || FORBIDDEN_ROW_KEYS.has(key)) {
      throw new DataPackageFormatError(code, `${where} has a column name outside [a-z][a-z0-9_]{0,63}`);
    }
  }
}

/** Encode one row as `<json>\n`. Throws when the line (without its newline) exceeds `maxLineBytes`. */
export function encodeNdjsonRow(row: JsonObject, maxLineBytes: number = MAX_NDJSON_LINE_BYTES): Uint8Array {
  assertPositiveInt(maxLineBytes, 'maxLineBytes');
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new DataPackageFormatError('ndjson_row_unwritable', 'a row must be an object');
  }
  checkRowKeys(row, 'ndjson_row_unwritable', 'a row');
  assertSafeJson(row); // a row the reader would refuse must fail here, not in someone else's restore
  const body = encoder.encode(JSON.stringify(row));
  if (body.length > maxLineBytes) {
    throw new DataPackageFormatError('ndjson_line_too_long', `row is ${body.length} bytes; the limit is ${maxLineBytes}`);
  }
  const line = new Uint8Array(body.length + 1);
  line.set(body, 0);
  line[body.length] = 0x0a;
  return line;
}

export interface NdjsonWriteStats {
  rows: number;
  bytes: number;
}

/** A TransformStream from rows to bytes; `stats` is updated as rows pass. */
export function createNdjsonEncoder(maxLineBytes: number = MAX_NDJSON_LINE_BYTES): { stream: TransformStream<JsonObject, Uint8Array>; stats: NdjsonWriteStats } {
  assertPositiveInt(maxLineBytes, 'maxLineBytes');
  const stats: NdjsonWriteStats = { rows: 0, bytes: 0 };
  const stream = new TransformStream<JsonObject, Uint8Array>({
    transform(row, controller) {
      const line = encodeNdjsonRow(row, maxLineBytes);
      stats.rows += 1;
      stats.bytes += line.length;
      controller.enqueue(line);
    },
  });
  return { stream, stats };
}

export interface NdjsonReadOptions {
  /** A finite positive integer. Default `MAX_NDJSON_LINE_BYTES`. */
  readonly maxLineBytes?: number;
  /** A finite positive integer: refuse the shard once more rows than this have been read. Default `DEFAULT_MAX_NDJSON_ROWS`. */
  readonly maxRows?: number;
}

export interface NdjsonRow {
  /** 1-based. */
  readonly line: number;
  readonly value: JsonObject;
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function decodeLine(bytes: Uint8Array, lineNo: number): JsonObject {
  if (bytes.length === 0) throw new DataPackageFormatError('ndjson_blank_line', `line ${lineNo} is empty`);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new DataPackageFormatError('ndjson_bom', `line ${lineNo} starts with a byte order mark`);
  }
  if (bytes.includes(0x0d)) throw new DataPackageFormatError('ndjson_crlf', `line ${lineNo} contains a carriage return`);
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new DataPackageFormatError('ndjson_invalid_utf8', `line ${lineNo} is not valid UTF-8`);
  }
  if (text.charCodeAt(0) !== 0x7b || text.charCodeAt(text.length - 1) !== 0x7d) {
    throw new DataPackageFormatError('ndjson_not_object', `line ${lineNo} is not a JSON object`);
  }
  let value: JsonValue;
  try {
    value = JSON.parse(text) as JsonValue;
  } catch {
    throw new DataPackageFormatError('json_invalid', `line ${lineNo} is not valid JSON`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DataPackageFormatError('ndjson_not_object', `line ${lineNo} is not a JSON object`);
  }
  assertSafeJson(value);
  checkRowKeys(value, 'json_unsafe', `line ${lineNo}`);
  // Canonical form: exactly what the writer emits. This rejects a repeated key (the parser keeps the last),
  // `-0`, `1.0000000000000000001`, `1e-999`, padding and escapes the writer would not use, so two different
  // byte strings can never mean the same row.
  if (JSON.stringify(value) !== text) {
    throw new DataPackageFormatError('ndjson_not_canonical', `line ${lineNo} is not in canonical compact form`);
  }
  return value;
}

/**
 * Read rows from a byte stream. Buffers at most one line (`maxLineBytes`) in one growing buffer; the check
 * runs as bytes arrive, so an endless line is refused after `maxLineBytes`, not after it ends, and a line
 * delivered one byte at a time costs the same memory as one delivered whole. Strict: every line must be a
 * non-empty canonical compact object ending in LF, valid UTF-8, without BOM or CR; a stream that ends in
 * the middle of a line is `ndjson_truncated`. An empty stream yields no rows (the caller compares the
 * count to the manifest).
 */
export async function* readNdjson(stream: ReadableStream<Uint8Array>, options: NdjsonReadOptions = {}): AsyncGenerator<NdjsonRow, void, undefined> {
  const maxLineBytes = assertPositiveInt(options.maxLineBytes ?? MAX_NDJSON_LINE_BYTES, 'maxLineBytes');
  const maxRows = assertPositiveInt(options.maxRows ?? DEFAULT_MAX_NDJSON_ROWS, 'maxRows');
  const reader = stream.getReader();
  let buffer = new Uint8Array(0);
  let length = 0;
  let rows = 0;
  const append = (piece: Uint8Array): void => {
    const need = length + piece.length;
    if (need > buffer.length) {
      const grown = new Uint8Array(Math.min(maxLineBytes, Math.max(need, buffer.length * 2, 4096)));
      grown.set(buffer.subarray(0, length), 0);
      buffer = grown;
    }
    buffer.set(piece, length);
    length = need;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = toBytes(value);
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(0x0a, start);
        const end = newline === -1 ? chunk.length : newline;
        if (length + (end - start) > maxLineBytes) {
          throw new DataPackageFormatError('ndjson_line_too_long', `line ${rows + 1} exceeds ${maxLineBytes} bytes`);
        }
        if (newline === -1) {
          append(chunk.subarray(start, end));
          break;
        }
        let lineBytes: Uint8Array;
        if (length === 0) {
          lineBytes = chunk.subarray(start, end); // the whole line is inside this chunk: no copy
        } else {
          append(chunk.subarray(start, end));
          lineBytes = buffer.subarray(0, length);
        }
        const lineNo = rows + 1;
        const row = decodeLine(lineBytes, lineNo);
        length = 0;
        rows += 1;
        if (rows > maxRows) throw new DataPackageFormatError('ndjson_too_many_rows', `more than ${maxRows} rows`);
        yield { line: lineNo, value: row };
        start = newline + 1;
      }
    }
    if (length > 0) throw new DataPackageFormatError('ndjson_truncated', 'the last line has no terminating newline');
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
