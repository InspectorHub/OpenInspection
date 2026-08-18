/**
 * The thirty-day read-only report share token, and the one thing about it a
 * tenant purge needs: that it can be found.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * The KV key is `agent_view_token:{token}`. The purge deletes three KV keys it
 * can NAME — `tenant:{slug}`, `setup_code:{slug}` and one `pwchanged:{userId}`
 * per user — and there was no way to name these. A destroyed workspace left
 * live credentials to its own reports sitting in KV until each expired on its
 * own, up to thirty days later.
 *
 * ── Why the tenant rides in the TOKEN and not in the KEY ────────────────────
 * The obvious fix is `agent_view_token:{tenantId}:{token}`, and it does not
 * work. `resolveAgentViewToken` is handed a token and nothing else: the public
 * report viewer has no tenant context, and the token IS the credential, so
 * looking the tenant up first would mean trusting something other than the
 * token to find it. A tenant-prefixed key would be unlookupable by the only
 * caller that reads it.
 *
 * So the token is `{tenantIdHex}{random}` — 32 hex characters of tenant id and
 * 32 random. The key is unchanged, resolution is unchanged, the token is the
 * same 64 characters it always was, and `kv.list({ prefix })` can enumerate
 * exactly one tenant's tokens.
 *
 * ── Why no separator, and why no trailing slash ─────────────────────────────
 * A tenant id in hex is fixed-length, so no tenant's prefix can be a prefix of
 * another's and the sweep needs no delimiter to be safe. The R2 sweep next door
 * DOES need a trailing slash, because a tenant id there is followed by a path
 * and `abc123/` must not match `abc1234/`. Same hazard, different shape.
 *
 * ── The residue, stated ─────────────────────────────────────────────────────
 * Tokens minted before this carry nothing that says whose they are, so nothing
 * can sweep them and nothing pretends to. They expire inside their own
 * thirty-day TTL. `tenant-purge-kv.spec.ts` asserts that a legacy token
 * survives a purge, so the limit is a checked fact rather than a hope.
 */

/** The KV key prefix under which one tenant's share tokens live. */
export function agentViewTokenPrefix(tenantId: string): string {
    return `agent_view_token:${tenantId.replace(/-/g, '')}`;
}

/** A new share token, carrying its tenant in the leading 32 characters. */
export function mintAgentViewToken(tenantId: string): string {
    return tenantId.replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}
