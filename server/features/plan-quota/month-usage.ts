import { drizzle } from 'drizzle-orm/d1';
import { and, count, eq, gte } from 'drizzle-orm';
import { inspections, tenants } from '../../lib/db/schema';
import { monthStartUtcMs } from '../../lib/usage/period';

/**
 * Inspections created in `now`'s UTC calendar month, per tenant: the figure the Free plan's cap is enforced against
 * (`PlanQuotaGuard.consumeInspection` counts the same rows). One predicate for every surface that REPORTS the number,
 * so a display cannot drift from the gate.
 *
 * `{ tenantId }` counts one tenant. `{ freeTenants: true }` counts every tenant on the free tier in a single grouped
 * query (no id list, so no bound-parameter ceiling); a tenant with none this month is simply absent from the map.
 */
export async function monthInspectionCounts(
    d1: D1Database,
    now: Date,
    scope: { tenantId: string } | { freeTenants: true },
): Promise<Map<string, number>> {
    const db = drizzle(d1);
    const since = gte(inspections.createdAt, new Date(monthStartUtcMs(now)));
    const rows = 'tenantId' in scope
        ? await db.select({ id: inspections.tenantId, n: count() }).from(inspections)
            .where(and(eq(inspections.tenantId, scope.tenantId), since)).groupBy(inspections.tenantId).all()
        : await db.select({ id: inspections.tenantId, n: count() }).from(inspections)
            .innerJoin(tenants, eq(tenants.id, inspections.tenantId))
            .where(and(eq(tenants.tier, 'free'), since)).groupBy(inspections.tenantId).all();
    return new Map(rows.map((r) => [r.id, r.n]));
}
