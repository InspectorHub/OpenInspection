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
import { users, agentTenantLinks, inspections } from '../lib/db/schema';

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

export async function exportAccount(db: any, userId: string): Promise<AccountExport> {
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
    db: any,
    userId: string,
    confirmEmail: string,
): Promise<AccountDeleteResult> {
    const identity = await db.select().from(users).where(eq(users.id, userId)).get();
    if (!identity) throw new Error('Identity not found');
    if ((identity as any).email !== confirmEmail) {
        throw new Error('confirmEmail does not match identity email');
    }
    const deletedAt = new Date();
    await db.update(users).set({ deletedAt } as any).where(eq(users.id, userId));
    return { deletedAt: deletedAt.toISOString(), identityId: userId };
}
