/**
 * D1 binds at most 100 parameters per statement. A statement that filters by a list of ids also
 * binds the company id (and sometimes more), so such lists are cut well under that.
 */
const ID_CHUNK = 90;

export function chunkIds<T>(ids: readonly T[], size = ID_CHUNK): T[][] {
    const out: T[][] = [];
    for (let off = 0; off < ids.length; off += size) out.push(ids.slice(off, off + size));
    return out;
}
