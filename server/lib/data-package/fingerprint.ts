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

let cached: Promise<string> | null = null;

export function schemaFingerprint(): Promise<string> {
    if (!cached) {
        const columnsByTable: Record<string, string[]> = {};
        for (const meta of TABLE_READ_META) columnsByTable[meta.table] = [...meta.columns];
        cached = columnSetFingerprint(columnsByTable);
    }
    return cached;
}
