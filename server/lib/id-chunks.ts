/**
 * D1 binds at most 100 parameters per statement. A statement that filters by a list of ids also
 * binds the company id (and sometimes more), so such lists are cut well under that.
 */
const ID_CHUNK = 90;

/**
 * Duplicates are dropped first: `IN (...)` matched a repeated id once, and the same id landing in two
 * chunks would otherwise come back as two rows.
 */
export function chunkIds<T>(ids: readonly T[], size = ID_CHUNK): T[][] {
    const unique = [...new Set(ids)];
    const out: T[][] = [];
    for (let off = 0; off < unique.length; off += size) out.push(unique.slice(off, off + size));
    return out;
}
