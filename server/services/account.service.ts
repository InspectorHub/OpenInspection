/**
 * Account-level operations for the calling identity:
 *
 *  - `exportAccount(db, userId)` returns the user record + agent-tenant
 *    memberships + inspections they ran, used by the GDPR/CCPA "download my
 *    data" affordance in /settings/account.
 *  - `softDeleteAccount(db, userId, confirmEmail)` marks `users.deleted_at`
 *    after verifying the caller retyped the matching email. Rows are kept so
 *    audit-linked references remain intact; subsequent logins still fail
 *    because auth checks the column.
 */
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users, agentTenantLinks, inspections } from '../lib/db/schema';
import { logger } from '../lib/logger';

export interface AccountExport {
    exportedAt: string;
    identity: Record<string, unknown>;
    memberships: Record<string, unknown>[];
    inspections: Record<string, unknown>[];
}

export interface AccountDeleteResult {
    deletedAt: string;
    identityId: string;
}

export async function exportAccount(db: DrizzleD1Database, userId: string): Promise<AccountExport> {
    const identity = await db.select().from(users).where(eq(users.id, userId)).get();
    const memberships = await db.select().from(agentTenantLinks)
        .where(eq(agentTenantLinks.agentUserId, userId)).all();
    const userInspections = await db.select().from(inspections)
        .where(eq(inspections.inspectorId, userId)).all();
    return {
        exportedAt: new Date().toISOString(),
        identity: (identity ?? {}) as Record<string, unknown>,
        memberships: (memberships ?? []) as Record<string, unknown>[],
        inspections: (userInspections ?? []) as Record<string, unknown>[],
    };
}

export async function softDeleteAccount(
    db: DrizzleD1Database,
    userId: string,
    confirmEmail: string,
    kv?: KVNamespace,
): Promise<AccountDeleteResult> {
    const identity = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!identity) throw new Error('Identity not found');
    if (identity.email !== confirmEmail) {
        throw new Error('confirmEmail does not match identity email');
    }
    const deletedAt = new Date();
    await db.update(users).set({ deletedAt }).where(eq(users.id, userId));

    // Same `pwchanged:{userId}` session-invalidation marker AuthService /
    // TeamService write on any account-disabling mutation — without it a
    // self-deleted user's live JWT stays valid up to its full 24h expiry
    // (jwtAuthMiddleware checks this key per request but never re-reads the
    // user row). Fail-open: a KV outage must not block the delete the caller
    // just confirmed by retyping their email.
    if (kv) {
        const ts = Math.floor(Date.now() / 1000).toString();
        try {
            await kv.put(`pwchanged:${userId}`, ts, { expirationTtl: 90000 });
        } catch (err) {
            logger.warn('Failed to write session-invalidation key after self-delete; outstanding tokens may remain valid until exp', {
                userId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    return { deletedAt: deletedAt.toISOString(), identityId: userId };
}
