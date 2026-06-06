import { drizzle } from 'drizzle-orm/d1';
import { eq, and, lt } from 'drizzle-orm';
import { users, tenants } from '../lib/db/schema';

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

/** A-21 batch 2 — apply the credential iff it is fresh on the CREDENTIAL
 *  stream (`tenants.applied_cred_seq`). Credentials ride `cmd.tenant.update`
 *  sparsely, so the shared tenantseq can't order them; this independent
 *  sequence closes the batch-1 residual (a stale credential overwriting a
 *  newer one). `credseq` undefined = legacy in-flight command → apply
 *  unguarded (today's behavior), do NOT advance the high-water mark. */
export async function applyCredentialIfFresh(
    dbBinding: D1Database,
    p: { tenantId: string; adminEmail: string; adminPasswordHash: string; credseq?: number },
): Promise<'credential-applied' | 'credential-stale'> {
    const db = drizzle(dbBinding);
    if (p.credseq !== undefined) {
        const row = await db.select({ applied: tenants.appliedCredSeq })
            .from(tenants).where(eq(tenants.id, p.tenantId)).get();
        if (row && p.credseq <= row.applied) return 'credential-stale';
    }
    await applyAdminCredential(dbBinding, {
        tenantId: p.tenantId,
        adminEmail: p.adminEmail,
        adminPasswordHash: p.adminPasswordHash,
    });
    if (p.credseq !== undefined) {
        await db.update(tenants)
            .set({ appliedCredSeq: p.credseq })
            .where(and(eq(tenants.id, p.tenantId), lt(tenants.appliedCredSeq, p.credseq)));
    }
    return 'credential-applied';
}
