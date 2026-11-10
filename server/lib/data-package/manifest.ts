import { z } from 'zod';
import { MAX_CHECKSUM_ENTRIES, SHA256_HEX_RE } from './checksums';
import { assertNoPrefixCollisions, entryNameFoldKey } from './entry-name';
import { DataPackageFormatError } from './errors';
import { assertSafeJson, type JsonValue } from './safe-json';
import { isTableName, parseDataFileName } from './shard';
import { classifyPackageEntry, parseVolumeName, ROOT_VOLUME_NAME, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES } from './volume';

/**
 * `manifest.json`. This zod schema IS the format contract: the exporter serializes through it, the
 * importer and the offline verifier parse through it. Every object is strict (unknown key = refuse), and
 * the file must be byte-for-byte what `serializeManifest` writes (canonical form).
 *
 * Text fields that come from the source deployment (`excluded[].reason`, `sourceHost`, ids) are attacker
 * text on import: whatever displays them (UI, logs, the verifier) must escape them.
 *
 * Entry names follow the allowlist and case-folded uniqueness rules documented in `entry-name.ts`: an exporter
 * must map or exclude any object key that is non-ASCII, uses characters outside the allowlist, or differs from
 * another key only by case.
 *
 * ZIP64 is out of scope for v1: the root volume must stay under the classic zip limits (checked below), so an
 * exporter must split or refuse before it gets there, and an importer must refuse an archive that needs ZIP64.
 */
export const FORMAT_VERSION = 1;
/**
 * Oldest format this engine still reads. Raise it only together with a documented upgrader. A manifest below it
 * is refused by the schema's `min` (`manifest_invalid`); a dedicated "too old" error code is added with the
 * first upgrader, not before (a code nothing can reach is a code nothing tests).
 */
const MIN_SUPPORTED_FORMAT_VERSION = 1;

/**
 * Largest manifest accepted, in bytes, and most files it may list. Measured on 2026-11-10 with
 * `parseManifest` (UTF-8 decode, JSON.parse, safe-JSON walk, schema, cross-checks and the canonical re-stringify)
 * over valid manifests of 100 volumes and 100 tables, by finding the smallest `node --max-old-space-size`
 * that does not abort:
 *   5,000 files (1.5 MB)   -> 16 MB heap
 *   20,000 files (6.2 MB)  -> 32 MB heap
 *   49,100 files (15.2 MB) -> 64 MB heap
 * A listed media object costs about 312 bytes of manifest. The limits therefore leave roughly 60 MB of a
 * 128 MB isolate for everything else at the largest accepted size. A larger tenant must keep per-object media
 * hashes in `media/index.json` (read as a stream) and list only volumes here.
 */
export const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_FILES = MAX_CHECKSUM_ENTRIES - 2;
const MAX_MANIFEST_VOLUMES = 9_999;
const MAX_MANIFEST_EXCLUDED = 2_000;

const sha256 = z.string().regex(SHA256_HEX_RE, 'expected 64 lowercase hex characters');
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const tableName = z.string().refine(isTableName, 'table name outside [a-z][a-z0-9_]{0,63}');
const columnName = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const entryPath = z.string().refine((value) => classifyPackageEntry(value) !== null, 'not a permitted package entry name');
const volumeName = z.string().refine((value) => parseVolumeName(value) !== null, 'not a volume name');
const idString = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const shortText = z.string().min(1).max(500);

const EXCLUDED_CLASSES = ['withheld_secret', 'out_of_scope', 'unclassified_column', 'external_media', 'mode_bound'] as const;

/** The smallest row the writer can emit: `{}` plus LF. A data file claiming more rows than bytes/3 is lying. */
const MIN_ROW_BYTES = 3;

const fileEntry = z.strictObject({
  path: entryPath,
  volume: volumeName,
  /** Present for `data/` files (required) and `esign/*.ndjson` files; absent otherwise. */
  rows: count.optional(),
  bytes: count,
  sha256,
});

const volumeEntry = z.strictObject({
  name: volumeName,
  bytes: count,
  entries: count.max(ZIP_MAX_ENTRIES),
  sha256,
});

const excludedEntry = z.strictObject({
  class: z.enum(EXCLUDED_CLASSES),
  table: tableName,
  columns: z.array(columnName).max(256).optional(),
  /** Ids of items that could not travel (for example externally hosted videos). */
  ids: z.array(idString).max(5_000).optional(),
  reason: shortText,
});

