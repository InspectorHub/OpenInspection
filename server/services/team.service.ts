import { drizzle } from 'drizzle-orm/d1';
import { users, tenantInvites, tenants } from '../lib/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { UserRole } from '../types/auth';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import type { UserSyncOutbox } from '../lib/integration/user-sync';
import { getCapabilities, TOGGLEABLE, type Capability, type PermissionOverrides } from '../lib/auth/capabilities';
import { revokeAllUserGrants } from '../lib/mcp/grants';

/**
 * Loose shape accepted from the validated invite body. Zod under
 * `exactOptionalPropertyTypes` infers `boolean | undefined` per key, which is
 * not assignable to the strict `PermissionOverrides`; `diffOverrides` reads each
 * value through a `typeof === 'boolean'` guard so the looseness is safe.
 */
type RequestedOverrides = Partial<Record<Capability, boolean | undefined>>;

export class TeamService {
    /**
     * @param outbox Optional core->portal user-sync sink (SaaS-only; wired in
     *   di.ts when the portal binding is present, undefined in standalone). Used
     *   to emit `user.deleted` when a member is removed so the portal identity's
     *   membership for this workspace is dropped. Guarded by `if (this.outbox)`,
     *   so standalone never touches portal code.
     * @param kv Optional session-invalidation KV (same binding as
     *   AuthService's `TENANT_CACHE`). Used by `removeMember` to write a
     *   `pwchanged:{userId}` marker so the removed member's outstanding JWT
     *   is rejected on the next request instead of surviving up to its
     *   24h expiry — jwtAuthMiddleware checks this key but never re-reads
     *   the user row. Guarded by `if (this.kv)`.
     * @param oauth Optional MCP OAuth provider helper (present only when
     *   MCP_ENABLED — see di.ts). Used by `removeMember` to revoke every
     *   outstanding MCP grant the removed member holds: grant `props` are
     *   baked in at authorize time and never re-checked against the `users`
     *   row per MCP call, so the `pwchanged` marker above has no effect on
     *   MCP traffic (see identity-bridge.ts). Guarded by `if (this.oauth)`.
     */
    constructor(
        private db: D1Database,
        private outbox?: UserSyncOutbox,
        private kv?: KVNamespace,
        private oauth?: OAuthHelpers,
    ) {}

    private getDB() {
        return drizzle(this.db);
    }

