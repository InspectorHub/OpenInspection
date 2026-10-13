/**
 * Shared OAuth grant-revocation helper for the remote MCP server.
 *
 * Grant `props` (userId/tenantId/role — see durable-objects/inspector-mcp.ts
 * McpProps) are baked in ONCE at /oauth/authorize time (app/routes/oauth/
 * authorize.tsx) and never re-validated per MCP call: the OAuthProvider only
 * checks that the grant/access-token KV entries it owns still exist (see
 * `@cloudflare/workers-oauth-provider`'s `unwrapToken` / `revokeGrant`).
 * `identity-bridge.ts#callApiAsUser` mints a fresh internal JWT with
 * `iat = now` on every call, so the `pwchanged:{userId}` session-invalidation
 * marker (written on member removal / self-delete) never trips for MCP
 * traffic. Revoking every grant a user holds is therefore the ONLY way to cut
 * off their outstanding MCP access when they are removed — this is that
 * primitive, reused by both server/services/team.service.ts (removeMember)
 * and server/api/mcp-grants.ts (single-grant self/admin revoke).
 */
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { logger } from '../logger';

/** Revokes every OAuth grant currently held by the given user. */
export async function revokeAllUserGrants(oauth: OAuthHelpers, userId: string): Promise<void> {
    const { items } = await oauth.listUserGrants(userId);
    await Promise.all(items.map((grant) => oauth.revokeGrant(grant.id, userId)));
}

/**
 * Best-effort revocation for paths that write the `pwchanged:{userId}` marker
 * (password change, reset, self-delete). The marker cuts off session JWTs but
 * is never read for OAuth grants, so a native client's refresh token would
 * otherwise outlive the credential change. Skipped when the provider is not
 * mounted; a provider failure is logged, never thrown, so it cannot block the
 * credential change the caller already committed.
 */
export async function revokeUserGrantsBestEffort(
    oauth: OAuthHelpers | undefined,
    userId: string,
    reason: string,
): Promise<void> {
    if (!oauth) return;
    try {
        await revokeAllUserGrants(oauth, userId);
    } catch (err) {
        logger.warn(`Failed to revoke OAuth grants after ${reason}; outstanding grants may stay valid`, {
            userId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