const manifestSchema = z
  .strictObject({
    formatVersion: z.number().int().min(MIN_SUPPORTED_FORMAT_VERSION).max(FORMAT_VERSION),
    /** Name of the last applied D1 migration at export time. */
    schemaVersion: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
    /** `columnSetFingerprint` of the exported schema. */
    columnFingerprint: sha256,
    engineVersion: z.string().regex(/^[A-Za-z0-9_.+-]{1,64}$/),
    packageId: z.uuid(),
    exportedAt: z.iso.datetime(),
    sourceMode: z.enum(['standalone', 'saas']),
    sourceTenantId: idString,
    sourceHost: z.string().regex(/^[A-Za-z0-9.-]{1,253}$/).nullable(),
    /** Always `null` in format 1: the format defines no encrypted layout, so a reader would take ciphertext for plaintext. Encryption arrives with a new `formatVersion`. */
    encryption: z.null(),
    counts: z.record(z.string().refine(isTableName, 'table name outside [a-z][a-z0-9_]{0,63}'), count),
    files: z.array(fileEntry).max(MAX_MANIFEST_FILES),
    volumes: z.array(volumeEntry).max(MAX_MANIFEST_VOLUMES),
    excluded: z.array(excludedEntry).max(MAX_MANIFEST_EXCLUDED),
  })
  .superRefine((manifest, ctx) => {
    const problem = (message: string): void => {
      ctx.addIssue({ code: 'custom', message });
    };

    // Volumes: unique names, consecutive media indices from 1, the root never listed.
    const volumeStats = new Map<string, { listed: number; bytes: number }>([[ROOT_VOLUME_NAME, { listed: 0, bytes: 0 }]]);
    const indices: number[] = [];
    for (const volume of manifest.volumes) {
      if (volume.name === ROOT_VOLUME_NAME) problem('the root volume is not listed in volumes (its own digest cannot be inside it)');
      else if (volumeStats.has(volume.name)) problem('duplicate volume name');
      else indices.push(parseVolumeName(volume.name) ?? 0);
      volumeStats.set(volume.name, { listed: 0, bytes: 0 });
    }
    indices.sort((a, b) => a - b);
    if (indices.some((index, i) => index !== i + 1)) problem('media volumes are not numbered consecutively from 001');

    // Files.
    const paths: string[] = [];
    const seenPaths = new Set<string>();
    const rowsByTable = new Map<string, number>();
    const shardsByTable = new Map<string, Set<number>>();
    for (const file of manifest.files) {
      paths.push(file.path);
      const key = entryNameFoldKey(file.path);
      if (seenPaths.has(key)) problem('duplicate file path (case-folded)');
      seenPaths.add(key);
      const stats = volumeStats.get(file.volume);
      if (!stats) problem('file refers to a volume that is not listed');
      else {
        stats.listed += 1;
        stats.bytes += file.bytes;
      }
      const kind = classifyPackageEntry(file.path);
      if (kind === 'media' && file.volume === ROOT_VOLUME_NAME) problem('a media object belongs in a media volume');
      if (kind !== 'media' && file.volume !== ROOT_VOLUME_NAME) problem('only media objects travel in media volumes');
      const data = parseDataFileName(file.path);
      const rowFile = data !== null || (kind === 'fixed' && file.path.endsWith('.ndjson'));
      if (file.rows !== undefined && !rowFile) problem('only data and esign ndjson files carry a row count');
      if (data && file.rows === undefined) problem('a data file must state its row count');
      if (file.rows !== undefined && rowFile) {
        if (file.rows === 0 && file.bytes !== 0) problem('a file with no rows has no bytes');
        if (file.bytes < file.rows * MIN_ROW_BYTES) problem('a file is too small for its row count');
      }
      if (data) {
        rowsByTable.set(data.table, (rowsByTable.get(data.table) ?? 0) + (file.rows ?? 0));
        const shards = shardsByTable.get(data.table) ?? new Set<number>();
        shards.add(data.shard);
        shardsByTable.set(data.table, shards);
      }
    }
    try {
      assertNoPrefixCollisions(paths);
    } catch {
      problem('a file path is a directory prefix of another');
    }

    // Counts agree with the shards.
    for (const [table, shards] of shardsByTable) {
      for (let n = 1; n <= shards.size; n++) if (!shards.has(n)) problem(`data shards of ${table} are not consecutive from 1`);
      if (manifest.counts[table] !== rowsByTable.get(table)) problem(`counts.${table} does not equal the sum of its shard row counts`);
    }
    for (const table of Object.keys(manifest.counts)) {
      if (!shardsByTable.has(table)) problem(`counts.${table} has no data file`);
    }

    // Volumes agree with the files they hold. A volume whose files are listed here must state exactly that
    // many entries; a volume listing none (media hashes kept in media/index.json instead) must hold at least one.
    for (const volume of manifest.volumes) {
      const stats = volumeStats.get(volume.name);
      if (!stats || volume.name === ROOT_VOLUME_NAME) continue;
      if (stats.listed > 0 && volume.entries !== stats.listed) problem('a volume entry count differs from the files listed in it');
      if (volume.entries < 1) problem('a media volume holds no entries');
      if (volume.bytes < stats.bytes) problem('a volume is smaller than the files listed in it');
    }

    // The root volume must stay within classic zip limits (manifest.json and checksums.sha256 are two more entries).
    const root = volumeStats.get(ROOT_VOLUME_NAME);
    if (root && (root.listed + 2 > ZIP_MAX_ENTRIES || root.bytes > ZIP_MAX_BYTES)) problem('the root volume would need ZIP64');
  });

