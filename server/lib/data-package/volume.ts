import { entryNameProblem, assertEntryName } from './entry-name';
import { DataPackageFormatError } from './errors';
import { parseDataFileName } from './shard';

export * from './entry-name';

/**
 * Volume naming, entry-name validation and volume planning. Shared by the exporter (which names and
 * cuts volumes) and the importer (which refuses hostile names). An entry name is attacker-controlled
 * text on import, so the rules are an allowlist, not a denylist.
 */
export const ROOT_VOLUME_NAME = 'package.zip';

/**
 * The media index: one NDJSON row per media object (`media-index.ts`). It lives in the root volume under a fixed name
 * (never sharded: 150,000 rows is about 50 MB, far below any zip limit) and is described by `manifest.media`, not by
 * `manifest.files`. No media object may take this entry name (`media-key.ts` reserves it).
 */
// Named with a DATA_PACKAGE_ prefix on purpose: `server/lib/native/offline-zip.ts` exports a different MEDIA_INDEX_ENTRY ('media/index.json') for the offline client package.
export const DATA_PACKAGE_MEDIA_INDEX_ENTRY = 'media/index.ndjson';

/** Fixed entry names a package may carry beside `data/`, `media/<key>` and `esign/` shards. */
const FIXED_ENTRIES = new Set([
  'README.txt',
  DATA_PACKAGE_MEDIA_INDEX_ENTRY,
  'esign/events.ndjson',
  'esign/keys.ndjson',
  'esign/README.txt',
]);

export type EntryKind = 'fixed' | 'data' | 'media';

/** Classify a file the manifest may list. Anything else (including manifest.json itself) is not allowed. */
export function classifyPackageEntry(name: string): EntryKind | null {
  if (entryNameProblem(name) !== null) return null;
  if (FIXED_ENTRIES.has(name)) return 'fixed';
  if (parseDataFileName(name) !== null) return 'data';
  if (name.startsWith('media/') && name.length > 'media/'.length) return 'media';
  return null;
}

const MEDIA_VOLUME_RE = /^media-([0-9]{3,5})\.zip$/;

export function mediaVolumeName(index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 99_999) {
    throw new DataPackageFormatError('volume_name_invalid', 'media volume index must be 1..99999');
  }
  return `media-${String(index).padStart(3, '0')}.zip`;
}

/** The index of a media volume name, `0` for the root volume, `null` for anything else. */
export function parseVolumeName(name: string): number | null {
  if (name === ROOT_VOLUME_NAME) return 0;
  const match = MEDIA_VOLUME_RE.exec(name);
  if (!match || match[1] === undefined) return null;
  const index = Number(match[1]);
  return index >= 1 && mediaVolumeName(index) === name ? index : null;
}

// ---------------------------------------------------------------- planning

/**
 * Volumes hold STORED (uncompressed) entries, so a media volume's `bytes` is its real zip size: at least the sum of its
 * objects' bytes plus `zipEntryOverhead` per entry. The exporter must write them that way: the per-volume byte check
 * in `verifyMediaIndex` (volume.bytes >= the bytes the index lists for it) would refuse a compressed volume.
 *
 * Media volumes carry NO `checksums.sha256` (a volume may hold up to 65,000 entries, more than a checksums file may
 * list). Media objects are verified by the `sha256` of their index row, and each media volume as a whole by
 * `volumes[].sha256`. The root volume's `checksums.sha256` lists exactly the files in `manifest.files` plus the media
 * index (`assertRootChecksums` in `manifest.ts`).
 */
/** A stored zip entry costs a local header, a central-directory record, the name twice and a data descriptor. */
export function zipEntryOverhead(nameBytes: number): number {
  return 30 + 46 + 16 + 2 * nameBytes;
}

/**
 * ZIP64 is out of scope for v1. The classic zip format tops out at 65,535 entries and 4 GiB, and a volume must
 * stay below both with a margin. The EXPORTER must therefore split before a volume reaches these limits (media
 * volumes via `VolumePlanner`; the root volume is checked by the manifest) or refuse. The IMPORTER must refuse
 * any archive entry or central directory that needs ZIP64 (a 0xFFFFFFFF size or offset, or a ZIP64 end record).
 */
export const ZIP_MAX_ENTRIES = 65_000;
export const ZIP_MAX_BYTES = 4 * 1024 ** 3 - 64 * 1024 ** 2;

export interface VolumeLimits {
  readonly maxEntries: number;
  /** Payload plus per-entry zip overhead. */
  readonly maxBytes: number;
}

export interface PlannedEntry {
  readonly volume: string;
  readonly volumeIndex: number;
  /** True when this entry opened a new volume (the previous one must be closed). */
  readonly opensVolume: boolean;
  /** True when the entry alone exceeds `maxBytes`: it gets a volume of its own and the caller decides what to do. */
  readonly oversize: boolean;
}

/**
 * Assigns media entries to volumes one at a time with O(1) state, so an exporter can plan while it
 * lists R2 without holding the listing. An entry is never split across volumes and never reordered.
 */
export class VolumePlanner {
  private index = 0;
  private entries = 0;
  private bytes = 0;

  constructor(private readonly limits: VolumeLimits) {
    const { maxEntries, maxBytes } = limits;
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > ZIP_MAX_ENTRIES) {
      throw new DataPackageFormatError('limit_invalid', `maxEntries must be an integer in 1..${ZIP_MAX_ENTRIES}`);
    }
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > ZIP_MAX_BYTES) {
      throw new DataPackageFormatError('limit_invalid', 'maxBytes must be a positive integer below the 4 GiB zip limit');
    }
  }

  add(name: string, payloadBytes: number): PlannedEntry {
    assertEntryName(name);
    if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0) {
      throw new DataPackageFormatError('limit_invalid', 'entry size must be a non-negative safe integer');
    }
    const cost = payloadBytes + zipEntryOverhead(name.length);
    const oversize = cost > this.limits.maxBytes;
    const fits = this.index > 0 && this.entries < this.limits.maxEntries && this.bytes + cost <= this.limits.maxBytes;
    // An oversize entry never fits (cost > maxBytes), so it always opens a volume of its own.
    const opensVolume = !fits;
    if (opensVolume) {
      this.index += 1;
      this.entries = 0;
      this.bytes = 0;
    }
    this.entries += 1;
    // An oversize entry closes its volume: nothing may join it.
    this.bytes = oversize ? this.limits.maxBytes : this.bytes + cost;
    return { volume: mediaVolumeName(this.index), volumeIndex: this.index, opensVolume, oversize };
  }
}
