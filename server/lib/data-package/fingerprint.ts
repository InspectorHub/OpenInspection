/**
 * Server-side schema fingerprint for the E-1 job handshake.
 *
 * The desktop client records this value at export time and the importer checks
 * it against the target before applying, so a package made against one column
 * set cannot be silently applied to a different one. It is derived from the
 * classification whitelist — the same single source of truth the read endpoint
 * uses — so the fingerprint and the columns actually exported cannot drift.
 * Only tables/columns that travel are included; withheld/reset/out columns and
 * outTables are absent by construction.
 */
import { columnSetFingerprint } from '@core/data-package';
import { TABLE_READ_META } from './read-metadata';

/**
 * Pure: a SHA-256 of the sorted table.column whitelist. Kept stateless (no
 * module-level cache) so importing this module cannot make two unit specs
 * share mutable state — the cost is one short hash per job start, which is
 * negligible next to the D1 reads that follow.
 */
export function schemaFingerprint(): Promise<string> {
    const columnsByTable: Record<string, string[]> = {};
    for (const meta of TABLE_READ_META) columnsByTable[meta.table] = [...meta.columns];
    return columnSetFingerprint(columnsByTable);
}
