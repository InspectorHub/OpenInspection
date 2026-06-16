import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { inspections, tenants } from '../../lib/db/schema';
import type { HonoConfig } from '../../types/hono';

/**
 * Tenant resolution for the public client chain keyed by inspection id:
 * `/r/:id/...` (invoice page) and `/api/public/r/:id/...`
 * (invoice data, pay-intent). The unguessable inspection UUID is
 * already the capability these endpoints trust; resolving tenancy from it is
 * equivalent to the portal-token → tenantId pattern.
 */
const R_PREFIXES = ['/r/', '/api/public/r/'];

export function extractInspectionIdFromPath(path: string): string | null {
    for (const prefix of R_PREFIXES) {
        if (path.startsWith(prefix)) {
            const id = path.slice(prefix.length).split('/')[0];
            return id || null;
        }
    }
    return null;
}

interface CachedTenantRef { tenantId: string; tier: string; status: string }

export async function resolveByInspectionId(c: Context<HonoConfig>, path: string): Promise<boolean> {
    const inspectionId = extractInspectionIdFromPath(path);
    if (!inspectionId) return false;

    const cacheKey = `inspection-tenant:${inspectionId}`;
    let ref = c.env.TENANT_CACHE
        ? ((await c.env.TENANT_CACHE.get(cacheKey, { type: 'json' })) as CachedTenantRef | null)
        : null;

    if (!ref) {
        try {
            const db = drizzle(c.env.DB);
            const row = await db
                .select({ tenantId: inspections.tenantId, tier: tenants.tier, status: tenants.status })
                .from(inspections)
                .innerJoin(tenants, eq(tenants.id, inspections.tenantId))
                .where(eq(inspections.id, inspectionId))
                .get();
            if (row) {
                ref = { tenantId: row.tenantId, tier: row.tier || 'free', status: row.status || 'active' };
                if (c.env.TENANT_CACHE && c.executionCtx) {
                    c.executionCtx.waitUntil(
                        c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(ref), { expirationTtl: 3600 }),
                    );
                }
            }
        } catch {
            // DB unavailable in test contexts — fall through to "not resolved"
        }
    }

    if (!ref) return false;
    c.set('tenantId', ref.tenantId);
    c.set('resolvedTenantId', ref.tenantId);
    c.set('tenantTier', ref.tier);
    c.set('tenantStatus', ref.status);
    return true;
}
