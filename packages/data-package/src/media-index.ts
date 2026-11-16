import { z } from 'zod';
import { createDigestTap, SHA256_HEX_RE } from './checksums';
import { entryNameProblem } from './entry-name';
import { DataPackageFormatError } from './errors';
import { keyProblem } from './media-key';
import { encodeNdjsonRow, readNdjson } from './ndjson';
import type { JsonObject } from './safe-json';
import { isTableName } from './shard';
import { DATA_PACKAGE_MEDIA_INDEX_ENTRY, parseVolumeName } from './volume';

/**
 * The media index (`media/index.ndjson` in the root volume): one canonical NDJSON row per media object, so a
 * tenant with 150,000 photos costs the manifest a constant few hundred bytes (`manifest.media`) while the
 * per-object hashes stream. Columns are snake_case because the NDJSON row-key rule is (`ndjson.ts`).
 *
 * Rows MUST be strictly ascending by entry name (`compareEntryNames`: case-folded, compared one path segment at
 * a time). That one rule makes duplicate entries, case-folded duplicates and file/directory clashes
 * (`media/a` against `media/a/b`) detectable by comparing each row with the previous one, in O(1) memory: a set
 * of seen names would grow without bound on a hostile index. The exporter sorts before writing (150,000 short
 * strings is tens of MB; sort in memory or merge shards).
 *
 * `key` is only a label for the importer (it restores each object under the target tenant's prefix); two rows
 * with the same `key` and different entries are not detected here (that would need a set); the importer's
 * own idempotency map (one source key, one object) is where that is enforced.
 */
const MAX_INDEX_LINE_BYTES = 64 * 1024;
const MAX_REFERENCES = 64;

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const contentType = z.string().regex(/^[A-Za-z0-9!#$&^_.+-]{1,64}\/[A-Za-z0-9!#$&^_.+-]{1,64}$/);

/** Under `media/`, a valid entry name, and neither the index file nor anything below it (case-folded: the index must stay unique on a case-insensitive disk). */
function isMediaEntry(value: string): boolean {
  const folded = value.toLowerCase();
  return value.startsWith('media/') && folded !== DATA_PACKAGE_MEDIA_INDEX_ENTRY && !folded.startsWith(`${DATA_PACKAGE_MEDIA_INDEX_ENTRY}/`) && entryNameProblem(value) === null;
}

const rowSchema = z.strictObject({
  /** The R2 key relative to the tenant prefix. Not a path on disk. */
  key: z.string().refine((value) => keyProblem(value) === null, 'not a safe object key'),
  /** The entry name inside the media volume (entry-name rules, under `media/`, never the index itself). */
  entry: z.string().refine(isMediaEntry, 'not a safe media entry name'),
  bytes: count,
  sha256: z.string().regex(SHA256_HEX_RE, 'expected 64 lowercase hex characters'),
  volume: z.string().refine((value) => (parseVolumeName(value) ?? 0) >= 1, 'not a media volume name'),
  content_type: contentType,
  referenced_by: z
    .array(z.strictObject({ table: z.string().refine(isTableName, 'not a table name'), id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }))
    .max(MAX_REFERENCES),
});

export type MediaIndexRow = z.infer<typeof rowSchema>;

const MIN_ROW: MediaIndexRow = {
  key: 'a',
  entry: 'media/a',
  bytes: 0,
  sha256: '0'.repeat(64),
  volume: 'media-001.zip',
  content_type: 'a/b',
  referenced_by: [],
};
/** The smallest canonical row, with its newline: the manifest uses it to refuse an index too small for its row count. */
export const MIN_MEDIA_INDEX_ROW_BYTES = encodeNdjsonRow(toJsonObject(MIN_ROW)).byteLength;

/** The same row as a plain JSON object (no cast: each field is copied). */
function toJsonObject(row: MediaIndexRow): JsonObject {
  return {
    key: row.key,
    entry: row.entry,
    bytes: row.bytes,
    sha256: row.sha256,
    volume: row.volume,
    content_type: row.content_type,
    referenced_by: row.referenced_by.map((reference) => ({ table: reference.table, id: reference.id })),
  };
}

function fail(why: string): never {
  throw new DataPackageFormatError('media_index_invalid', why);
}

/** Case-folded, one path segment at a time, a directory before its contents. Negative when `a` sorts before `b`. */
export function compareEntryNames(a: string, b: string): number {
  const x = a.toLowerCase().split('/');
  const y = b.toLowerCase().split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const left = x[i] as string;
    const right = y[i] as string;
    if (left !== right) return left < right ? -1 : 1;
  }
  return x.length - y.length;
}

/** Throws unless `entry` sorts strictly after `previous` and is not inside it as a directory. */
function assertAfter(previous: string | null, entry: string, where: string): void {
  if (previous === null) return;
  if (compareEntryNames(previous, entry) >= 0) fail(`${where}: entries must be strictly ascending (a duplicate or out-of-order entry)`);
  if (entry.toLowerCase().startsWith(`${previous.toLowerCase()}/`)) fail(`${where}: an entry is a directory prefix of the next`);
}

function parseRow(value: JsonObject | MediaIndexRow, where: string): MediaIndexRow {
  const result = rowSchema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    fail(`${where}: ${first && first.code === 'custom' ? first.message : (first?.code ?? 'invalid')}`.slice(0, 80));
  }
  return result.data;
}

