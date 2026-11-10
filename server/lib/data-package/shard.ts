import { assertEntryName, entryNameProblem } from './entry-name';
import { DataPackageFormatError } from './errors';

/**
 * Shard naming and cutting for `data/<table>[.<n>].ndjson`. The first shard of a table has no number,
 * later ones are `.2`, `.3`, ... so a single-shard table keeps its plain name.
 *
 * A table with no rows gets no shard from `ShardCutter` (it only ever sees rows). The manifest requires every
 * `counts` key to have a data file, so an exporter MUST write an empty shard for a zero-row table: use
 * `emptyDataFile(table)` for its manifest entry (`rows: 0, bytes: 0`) and write a zero-byte `data/<table>.ndjson`.
 */
const TABLE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const DATA_FILE_RE = /^data\/([a-z][a-z0-9_]{0,63})(?:\.([1-9][0-9]{0,5}))?\.ndjson$/;
const MAX_SHARDS_PER_TABLE = 999_999;

/** A table name is a plain identifier whose data file name is also a safe entry name (so never `con`, `nul`, ...). */
export function isTableName(name: string): boolean {
  return TABLE_RE.test(name) && entryNameProblem(`data/${name}.ndjson`) === null;
}

/** `shard` is 1-based. */
export function dataFileName(table: string, shard: number): string {
  if (!isTableName(table)) throw new DataPackageFormatError('entry_name_invalid', 'table name outside [a-z][a-z0-9_]{0,63}');
  if (!Number.isInteger(shard) || shard < 1 || shard > MAX_SHARDS_PER_TABLE) {
    throw new DataPackageFormatError('entry_name_invalid', 'shard number out of range');
  }
  return assertEntryName(shard === 1 ? `data/${table}.ndjson` : `data/${table}.${shard}.ndjson`);
}

/** The manifest entry fields and file name for a table with zero rows (the file itself is zero bytes). */
export function emptyDataFile(table: string): { path: string; rows: 0; bytes: 0 } {
  return { path: dataFileName(table, 1), rows: 0, bytes: 0 };
}

export interface ParsedDataFile {
  readonly table: string;
  readonly shard: number;
}

/** `null` when the name is not a data shard. A written ".1" is rejected: shard 1 is the unnumbered name. */
export function parseDataFileName(path: string): ParsedDataFile | null {
  const match = DATA_FILE_RE.exec(path);
  if (!match || match[1] === undefined) return null;
  if (match[2] === undefined) return { table: match[1], shard: 1 };
  const shard = Number(match[2]);
  return shard >= 2 ? { table: match[1], shard } : null;
}

export interface ShardLimits {
  readonly maxRows: number;
  readonly maxBytes: number;
}

export interface ShardPlacement {
  readonly shard: number;
  readonly path: string;
  /** True when this row is the first of a new shard (the previous one must be closed). */
  readonly opensShard: boolean;
}

/**
 * Decides which shard the next row goes to, one row at a time with O(1) state. A shard is cut before the
 * row that would exceed either limit; a row larger than `maxBytes` on its own still gets a shard (only the
 * line-length limit in `ndjson.ts` can refuse it).
 */
export class ShardCutter {
  private shard = 0;
  private rows = 0;
  private bytes = 0;

  constructor(private readonly table: string, private readonly limits: ShardLimits) {
    dataFileName(table, 1); // validates the table name, including device names
    if (!Number.isInteger(limits.maxRows) || limits.maxRows < 1 || !Number.isInteger(limits.maxBytes) || limits.maxBytes < 1) {
      throw new DataPackageFormatError('limit_invalid', 'shard limits must be positive integers');
    }
  }

  place(lineBytes: number): ShardPlacement {
    if (!Number.isSafeInteger(lineBytes) || lineBytes < 1) {
      throw new DataPackageFormatError('limit_invalid', 'a row is at least one byte');
    }
    const cut = this.shard === 0 || this.rows >= this.limits.maxRows || this.bytes + lineBytes > this.limits.maxBytes;
    if (cut) {
      this.shard += 1;
      this.rows = 0;
      this.bytes = 0;
    }
    this.rows += 1;
    this.bytes += lineBytes;
    return { shard: this.shard, path: dataFileName(this.table, this.shard), opensShard: cut };
  }
}
