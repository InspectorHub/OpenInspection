/**
 * The purge verb, shared by the two Durable Objects that hold storage.
 *
 * A suffix match anchored at the end, because `/purged` and `/purge/all` are
 * not this verb and a loose match on a destructive endpoint is the wrong kind
 * of forgiving. Both classes already route by path suffix and neither exposes
 * RPC, so a new verb looks like the verbs beside it.
 *
 * Only two of the four Durable Objects get this. `InspectionPresenceDO` makes
 * no storage call — its roster lives in WebSocket hibernation attachments,
 * which the runtime discards with the socket — and `InspectorMcp` persists
 * through a vendor base class whose storage shape is not ours to empty. Both
 * are recorded as such in `compliance/processing-stores.jsonc` rather than
 * given a verb that would claim more than it does.
 */
export function purgePathMatches(pathname: string): boolean {
    return /\/purge$/.test(pathname);
}

/** Header a caller sets to say which tenant it believes owns the object it is purging. Optional: the cascade deletes by name. */
export const PURGE_TENANT_HEADER = 'x-expected-tenant';

/**
 * Header a caller sets to ask that the purge be refused while the object is live (open sockets, or a save waiting). Absent, the
 * purge is unconditional: a workspace purge deliberately destroys objects whose editors are still connected.
 */
export const PURGE_IF_IDLE_HEADER = 'x-purge-if-idle';

/**
 * Headers carrying the SHA-256 (hex) of the stored document, and of the stored restore points, that the caller read just before
 * asking for the purge. The object deletes only if both still have those digests (compare-and-delete); otherwise it answers 409
 * `changed`. Opt-in like the idle header.
 */
export const PURGE_IF_YDOC_HEADER = 'x-purge-if-ydoc';
export const PURGE_IF_SNAPSHOTS_HEADER = 'x-purge-if-snapshots';

/** SHA-256 of a stored document, as lowercase hex: what `PURGE_IF_YDOC_HEADER` carries. */
export async function purgeDigest(bytes: Uint8Array): Promise<string> {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON with object keys sorted, so the caller's copy (after a JSON round trip) and the stored value serialise alike. */
function canonicalJson(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
    if (typeof v === 'object' && v !== null) {
        return `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;
    }
    return JSON.stringify(v) ?? 'null';
}

/** The restore points as stored: anything that is not an array counts as none. */
const snapshotText = (snapshots: unknown): string => canonicalJson(Array.isArray(snapshots) ? snapshots : []);

/** SHA-256 of the restore points: what `PURGE_IF_SNAPSHOTS_HEADER` carries. */
export const purgeSnapshotsDigest = (snapshots: unknown): Promise<string> => purgeDigest(new TextEncoder().encode(snapshotText(snapshots)));

const HEX_DIGEST = /^[0-9a-f]{64}$/;

/**
 * The opt-in preconditions of a purge, judged by the object. A precondition header that is present but malformed is refused
 * (`bad-precondition`), never read as "no precondition". `changed` when the caller named a digest and the stored document or
 * restore points no longer have it, `live` when the caller asked for idle-only and the object is live. Null when the purge may go
 * ahead (also when the caller asked for nothing).
 *
 * Ordering: the digest is awaited, so the stored values are read AGAIN afterwards and compared with the first read without
 * awaiting; the last asynchronous step before the liveness test (and the delete) is therefore a storage read.
 */
export async function purgePrecondition(
    req: Request, isLive: () => boolean, read: () => Promise<{ ydoc: unknown; snapshots: unknown }>,
): Promise<'live' | 'changed' | 'bad-precondition' | null> {
    const idle = req.headers.get(PURGE_IF_IDLE_HEADER);
    const wantYdoc = req.headers.get(PURGE_IF_YDOC_HEADER);
    const wantSnaps = req.headers.get(PURGE_IF_SNAPSHOTS_HEADER);
    if ((idle !== null && idle !== '1') || (wantYdoc !== null && !HEX_DIGEST.test(wantYdoc)) || (wantSnaps !== null && !HEX_DIGEST.test(wantSnaps))) return 'bad-precondition';
    if (wantYdoc !== null || wantSnaps !== null) {
        const first = await read();
        if (wantYdoc !== null && (!(first.ydoc instanceof Uint8Array) || await purgeDigest(first.ydoc) !== wantYdoc)) return 'changed';
        if (wantSnaps !== null && await purgeSnapshotsDigest(first.snapshots) !== wantSnaps) return 'changed';
        const again = await read();
        const same = (first.ydoc instanceof Uint8Array ? again.ydoc instanceof Uint8Array && first.ydoc.length === again.ydoc.length && first.ydoc.every((x, n) => x === (again.ydoc as Uint8Array)[n]) : first.ydoc === again.ydoc)
            && snapshotText(first.snapshots) === snapshotText(again.snapshots);
        if (!same) return 'changed';
    }
    return idle === '1' && isLive() ? 'live' : null;
}

/**
 * Whether a purge that names an expected tenant may proceed. The object's own stored identity is the authority, because a
 * Cloudflare object id cannot be turned back into the name it came from. An object that stores another tenant's identity is
 * refused; an object that holds a document but never stored an identity cannot be attributed to anyone, so it is refused too;
 * an object that holds nothing at all has nothing to protect and may be purged.
 */
export function purgeAllowed(expectedTenant: string | null, storedTenant: string | null, holdsData: boolean): 'ok' | 'wrong-tenant' | 'unattributed' {
    if (expectedTenant === null) return 'ok';
    if (storedTenant !== null) return storedTenant === expectedTenant ? 'ok' : 'wrong-tenant';
    return holdsData ? 'unattributed' : 'ok';
}
