import { sha256Hex } from './checksums';
import { DataPackageFormatError } from './errors';
import { isTableName } from './shard';

const COLUMN_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * The column-set fingerprint recorded in the manifest: sha256 of the sorted, newline-joined
 * `table.column` lines. Migration names alone cannot say whether two databases have the same shape
 * (the baseline was rebuilt once), so the importer compares this as well.
 *
 * Input is a plain table-to-columns map; callers derive it from the drizzle schema. Order of tables,
 * and of columns within a table, does not matter. A repeated column, an invalid name or an empty
 * schema throws: a fingerprint of nothing would compare equal to every other fingerprint of nothing.
 */
export async function columnSetFingerprint(columnsByTable: Readonly<Record<string, readonly string[]>>): Promise<string> {
  const lines: string[] = [];
  for (const table of Object.keys(columnsByTable)) {
    if (!isTableName(table)) throw new DataPackageFormatError('fingerprint_invalid', 'table name outside [a-z][a-z0-9_]{0,63}');
    const columns = columnsByTable[table] ?? [];
    if (columns.length === 0) throw new DataPackageFormatError('fingerprint_invalid', 'a table has no columns');
    for (const column of columns) {
      if (!COLUMN_RE.test(column)) throw new DataPackageFormatError('fingerprint_invalid', 'column name outside [a-z][a-z0-9_]{0,63}');
      lines.push(`${table}.${column}`);
    }
  }
  if (lines.length === 0) throw new DataPackageFormatError('fingerprint_invalid', 'no columns');
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === lines[i - 1]) throw new DataPackageFormatError('fingerprint_invalid', 'a column is listed twice');
  }
  return sha256Hex(new TextEncoder().encode(lines.join('\n')));
}
