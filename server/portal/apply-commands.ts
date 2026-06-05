import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { PortalProvider } from './portal.provider';
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

/** Tenant upsert apply — delegates to the same PortalProvider the DI container
 *  wires behind AdminService.handleTenantUpdate in saas mode. */
export async function applyTenantUpdate(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    params: TenantUpdateParams,
): Promise<void> {
    await new PortalProvider(dbBinding, kv).handleTenantUpdate(params);
}
