import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { users } from '../lib/db/schema';

/** Admin-credential upsert — extracted verbatim from PortalProvider.handleTenantUpdate
 *  so the cmd consumer can salvage credentials off a stale command without
 *  re-applying its superseded tenant fields (A-21 review fix). Email-keyed
 *  idempotent upsert; safe to apply out of sequence order. */
export async function applyAdminCredential(
    dbBinding: D1Database,
    p: { tenantId: string; adminEmail: string; adminPasswordHash: string },
): Promise<void> {
    const db = drizzle(dbBinding);
    const existingUser = await db.select()
        .from(users)
        .where(eq(users.email, p.adminEmail))
        .get();
    if (!existingUser) {
        await db.insert(users).values({
            id: crypto.randomUUID(),
            tenantId: p.tenantId,
            email: p.adminEmail,
            passwordHash: p.adminPasswordHash,
            role: 'owner',
            createdAt: new Date(),
        });
    } else {
        await db.update(users)
            .set({
                passwordHash: p.adminPasswordHash,
                tenantId: p.tenantId, // Ensure it's correctly linked
            })
            .where(eq(users.id, existingUser.id));
    }
}