    /** Write a session-invalidation marker for a user. Same key format/semantics as AuthService.writeInvalidation. */
    private async writeSessionInvalidation(userId: string) {
        if (!this.kv) return;
        const ts = Math.floor(Date.now() / 1000).toString();
        try {
            await this.kv.put(`pwchanged:${userId}`, ts, { expirationTtl: 90000 });
        } catch (err) {
            logger.warn('Failed to write session-invalidation key after member removal; outstanding tokens may remain valid until exp', {
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    async getMembers(tenantId: string) {
        const db = this.getDB();
        const [activeUsers, pendingInvites, tenantRecord] = await Promise.all([
            db.select({
                id: users.id,
                email: users.email,
                role: users.role,
                createdAt: users.createdAt
            }).from(users).where(and(eq(users.tenantId, tenantId), isNull(users.deletedAt))),
            db.select().from(tenantInvites)
                .where(and(eq(tenantInvites.tenantId, tenantId), eq(tenantInvites.status, 'pending'))),
            db.select({ maxUsers: tenants.maxUsers })
                .from(tenants).where(eq(tenants.id, tenantId)).limit(1),
        ]);

        const maxUsers = tenantRecord[0]?.maxUsers ?? 3;
        return { activeUsers, pendingInvites, maxUsers };
    }

    async createInvite(params: {
        tenantId: string;
        email: string;
        role: UserRole;
        permissionOverrides?: RequestedOverrides | null;
    }) {
        const db = this.getDB();

        // Seat-quota enforcement now lives in features/seat-quota/middleware
        // (mounted on POST /api/team/invite). The service only needs to
        // verify the invitee is not already an ACTIVE workspace member — a
        // soft-deleted (removed) row must not block a re-invite, since
        // AuthService.joinTeam reactivates it rather than inserting a new one.
        const existing = await db.select({ id: users.id }).from(users)
            .where(and(eq(users.tenantId, params.tenantId), eq(users.email, params.email), isNull(users.deletedAt))).limit(1);

        if (existing.length > 0) throw Errors.Conflict('User is already a member');

        // Only persist toggles that DIFFER from the role template, so an
        // all-default invite stores null (single source of truth = the role).
        const permissionOverrides = TeamService.diffOverrides(params.role, params.permissionOverrides);

        // Create Invite (7-day expiry)
        const inviteToken = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await db.insert(tenantInvites).values({
            id: inviteToken,
            tenantId: params.tenantId,
            email: params.email,
            role: params.role,
            status: 'pending',
            expiresAt,
            permissionOverrides,
        });

        return { token: inviteToken, expiresAt };
    }

    /**
     * Reduce a requested override map to only the capabilities whose value
     * differs from the role's template default. Returns null when nothing
     * differs (the role template already covers the request) so the stored
     * column stays null. owner/agent capabilities are pinned by getCapabilities,
     * so a diff against the effective template never persists a moot toggle.
     */
    static diffOverrides(role: UserRole, requested?: RequestedOverrides | null): PermissionOverrides | null {
        if (!requested) return null;
        const template = getCapabilities(role, null);
        const diff: PermissionOverrides = {};
        for (const cap of TOGGLEABLE) {
            const value = requested[cap];
            if (typeof value === 'boolean' && value !== template[cap]) diff[cap] = value;
        }
        return Object.keys(diff).length ? diff : null;
    }

    async removeMember(tenantId: string, userId: string, requesterId: string) {
        if (userId === requesterId) {
            throw Errors.BadRequest('Cannot remove yourself');
        }
        const db = this.getDB();
        const user = await db.select({ id: users.id, email: users.email, role: users.role }).from(users)
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
            .get();
        if (!user) throw Errors.NotFound('Member not found');

        // Soft-delete rather than hard-delete: `inspections.inspector_id`
        // FK-references `users.id`, so a member with inspections can't be
        // hard-deleted under D1 FK enforcement, and hard-deleting would orphan
        // report attribution. `deletedAt` gives deactivate/reactivate
        // semantics (see AuthService.joinTeam reactivation) while keeping the
        // row — and any inspections it is attributed to — intact.
        await db.update(users).set({ deletedAt: new Date() })
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

        // Invalidate the removed member's live sessions immediately, and do
        // it BEFORE the (unguarded) outbox append below. jwtAuthMiddleware
        // only checks this KV key per request — it never re-reads the user
        // row — so without this write a removed member's JWT would stay
        // valid for up to its full 24h expiry. This write has its own
        // fail-open try/catch; the outbox append does not, and a transient
        // D1 failure there must not be able to skip this security-critical
        // KV write.
        await this.writeSessionInvalidation(userId);

        // Revoke every outstanding MCP OAuth grant the removed member holds —
        // BEFORE the (unguarded) outbox append below, same security-first
        // ordering as the KV write above. Without this, a removed member with
        // a live MCP grant keeps full tenant API access indefinitely: MCP
        // mints a fresh internal JWT (iat = now) on every call, so the
        // pwchanged marker never trips for that path (see identity-bridge.ts).
        // Fail-open like writeSessionInvalidation — an OAuth-storage hiccup
        // must not abort the removal itself; isGrantUserActive in
        // identity-bridge.ts is the defense-in-depth backstop for this window.
        if (this.oauth) {
            try {
                await revokeAllUserGrants(this.oauth, userId);
            } catch (err) {
                logger.warn('Failed to revoke MCP OAuth grants after member removal; outstanding grants may remain usable', {
                    userId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        // Mirror the removal to portal so the matching identity loses its
        // membership for this workspace. Email is captured from the row read
        // above (before the update). SaaS-only — no-op when outbox is undefined.
        if (this.outbox) {
            await this.outbox.append({
                type: 'user.deleted',
                payload: { tenantId, email: user.email },
            });
        }

        return user;
    }

}
