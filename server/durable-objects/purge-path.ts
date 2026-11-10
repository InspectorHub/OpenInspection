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
