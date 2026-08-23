/**
 * Account-level operations for the calling identity:
 *
 *  - `exportAccount(db, userId)` returns the user record + agent-tenant
 *    memberships + inspections they ran, used by the GDPR/CCPA "download my
 *    data" affordance in /settings/account. The user record is filtered through
 *    the account-export classification, which withholds the three
 *    authentication credentials on the row and names what it withheld.
 *  - `softDeleteAccount(db, userId, confirmEmail)` marks `users.deleted_at`
 *    after verifying the caller retyped the matching email. Rows are kept so
 *    audit-linked references remain intact; subsequent logins still fail
 *    because auth checks the column.
 */
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users, contacts, inspections } from '../lib/db/schema';
import { redactIdentityForExport, type WithheldField } from '../lib/compliance/account-export-manifest';
import { logger } from '../lib/logger';

export interface AccountExport {
    exportedAt: string;
    identity: Record<string, unknown>;
    /**
     * The `users` columns deliberately held back, each with the reason. Present
     * so an incomplete export says so: the classification withholds an
     * unclassified column by default, and a column that simply vanished with no
     * trace is the under-disclosure failure that default would otherwise cause.
     */
    identityWithheld: WithheldField[];
    memberships: Record<string, unknown>[];
    inspections: Record<string, unknown>[];
}

export interface AccountDeleteResult {
    deletedAt: string;
    identityId: string;
}

export async function exportAccount(db: DrizzleD1Database, userId: string): Promise<AccountExport> {
    // Still a star select, deliberately: the row is fetched whole and then
    // CLASSIFIED, so a column added to `users` cannot skip the decision by
    // never reaching this code. Narrowing the select would move the choice into
    // a column list nobody reviews as a disclosure decision.
    // `redactIdentityForExport` splits it — see
    // server/lib/compliance/account-export-manifest.ts for why every column is
    // ruled on rather than three being denied.
    const identityRow = await db.select().from(users).where(eq(users.id, userId)).get();
    const { identity, withheld } = redactIdentityForExport(
        (identityRow ?? {}) as Record<string, unknown>,
    );
    // IA-104 — an agent's tenant memberships are the contact rows bound to
    // their account. Same facts the link table held, now on the row itself.
    // Still the right thing to export for a DSAR: it is where this person
    // appears in other people's workspaces.
    const memberships = await db.select().from(contacts)
        .where(eq(contacts.agentUserId, userId)).all();
    const userInspections = await db.select().from(inspections)
        .where(eq(inspections.inspectorId, userId)).all();
    return {
        exportedAt: new Date().toISOString(),
        identity,
        identityWithheld: withheld,
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
