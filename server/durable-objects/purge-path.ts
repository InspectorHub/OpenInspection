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
