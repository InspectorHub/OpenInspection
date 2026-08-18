import { drizzle } from 'drizzle-orm/d1';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { users, tenantInvites, tenants, tenantConfigs } from '../lib/db/schema';
import { tenantDisplayName } from '../lib/tenant-display-name';
import { Errors } from '../lib/errors';
import { hashPassword, verifyPassword } from '../lib/password';
import { logger } from '../lib/logger';
import { joinTeam as joinTeamImpl, type JoinTeamOptions } from './auth/join-team';
import type { UserSyncOutbox } from '../lib/integration/user-sync';

export type { JoinTeamOptions };

/**
 * Dummy PBKDF2 hash used to equalize verify() timing when the email lookup
 * misses. Exported so other login entry points that must mirror the SAME
 * anti-oracle pattern (e.g. the agent password login, server/api/agent/login.ts
 * — Spec 3 Task 5) reuse this exact constant rather than a second one.
 */
export const DUMMY_HASH = 'pbkdf2:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Service to handle all authentication-related business logic.
 * Decouples database operations from the HTTP routing layer.
 *
 * The optional `outbox` dependency is used to forward user-lifecycle
 * events (password changed / team join / reset) to portal so a portal
 * identity with N workspace memberships stays in sync without manual
 * intervention.
 */
export class AuthService {
    constructor(private db: D1Database, private kv?: KVNamespace, private outbox?: UserSyncOutbox) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /** Write a session-invalidation marker for a user. Safe to call during DB mutations. */
    private async writeInvalidation(userId: string) {
        if (!this.kv) return;
        const ts = Math.floor(Date.now() / 1000).toString();
        try {
            await this.kv.put(`pwchanged:${userId}`, ts, { expirationTtl: 90000 });
        } catch (err) {
            logger.warn('Failed to write session-invalidation key; outstanding tokens may remain valid until exp', {
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /**
     * Hashes a password using PBKDF2-SHA256. Thin wrapper retained so callers
     * that reach in via the service (e.g. the setup route) keep working.
     */
    async hashPassword(password: string): Promise<string> {
        return hashPassword(password);
    }

    /**
     * Standalone login row selection. Scoped to the resolved single tenant so a same-email
     * global agent (tenant_id NULL) or another tenant's row can never be authenticated, and
     * fails closed if the composite unique index is ever violated. See spec login-email-ambiguity.
     */
    async findLoginUser(email: string, tenantId: string) {
        const db = this.getDrizzle();
        const rows = await db.select().from(users)
            .where(and(
                eq(users.email, email),
                eq(users.tenantId, tenantId),   // excludes NULL-tenant agents + other tenants
                isNull(users.deletedAt),
            ))
            .all();
        if (rows.length === 0) return null;
        if (rows.length > 1) {
            logger.error('[login] ambiguous email within tenant — refusing auth', { tenantId });
            return null;
        }
        return rows[0];
    }

    /**
     * Validates a user's credentials. Lazily upgrades legacy SHA-256 hashes to PBKDF2.
     * Runs PBKDF2 even when the email is unknown to hide user-existence via timing.
     */
    async validateCredentials(email: string, password: string, tenantId: string) {
        const db = this.getDrizzle();
        // Soft-deleted (removed member / self-deleted account) rows are
        // excluded — a matching row that isn't NULL-deleted-at must never
        // authenticate, even if the caller somehow still knows the password.
        //
        // Global agents (role='agent', tenant_id IS NULL) are excluded as a
        // consequence of the tenant scoping in findLoginUser: they authenticate
        // exclusively through /agent-login (findGlobalAgentByEmail), never this
        // tenant front door. `users.email` is unique only per (tenant_id, email),
        // so an email held by BOTH a global agent and an invited tenant member
        // used to return a nondeterministic row — the earlier-inserted agent row
        // could shadow the member and lock them out, and /agent-signup is
        // self-serve, so that collision is attacker-seedable. See #258 review.
        // Matching on tenant_id = :tenantId is strictly stronger than the old
        // "not a global agent" filter: a NULL tenant_id can never match, and an
        // ambiguous result now fails closed rather than picking a row.
        const user = await this.findLoginUser(email, tenantId);

        if (!user) {
            // Perform a throwaway verification against a fixed hash so the response time
            // does not leak whether the email exists.
            await verifyPassword(password, DUMMY_HASH);
            throw Errors.Unauthorized('Invalid email or password');
        }

        const [valid, needsRehash] = await verifyPassword(password, user.passwordHash);
        if (!valid) {
            throw Errors.Unauthorized('Invalid email or password');
        }

        if (needsRehash) {
            const upgraded = await hashPassword(password);
            await db.update(users).set({ passwordHash: upgraded }).where(eq(users.id, user.id));
        }

        return user;
    }

    /**
     * Updates a user's password.
     */
    async updatePassword(userId: string, currentPassword: string, newPassword: string) {
        const db = this.getDrizzle();
        const user = await db.select().from(users).where(eq(users.id, userId)).get();
        if (!user) throw Errors.NotFound('User not found');

        const [valid] = await verifyPassword(currentPassword, user.passwordHash);
        if (!valid) {
            throw Errors.Unauthorized('Current password is incorrect');
        }

        const newHash = await hashPassword(newPassword);
        await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId));
        await this.writeInvalidation(userId);

        // Forward to portal so the matching identity row gets the new hash
        // — without this an identity that holds memberships in multiple
        //   workspaces would silently desync (login at portal fails next
        //   time even though the user just rotated their password here).
        if (this.outbox && user.tenantId) {
            await this.outbox.append({
                type: 'user.password_changed',
                payload: { tenantId: user.tenantId, email: user.email, passwordHash: newHash },
            });
        }
    }

    /**
     * Joins a team using an invitation token. The contract — one atomic write
     * for the account and its acceptance, reactivation of a soft-deleted row,
     * the refusal when nothing is published to accept, and the seat cap — is
     * documented at the implementation in `auth/join-team.ts`.
     */
    async joinTeam(token: string, password: string, opts: JoinTeamOptions) {
        return joinTeamImpl({ db: this.db, outbox: this.outbox }, token, password, opts);
    }

    /**
     * C-10 ③-B — preview metadata for the team-invite accept page (`/join`).
     * Returns the invited email + workspace name for a LIVE invite (pending +
     * not expired), or null so the page can render its expired/invalid state.
     * The invite id is the token (see joinTeam).
     */
    async getInviteInfo(token: string): Promise<{ email: string; workspaceName: string } | null> {
        const db = this.getDrizzle();
        const invite = await db.select().from(tenantInvites).where(eq(tenantInvites.id, token)).get();
        if (!invite) return null;
        if (invite.status !== 'pending') return null;
        if (invite.expiresAt < new Date()) return null;
        const tenant = await db.select({ name: tenantDisplayName }).from(tenants)
            .leftJoin(tenantConfigs, eq(tenantConfigs.tenantId, tenants.id))
            .where(eq(tenants.id, invite.tenantId)).get();
        return { email: invite.email, workspaceName: tenant?.name ?? '' };
    }

    /**
     * C-10 ③-B — whether the instance has completed first-run setup, i.e. any
     * tenant-scoped user exists. Drives the `/setup` page's redirect-if-done
     * guard. Mirrors the existing-user check in the setup handler.
     */
    async isSetUp(): Promise<boolean> {
        const db = this.getDrizzle();
        const row = await db.select({ id: users.id }).from(users).where(sql`${users.tenantId} IS NOT NULL`).limit(1).get();
        return !!row;
    }

    /**
     * Creates a password reset token and stores it in KV.
     * Value format: "{userId}:{issuedAtUnixSec}" so we can detect tokens that predate
     * a password change and reject them even though they haven't expired yet.
     */
    async createPasswordResetToken(email: string): Promise<string | null> {
        const db = this.getDrizzle();
        const user = await db.select().from(users).where(eq(users.email, email)).get();
        if (!user || !this.kv) return null;

        const resetToken = crypto.randomUUID();
        const kvKey = `pw_reset:${resetToken}`;
        const issuedAt = Math.floor(Date.now() / 1000);
        await this.kv.put(kvKey, `${user.id}:${issuedAt}`, { expirationTtl: 3600 });
        return resetToken;
    }

    /**
     * Resets a user's password using a valid token.
     */
    async resetPassword(token: string, newPassword: string) {
        if (!this.kv) throw Errors.BadRequest('Password reset not available');

        const kvKey = `pw_reset:${token}`;
        const raw = await this.kv.get(kvKey);
        if (!raw) throw Errors.BadRequest('Invalid or expired reset token');

        // Support both legacy ("userId") and new ("userId:issuedAt") formats.
        const sepIdx = raw.indexOf(':');
        const userId = sepIdx === -1 ? raw : raw.slice(0, sepIdx);
        const issuedAt = sepIdx === -1 ? 0 : parseInt(raw.slice(sepIdx + 1), 10) || 0;

        // Reject reset tokens issued before the user's last password change.
        const invalidatedAt = await this.kv.get(`pwchanged:${userId}`);
        if (invalidatedAt && issuedAt <= parseInt(invalidatedAt, 10)) {
            await this.kv.delete(kvKey);
            throw Errors.BadRequest('Invalid or expired reset token');
        }

        const db = this.getDrizzle();
        const newHash = await hashPassword(newPassword);
        await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId));
        await this.kv.delete(kvKey);
        await this.writeInvalidation(userId);

        // Mirror the new hash to portal for the matching identity.
        if (this.outbox) {
            const row = await db.select({ tenantId: users.tenantId, email: users.email })
                .from(users).where(eq(users.id, userId)).get();
            if (row?.tenantId) {
                await this.outbox.append({
                    type: 'user.password_changed',
                    payload: { tenantId: row.tenantId, email: row.email, passwordHash: newHash },
                });
            }
        }
    }

    /**
     * Invalidate all outstanding JWTs for a user. Call this from any future endpoint
     * that changes a user's role, disables them, deletes them, or on explicit logout.
     */
    async invalidateUserSessions(userId: string) {
        await this.writeInvalidation(userId);
    }
}
