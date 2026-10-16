import { drizzle } from 'drizzle-orm/d1';
import { users, tenantInvites, tenants } from '../lib/db/schema';
import { eq, and, isNull, ne } from 'drizzle-orm';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { UserRole } from '../types/auth';
import { assertMayTouchOwner } from '../lib/auth/owner-guard';
import { assertMayGrant, type GrantActor } from '../lib/auth/grant-ceiling';
import { diffOverrides, planMemberUpdate, type MemberUpdatePlan, type RequestedOverrides } from './team/plan-member-update';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import type { UserSyncOutbox } from '../lib/integration/user-sync';
import { coerceOverrides, getCapabilities, type CapabilitySet, type PermissionOverrides } from '../lib/auth/capabilities';
import { revokeAllUserGrants } from '../lib/mcp/grants';
import { CREDENTIAL_MARKER_TTL_S } from '../lib/auth/credential-marker';
import { resetMemberTwoFactor } from './team/reset-two-factor';
import { planReassignment, runAtomically, type RemovalChoice } from './team/open-assignments';

export class TeamService {
    /**
     * @param outbox Optional core->portal user-sync sink (SaaS-only; wired in
     *   di.ts when the portal binding is present, undefined in standalone). Used
     *   to emit `user.deleted` when a member is removed so the portal identity's
     *   membership for this workspace is dropped, and `user.role_changed` when a
     *   member's role moves. Guarded by `if (this.outbox)`,
     *   so standalone never touches portal code.
     * @param kv Optional session-invalidation KV (same binding as
     *   AuthService's `TENANT_CACHE`). Used by `removeMember` to write a
     *   `pwchanged:{userId}` marker so the removed member's outstanding JWT
     *   is rejected on the next request instead of surviving up to its
     *   24h expiry — jwtAuthMiddleware checks this key but never re-reads
     *   the user row. Guarded by `if (this.kv)`.
     * @param oauth Optional OAuth provider helper (present only when MCP or
     *   native clients are enabled — see di.ts). `removeMember` uses it to revoke
     *   every outstanding OAuth grant the removed member holds: grant `props` are
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
            await this.kv.put(`pwchanged:${userId}`, ts, { expirationTtl: CREDENTIAL_MARKER_TTL_S });
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
                name: users.name,
                email: users.email,
                role: users.role,
                // IA-101 — the edit drawer seeds its capability toggles from
                // this. Without it the drawer could only show the role
                // template, so opening it on a member who HAD overrides and
                // pressing Save would silently reset them to defaults.
                permissionOverrides: users.permissionOverrides,
                // Whether the member has a second factor, so the page can
                // offer the owner's reset ONLY where there is something to
                // reset. The flag alone — never the secret or the recovery
                // codes, which have no business leaving the row.
                totpEnabled: users.totpEnabled,
                createdAt: users.createdAt,
                // LAYER 1 of the two that dropped this column. The /team page has a
                // LAST ACTIVE column; `touchLastActiveMiddleware` updates the row on
                // every authenticated /api/* request and the compliance manifests
                // describe it as the seat-accounting signal — but this projection
                // omitted it, so the only query that feeds that column could not
                // have answered it. (Layer 2 was the route loader, which then
                // hardcoded null.) A projection is a contract: a column the page
                // renders has to be in it.
                lastActiveAt: users.lastActiveAt
            }).from(users).where(and(eq(users.tenantId, tenantId), isNull(users.deletedAt))),
            db.select().from(tenantInvites)
                .where(and(eq(tenantInvites.tenantId, tenantId), eq(tenantInvites.status, 'pending'))),
            db.select({ maxUsers: tenants.maxUsers })
                .from(tenants).where(eq(tenants.id, tenantId)).limit(1),
        ]);

        const maxUsers = tenantRecord[0]?.maxUsers ?? 3;
        const readThrough = <T extends { permissionOverrides: unknown }>(rows: T[]) => rows.map(r => ({ ...r, permissionOverrides: coerceOverrides(r.permissionOverrides) })); // rows stored before `financial` was split are read through
        return { activeUsers: readThrough(activeUsers), pendingInvites: readThrough(pendingInvites), maxUsers };
    }

    async createInvite(params: {
        tenantId: string;
        email: string;
        role: UserRole;
        permissionOverrides?: RequestedOverrides | null;
        /** Who is inviting. Required: an invite without a known inviter is not creatable. */
        actor: GrantActor;
    }) {
        const db = this.getDB();

        // Store only what DIFFERS from the role template, so an all-default
        // invite stores null (single source of truth = the role).
        const permissionOverrides = TeamService.diffOverrides(params.role, params.permissionOverrides);

        // Checked before anything is read, so a refused caller learns nothing
        // about who is already on the team.
        assertMayGrant(params.actor, { from: null, to: { role: params.role, overrides: permissionOverrides } });

        // Seat-quota enforcement now lives in features/seat-quota/middleware
        // (mounted on POST /api/team/invite). The service only needs to
        // verify the invitee is not already an ACTIVE workspace member — a
        // soft-deleted (removed) row must not block a re-invite, since
        // AuthService.joinTeam reactivates it rather than inserting a new one.
        const existing = await db.select({ id: users.id }).from(users)
            .where(and(eq(users.tenantId, params.tenantId), eq(users.email, params.email), isNull(users.deletedAt))).limit(1);

        if (existing.length > 0) throw Errors.Conflict('User is already a member');

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
     * Cancel (hard-delete) a pending seat invite. Only rows that belong to the
     * caller's tenant AND are still `status='pending'` are deletable — accepted
     * invites are history (a real users row exists) and cross-tenant ids are
     * invisible. Unlike removeMember (which soft-deletes a live users row), a
     * pending invite has no FK dependents, so a hard delete is safe and leaves
     * no dead row. Throws NotFound so the route returns 404 for every miss.
     */
    async cancelInvite(tenantId: string, token: string): Promise<void> {
        const db = this.getDB();
        const invite = await db.select({ id: tenantInvites.id }).from(tenantInvites)
            .where(and(
                eq(tenantInvites.id, token),
                eq(tenantInvites.tenantId, tenantId),
                eq(tenantInvites.status, 'pending'),
            ))
            .get();
        if (!invite) throw Errors.NotFound('Invite not found');
        // Re-assert status='pending' in the DELETE itself: if the invite is
        // accepted between the SELECT above and here, this no-ops rather than
        // hard-deleting the now-historical row (closes the TOCTOU window).
        await db.delete(tenantInvites)
            .where(and(
                eq(tenantInvites.id, token),
                eq(tenantInvites.tenantId, tenantId),
                eq(tenantInvites.status, 'pending'),
            ));
    }

    /**
     * Look up a pending invite's email for the resend path. Tenant-scoped +
     * pending-only, same visibility rule as cancelInvite. Returns null (→ 404)
     * for unknown / accepted / cross-tenant tokens. The route reconstructs the
     * /join link and re-sends the email; the token and its 7-day expiry are
     * unchanged (resend, not re-issue).
     */
    async findPendingInvite(tenantId: string, token: string): Promise<{ email: string } | null> {
        const db = this.getDB();
        const row = await db.select({ email: tenantInvites.email }).from(tenantInvites)
            .where(and(
                eq(tenantInvites.id, token),
                eq(tenantInvites.tenantId, tenantId),
                eq(tenantInvites.status, 'pending'),
            ))
            .get();
        return row ?? null;
    }

    /** See `diffOverrides` in ./team/plan-member-update. */
    static diffOverrides(role: UserRole, requested?: RequestedOverrides | null): PermissionOverrides | null {
        return diffOverrides(role, requested);
    }

    /**
     * Change a member's role and/or their permission overrides (IA-101).
     *
     * The Team page has always had an "Edit" button next to every active
     * member; it had no onClick. A workspace could therefore be composed only
     * by inviting and removing people — the only way to correct a role was to
     * remove the member and re-invite them, which burns their history.
     *
     * SESSION INVALIDATION IS NOT OPTIONAL HERE. The role is a JWT claim
     * (jwt-claims.ts) and jwtAuthMiddleware never re-reads the users row, so a
     * demotion written only to D1 would sit inert for up to the token's full
     * 24h life — the member would keep every power we had just taken away,
     * and the UI would show the new role while the API honoured the old one.
     * Same reasoning as removeMember, and the same two mechanisms: the
     * `pwchanged` KV marker, plus MCP grant revocation (grant props are baked
     * at authorize time and never re-checked, so the KV marker cannot reach
     * that path).
     *
     * Overrides alone do NOT need invalidation — those are read from the row
     * per request (capabilitiesFor -> resolveOverridesFromDb) and so take
     * effect on the very next call. We invalidate only when the ROLE moves,
     * rather than logging someone out for a checkbox.
     */
    async updateMember(params: {
        tenantId: string;
        userId: string;
        requesterId: string;
        requesterRole: UserRole;
        /**
         * The requester's RESOLVED capabilities (role plus their own overrides).
         * Required for every requester but an owner, who holds everything: a
         * non-owner call without it is refused rather than guessed at.
         */
        requesterCapabilities?: CapabilitySet;
        role?: UserRole;
        /** Omitted means "leave the overrides as they are"; null or an empty map clears them. */
        permissionOverrides?: RequestedOverrides | null;
        /**
         * Runs after every refusal rule has passed and before anything is written,
         * and only when the edit changes something. Lets a caller add a check that
         * must come AFTER the grant ceiling (a seat-quota check, say), so a person
         * who may not make the change is never told about the company's seat count.
         */
        beforeWrite?: (plan: MemberUpdatePlan) => Promise<void>;
    }): Promise<{ id: string; role: UserRole; permissionOverrides: PermissionOverrides | null } & Pick<MemberUpdatePlan, 'changed' | 'roleChanged' | 'capabilitiesChanged'>> {
        const { tenantId, userId, requesterId } = params;
        const db = this.getDB();

        const actor: GrantActor | null = params.requesterRole === 'owner'
            ? { role: 'owner', capabilities: getCapabilities('owner', null) }
            : params.requesterCapabilities
                ? { role: params.requesterRole, capabilities: params.requesterCapabilities }
                : null;
        if (!actor) throw Errors.Forbidden('Only an owner or a manager can change team access');

        const user = await db.select({ id: users.id, email: users.email, role: users.role, permissionOverrides: users.permissionOverrides }).from(users)
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
            .get();
        if (!user) throw Errors.NotFound('Member not found');

        const nextRole = params.role ?? (user.role as UserRole);

        // Checked first so a refused caller learns nothing about the target.
        assertMayTouchOwner(params.requesterRole, user.role, nextRole);

        // An agent is not a seat-holding team member: access is granted per
        // inspection by a token that works without an account at all. Letting
        // the Team page mint one would create a second, contradictory way to
        // become an agent and put them on the seat count.
        if (nextRole === 'agent') {
            throw Errors.BadRequest('Agents are granted access per inspection, not added as team members');
        }

        if (params.role && params.role !== user.role) {
            // Demoting yourself is the fastest way to lock yourself out of the
            // page you are standing on. Mirrors removeMember's self-check.
            if (userId === requesterId) throw Errors.BadRequest('Cannot change your own role');

            // A workspace with no owner cannot be administered by anyone — no
            // remaining member could restore one.
            if (user.role === 'owner') {
                const otherOwners = await db.select({ id: users.id }).from(users)
                    .where(and(
                        eq(users.tenantId, tenantId),
                        eq(users.role, 'owner'),
                        ne(users.id, userId),
                        isNull(users.deletedAt),
                    )).limit(1);
                if (otherOwners.length === 0) throw Errors.BadRequest('Cannot change the role of the last owner');
            }
        }

        // The ceiling, the self-edit rule and the change itself (see the planner).
        const plan = planMemberUpdate({
            actor,
            isSelf: userId === requesterId,
            current: { role: user.role as UserRole, permissionOverrides: user.permissionOverrides },
            nextRole,
            requested: params.permissionOverrides,
        });
        const { permissionOverrides, roleChanged, capabilitiesChanged, changed } = plan;
        const result = { id: userId, role: nextRole, permissionOverrides, changed, roleChanged, capabilitiesChanged };
        if (!changed) return result;

        if (params.beforeWrite) await params.beforeWrite(plan);

        await db.update(users)
            .set({ role: nextRole, permissionOverrides })
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));

        if (roleChanged) {
            await this.writeSessionInvalidation(userId);
            if (this.oauth) {
                try {
                    await revokeAllUserGrants(this.oauth, userId);
                } catch (err) {
                    logger.warn('Failed to revoke MCP OAuth grants after a role change; outstanding grants may keep the OLD role', {
                        userId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }

            // Mirror the new role to the other side of the seam, after the
            // security-critical invalidation above. SaaS-only: no-op when the
            // outbox is undefined. Sent only when the role moved.
            // The role is already saved and the session already ended, so a failed
            // append must not turn this into an error the caller would retry.
            if (this.outbox) {
                try {
                    await this.outbox.append({
                        type: 'user.role_changed',
                        payload: { tenantId, email: user.email, role: nextRole },
                    });
                } catch (err) {
                    logger.error('Failed to append user.role_changed to the sync outbox after a role change; the other side may keep the OLD role', {
                        userId,
                        tenantId,
                    }, err instanceof Error ? err : new Error(String(err)));
                }
            }
        }

        return result;
    }

    async removeMember(tenantId: string, userId: string, requesterId: string, requesterRole: UserRole, choice: RemovalChoice = {}) {
        if (userId === requesterId) {
            throw Errors.BadRequest('Cannot remove yourself');
        }
        const db = this.getDB();
        const user = await db.select({ id: users.id, email: users.email, role: users.role }).from(users)
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
            .get();
        if (!user) throw Errors.NotFound('Member not found');

        assertMayTouchOwner(requesterRole, user.role, user.role);
        // A workspace with no owner cannot be administered by anyone. Same
        // rule as updateMember's role change (a backstop: only an owner gets here).
        if (user.role === 'owner') {
            const otherOwners = await db.select({ id: users.id }).from(users).where(and(
                eq(users.tenantId, tenantId), eq(users.role, 'owner'), ne(users.id, userId), isNull(users.deletedAt),
            )).limit(1);
            if (otherOwners.length === 0) throw Errors.BadRequest('Cannot remove the last owner');
        }

        // Throws the typed 409 BEFORE any write when open inspections need a choice.
        const plan = await planReassignment(db, tenantId, userId, choice);

        // Soft-delete, not hard-delete: finished inspections keep their
        // inspector for the record, and `deletedAt` allows reactivation (see
        // AuthService.joinTeam). The reassignment and the soft-delete share ONE
        // batch, so there is no state with half the inspections moved.
        const softDelete = db.update(users).set({ deletedAt: new Date() })
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
        await runAtomically(db, [...plan.statements, softDelete]);

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

        const moved = choice.reassignTo ? plan.openInspections : 0;
        // "Unassigned" counts inspections left WITHOUT a lead: a helper seat that
        // is merely dropped is not an inspection nobody is on.
        const unassigned = choice.unassign ? plan.openAsLead : 0;
        return { ...user, reassigned: moved, unassigned, keptForRecord: plan.keptForRecord };
    }

    /**
     * Clear a member's two-factor enrolment, so they can sign in with their
     * password alone and enrol again. Owner-only at the route.
     *
     * The rules — and the reason this exists at all — are in
     * `./team/reset-two-factor.ts`, which this delegates to unchanged.
     */
    async resetMemberTwoFactor(tenantId: string, userId: string, requesterId: string) {
        return resetMemberTwoFactor(this.getDB(), { tenantId, userId, requesterId });
    }

}