export type Manifest = z.infer<typeof manifestSchema>;

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

const TOP_LEVEL_FIELDS = new Set(['formatVersion', 'schemaVersion', 'columnFingerprint', 'engineVersion', 'packageId', 'exportedAt', 'sourceMode', 'sourceTenantId', 'sourceHost', 'encryption', 'counts', 'files', 'volumes', 'excluded']);

/**
 * Our own refinement messages are constants; any other zod message can echo the input (an unknown key), so
 * only its code is shown. The path is reduced to the top-level field name when it is one of ours, plus its
 * depth: keys below that (`counts` keys, file paths) are attacker text and are never printed.
 */
function describeIssue(issue: { code: string; path: PropertyKey[]; message: string }): string {
  const top = typeof issue.path[0] === 'string' && TOP_LEVEL_FIELDS.has(issue.path[0]) ? issue.path[0] : '?';
  const where = issue.path.length === 0 ? '(root)' : `${top}[depth ${issue.path.length}]`;
  const what = issue.code === 'custom' ? issue.message : issue.code;
  return `${where}: ${what}`.slice(0, 80);
}

/** Parse and validate manifest bytes (or text). Throws `DataPackageFormatError`; the result is fully typed. */
export function parseManifest(input: Uint8Array | string): Manifest {
  // Size by bytes, not characters (a string of 3-byte characters is 3x its length).
  const size = typeof input === 'string' ? (input.length * 3 > MAX_MANIFEST_BYTES ? encoder.encode(input).byteLength : input.length) : input.byteLength;
  if (size > MAX_MANIFEST_BYTES) throw new DataPackageFormatError('manifest_too_large', 'manifest exceeds the size limit');
  let text: string;
  try {
    text = typeof input === 'string' ? input : utf8.decode(input);
  } catch {
    throw new DataPackageFormatError('manifest_invalid', 'manifest is not valid UTF-8');
  }
  if (text.charCodeAt(0) === 0xfeff) throw new DataPackageFormatError('manifest_invalid', 'manifest starts with a byte order mark');
  let raw: JsonValue;
  try {
    raw = JSON.parse(text) as JsonValue;
  } catch {
    throw new DataPackageFormatError('manifest_invalid', 'manifest is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DataPackageFormatError('manifest_invalid', 'manifest is not a JSON object');
  }
  // Version first, so a newer package gets the honest answer instead of a safe-JSON or schema error.
  const version = raw['formatVersion'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new DataPackageFormatError('manifest_invalid', 'formatVersion is missing or not a positive integer');
  }
  if (version > FORMAT_VERSION) {
    throw new DataPackageFormatError('format_version_newer', `package format ${version} is newer than this engine reads (${FORMAT_VERSION}); upgrade first`);
  }
  assertSafeJson(raw);
  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    throw new DataPackageFormatError('manifest_invalid', result.error.issues.slice(0, 5).map(describeIssue).join('; '));
  }
  if (`${JSON.stringify(result.data, null, 2)}\n` !== text) {
    throw new DataPackageFormatError('manifest_not_canonical', 'manifest is not in canonical form (as written by serializeManifest)');
  }
  return result.data;
}

/** Validate then serialize: the exporter cannot write a manifest the importer would refuse. */
export function serializeManifest(manifest: Manifest): Uint8Array {
  const checked = manifestSchema.parse(manifest);
  return encoder.encode(`${JSON.stringify(checked, null, 2)}\n`);
}
