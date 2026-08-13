import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, tenantConfigs } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { PortalProvider } from './portal.provider';
import { narrowAiTierCaps, writeTenantAiCaps } from '../features/plan-quota/ai-caps';
import type { TenantUpdateParams } from '../lib/integration';

/**
 * A-21 — the SINGLE implementations behind both entrances of each portal→core
 * command: the legacy M2M endpoint (integration.routes.ts) and the cmd-queue
 * consumer (cmd-consumer.ts) call these same functions, so apply behavior can
 * never diverge between transports.
 */

/** Seat-quota apply: update max_users + invalidate the tenant KV cache.
 *  Extracted verbatim from the POST /sync-quota route handler. */
export async function applySyncQuota(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    p: { tenantId: string; maxUsers: number },
): Promise<'applied' | 'tenant-not-found'> {
    const db = drizzle(dbBinding);
    const result = await db.update(tenants)
        .set({ maxUsers: p.maxUsers })
        .where(eq(tenants.id, p.tenantId))
        .returning({ id: tenants.id });
    if (result.length === 0) return 'tenant-not-found';
    try {
        await kv?.delete(`tenant:${p.tenantId}`);
    } catch { /* cache miss is fine — read-through repopulates */ }
    logger.info('sync-quota applied', { tenantId: p.tenantId, maxUsers: p.maxUsers });
    return 'applied';
}

/** AI-cap apply (managed-AI provider tier): store the delivered allowances
 *  where `PlanQuotaGuard` reads them, and invalidate the tenant KV cache for
 *  the same reason sync-quota does. The narrowing lives with the storage
 *  (features/plan-quota/ai-caps.ts) so the read and the write can never
 *  disagree about which metrics are real. */
export async function applyAiCaps(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    p: { tenantId: string; tier: string; caps: Record<string, unknown> },
): Promise<'applied' | 'tenant-not-found'> {
    const caps = narrowAiTierCaps({ [p.tier]: p.caps });
    const result = await writeTenantAiCaps(dbBinding, p.tenantId, caps);
    if (result === 'tenant-not-found') return result;
    try {
        await kv?.delete(`tenant:${p.tenantId}`);
    } catch { /* cache miss is fine — read-through repopulates */ }
    // The numbers themselves are operator-set configuration, not tenant data,
    // so they are safe to log and worth logging: an unexplained block is the
    // failure mode this whole path exists to make explicable.
    logger.info('ai-caps applied', { tenantId: p.tenantId, tier: p.tier, caps: caps?.[p.tier] ?? null });
    return 'applied';
}

/**
 * A company admin renamed their own company — write the DISPLAY name, always.
 *
 * The unconditional write is the whole point, and it is why this is not a field
 * on `cmd.tenant.update`. That command's name write is initialize-only, which is
 * right for a provisioning sync and wrong for a rename; while `tenants.name`
 * existed the rename landed there instead and the difference stayed hidden.
 *
 * Upsert, because a tenant with no config row must still end up named rather
 * than silently skipped — the row is created by both providers at provisioning,
 * so this branch is belt-and-braces, and the failure it prevents is quiet.
 *
 * `legal_name` is untouched. It is a separate column for agreements, signature
 * certificates, the invoice "from" party and the TCPA disclosure; renaming the
 * brand must not rewrite the entity that signed something.
 *
 * The KV drop matches sync-quota's: the tenant cache carries the display name,
 * and a rename nobody can see until the entry expires is the same silence this
 * command exists to end.
 */
export async function applyTenantRename(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    p: { tenantId: string; companyName: string },
): Promise<'applied' | 'tenant-not-found'> {
    const db = drizzle(dbBinding);
    const tenant = await db.select({ id: tenants.id })
        .from(tenants).where(eq(tenants.id, p.tenantId)).get();
    if (!tenant) return 'tenant-not-found';

    const now = new Date();
    await db.insert(tenantConfigs)
        .values({ tenantId: p.tenantId, companyName: p.companyName, updatedAt: now })
        .onConflictDoUpdate({
            target: tenantConfigs.tenantId,
            set: { companyName: p.companyName, updatedAt: now },
        });

    try {
        await kv?.delete(`tenant:${p.tenantId}`);
    } catch { /* cache miss is fine — read-through repopulates */ }
    logger.info('tenant rename applied', { tenantId: p.tenantId });
    return 'applied';
}

/** Tenant upsert apply — delegates to the same PortalProvider the DI container
 *  wires behind AdminService.handleTenantUpdate in saas mode. */
export async function applyTenantUpdate(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    params: TenantUpdateParams,
): Promise<void> {
    await new PortalProvider(dbBinding, kv).handleTenantUpdate(params);
}

/** Starter-content seed apply (A-21 batch 2) — same single-implementation rule:
 *  both the POST /seed-starter-content endpoint and the cmd consumer call this.
 *  Idempotent per table (name/slug/text-keyed skips). Dynamic import keeps the
 *  bundled seed JSON out of this module's static graph. */
export async function applySeedStarterContent(
    dbBinding: D1Database,
    p: { tenantId: string },
): Promise<{ seeded: import('../services/starter-content.service').StarterContentResult } | 'tenant-not-found'> {
    const db = drizzle(dbBinding);
    const existing = await db.select({ id: tenants.id })
        .from(tenants).where(eq(tenants.id, p.tenantId)).get();
    if (!existing) return 'tenant-not-found';
    const { seedStarterContent } = await import('../services/starter-content.service');
    const result = await seedStarterContent(dbBinding, p.tenantId);
    logger.info('seed-starter-content applied', { tenantId: p.tenantId, ...result });
    return { seeded: result };
}
