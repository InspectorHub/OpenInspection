import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { inArray } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { tenants } from '../lib/db/schema';
import { usageCounters } from '../lib/db/schema/usage';
import { aggregateUsage } from '../lib/usage/aggregate';
import { FREE_TIER_CAPS } from '../features/plan-quota/policy';
import { logger } from '../lib/logger';

/**
 * GET /api/platform/usage — platform monitoring: aggregated usage counters
 * across all tenants, for the portal console's usage dashboard. Per tenant:
 * lifetime sums for every metered dimension (platform + bring-your-own
 * sms/email, inspections), the r2_bytes gauge, the tenant's plan tier, and —
 * for a free tenant only — the free-tier caps those platform metrics are
 * measured against (`null` for pro/enterprise, since the cap never applies to
 * them). M2M-guarded at the mount (requireServiceBinding).
 */
export async function usageReportHandler(c: Context<HonoConfig>) {
    try {
        const db = drizzle(c.env.DB);
        const rows = await db.select().from(usageCounters).all();
        const usage = aggregateUsage(rows);

        const tenantIds = usage.map((u) => u.tenantId);
        const tierRows = tenantIds.length
            ? await db.select({ id: tenants.id, tier: tenants.tier }).from(tenants).where(inArray(tenants.id, tenantIds)).all()
            : [];
        const tierByTenant = new Map(tierRows.map((t) => [t.id as string, t.tier as string]));

        const data = usage.map((u) => {
            const tier = tierByTenant.get(u.tenantId) ?? 'free';
            return {
                tenantId:    u.tenantId,
                tier,
                inspections: u.inspections,
                sms:         u.sms,
                smsByo:      u.smsByo,
                email:       u.email,
                emailByo:    u.emailByo,
                r2Bytes:     u.r2Bytes,
                caps:        tier === 'free' ? FREE_TIER_CAPS : null,
            };
        });

        return c.json({ success: true, data });
    } catch (error: unknown) {
        logger.error('usage aggregation failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
}