/** Writes index rows, enforcing the same row shape and ordering the reader enforces (so an exporter cannot write an unreadable index). */
export class MediaIndexWriter {
  private rowCount = 0;
  private byteCount = 0;
  private previous: string | null = null;

  get rows(): number {
    return this.rowCount;
  }

  get bytes(): number {
    return this.byteCount;
  }

  write(row: MediaIndexRow): Uint8Array {
    const where = `row ${this.rowCount + 1}`;
    const checked = parseRow(row, where);
    assertAfter(this.previous, checked.entry, where);
    const line = encodeNdjsonRow(toJsonObject(checked), MAX_INDEX_LINE_BYTES);
    this.previous = checked.entry;
    this.rowCount += 1;
    this.byteCount += line.byteLength;
    return line;
  }
}

interface ReadMediaIndexOptions {
  /** The manifest's `media.count`: more rows than this are refused as they arrive, fewer at the end. */
  readonly expectedRows: number;
  /** When given, every row's `volume` must be one of these names. */
  readonly volumes?: ReadonlySet<string>;
}

/**
 * Stream the index rows, validating each and the order between them. Never holds more than one line and one
 * previous entry name. Throws `media_index_invalid` (or an NDJSON/limit error) at the first bad row, and when the
 * stream ends with a different number of rows than `expectedRows`.
 */
export async function* readMediaIndex(stream: ReadableStream<Uint8Array>, options: ReadMediaIndexOptions): AsyncGenerator<MediaIndexRow, void, undefined> {
  const { expectedRows, volumes } = options;
  if (!Number.isSafeInteger(expectedRows) || expectedRows < 0) throw new DataPackageFormatError('limit_invalid', 'expectedRows must be a non-negative safe integer');
  let previous: string | null = null;
  let rows = 0;
  // maxRows must be positive; an expected count of 0 allows one row so that the extra row is reported as a count error below.
  for await (const { line, value } of readNdjson(stream, { maxLineBytes: MAX_INDEX_LINE_BYTES, maxRows: Math.max(1, expectedRows) })) {
    const where = `row ${line}`;
    if (rows >= expectedRows) fail(`${where}: more rows than the manifest's media count`);
    const row = parseRow(value, where);
    if (volumes && !volumes.has(row.volume)) fail(`${where}: volume is not listed in the manifest`);
    assertAfter(previous, row.entry, where);
    previous = row.entry;
    rows += 1;
    yield row;
  }
  if (rows !== expectedRows) fail(`the index has ${rows} rows but the manifest counts ${expectedRows}`);
}

interface MediaIndexDeclaration {
  readonly media: { readonly count: number; readonly index: { readonly bytes: number; readonly sha256: string } };
  readonly volumes: ReadonlyArray<{ readonly name: string; readonly entries: number; readonly bytes: number }>;
}

/**
 * Read the whole index once and check it against the manifest: its bytes and SHA-256 (hashed as it streams, with
 * the declared size as the limit), its row count, and that each volume's row count equals its `entries` and the
 * bytes of its objects fit in its `bytes` (volumes are stored uncompressed, see `volume.ts`). Returns the row count. Streams: the same bounds as `readMediaIndex`.
 */
export async function verifyMediaIndex(stream: ReadableStream<Uint8Array>, declared: MediaIndexDeclaration): Promise<number> {
  const tap = createDigestTap(declared.media.index.bytes);
  const perVolume = new Map<string, { entries: number; bytes: number }>(declared.volumes.map((volume) => [volume.name, { entries: 0, bytes: 0 }]));
  let rows = 0;
  try {
    for await (const row of readMediaIndex(stream.pipeThrough(tap.stream), { expectedRows: declared.media.count, volumes: new Set(perVolume.keys()) })) {
      const slot = perVolume.get(row.volume);
      if (slot) {
        slot.entries += 1;
        slot.bytes += row.bytes;
      }
      rows += 1;
    }
  } catch (error) {
    await tap.abort();
    throw error;
  }
  const digest = await tap.result();
  if (digest.bytes !== declared.media.index.bytes) fail('the index is not the size the manifest declares');
  if (digest.sha256 !== declared.media.index.sha256) fail('the index digest differs from the manifest');
  for (const volume of declared.volumes) {
    const slot = perVolume.get(volume.name);
    if (!slot || slot.entries !== volume.entries) fail('a volume holds a different number of objects than the index lists for it');
    if (slot.bytes > volume.bytes) fail('the index lists more bytes in a volume than the volume holds');
  }
  return rows;
}
