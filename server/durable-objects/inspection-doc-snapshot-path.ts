/**
 * Match a `…/snapshots/<seq>` path and parse the trailing `seq` as a
 * non-negative integer. Returns the parsed seq, or `null` when the path is not
 * a snapshot-by-seq request or the trailing segment is not a valid non-negative
 * integer (so the caller falls through to the generic 404). Trailing slashes are
 * ignored. The `/snapshots` (list/capture) path has no trailing segment and
 * therefore never matches here.
 */
export function matchSnapshotBySeqPath(pathname: string): number | null {
    const segments = pathname.replace(/\/+$/, '').split('/');
    const last = segments[segments.length - 1];
    const parent = segments[segments.length - 2];
    if (parent !== 'snapshots') return null;
    // Strict non-negative integer (no signs, decimals, or whitespace).
    if (!/^\d+$/.test(last)) return null;
    const seq = Number(last);
    return Number.isSafeInteger(seq) ? seq : null;
}
