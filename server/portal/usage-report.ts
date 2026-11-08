import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { inArray } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { tenants } from '../lib/db/schema';
import { usageCounters } from '../lib/db/schema/usage';
import { aggregateUsage } from '../lib/usage/aggregate';
import { FREE_TIER_CAPS, allowanceWindow } from '../features/plan-quota/policy';
import { monthInspectionCounts } from '../features/plan-quota/month-usage';
import { currentPeriodKey } from '../lib/usage/period';
import { logger } from '../lib/logger';

/**
 * GET /api/platform/usage — platform monitoring: aggregated usage counters
 * across all tenants, for the portal console's usage dashboard. Per tenant:
 * lifetime sums for every metered dimension (platform + bring-your-own
 * sms/email, inspections), the r2_bytes gauge, the tenant's plan tier, and —
 * for a free tenant only — the free-tier caps those platform metrics are
 * measured against (`null` for pro/enterprise, since the cap never applies to
 * them). M2M-guarded at the mount (requireServiceBinding).
 *
 * A FREE tenant's `inspections` and `email` are the figures its monthly caps are enforced against (inspections created
 * this UTC month, built-in emails sent this UTC month), not lifetime sums, and `period` names that month and when it
 * renews; for every other tenant `period` is null and the sums are unchanged.
 */
export async function usageReportHandler(c: Context<HonoConfig>) {
    try {
        const db = drizzle(c.env.DB);
        const rows = await db.select().from(usageCounters).all();
        const usage = aggregateUsage(rows);
        const now = new Date();
        const window = allowanceWindow(now);
        const monthKey = currentPeriodKey(now);
        // This month's built-in email per tenant, grouped once rather than re-filtering every row per tenant.
        const monthEmail = new Map<string, number>();
        for (const r of rows) {
            if (r.metric === 'email' && r.periodKey === monthKey) monthEmail.set(r.tenantId, (monthEmail.get(r.tenantId) ?? 0) + r.value);
        }
        const monthInspections = await monthInspectionCounts(c.env.DB, now, { freeTenants: true });

        const tenantIds = usage.map((u) => u.tenantId);
        const tierRows = tenantIds.length
            ? await db.select({ id: tenants.id, tier: tenants.tier }).from(tenants).where(inArray(tenants.id, tenantIds)).all()
            : [];
        const tierByTenant = new Map(tierRows.map((t) => [t.id as string, t.tier as string]));

        const data = usage.map((u) => {
            const tier = tierByTenant.get(u.tenantId) ?? 'free';
            const capped = tier === 'free';
            return {
                tenantId:    u.tenantId,
                tier,
                inspections: capped ? monthInspections.get(u.tenantId) ?? 0 : u.inspections,
                sms:         u.sms,
                smsByo:      u.smsByo,
                email:       capped ? monthEmail.get(u.tenantId) ?? 0 : u.email,
                emailByo:    u.emailByo,
                r2Bytes:     u.r2Bytes,
                caps:        capped ? FREE_TIER_CAPS : null,
                period:      capped ? window : null,
            };
        });

        return c.json({ success: true, data });
    } catch (error: unknown) {
        logger.error('usage aggregation failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
}
