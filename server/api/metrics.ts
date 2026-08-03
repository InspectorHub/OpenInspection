import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { MetricsQuerySchema, MetricsApiResponseSchema } from '../lib/validations/metrics.schema';
import { inspections, inspectionServices, contacts, users, reportVersions, inspectionInspectors } from '../lib/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { sumEffectivePriceCentsSql } from '../lib/effective-price.sql';
import { inclusiveUpperBound, resolveMetricsWindow } from '../lib/metrics-window';
import { getDrizzle } from '../lib/route-helpers';

const metricsRoutes = createApiRouter()
    .openapi(createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["metrics"],
    middleware: [requireRole('owner', 'manager')] as const,
    request: { query: MetricsQuerySchema.describe('Inclusive civil-date window the figures cover.') },
    responses: { 200: { content: { 'application/json': { schema: MetricsApiResponseSchema.describe('Revenue, volume, agent, inspector and service aggregates for the window.') } }, description: 'Metrics' } },
    operationId: "listMetrics",
    summary: "List metrics for current tenant",
    description: "Revenue and volume aggregates over an inclusive `from`..`to` civil-date window: monthly series, top referring agents, per-inspector productivity, service mix, and paid/unpaid split. Omitting both bounds returns the trailing three months."
}, { scopes: ['read'], tier: 'extended' })), async (c) => {
    const tenantId = c.get('tenantId');
    const { from, to } = resolveMetricsWindow(c.req.valid('query'));
    const db = getDrizzle(c);

    // Both bounds are inclusive. `inspections.date` may hold a bare civil date
    // or a full ISO instant, so the upper bound carries a sentinel that sorts
    // after every time-of-day on that day — see inclusiveUpperBound.
    const inWindow = and(gte(inspections.date, from), lte(inspections.date, inclusiveUpperBound(to)));

    // Monthly revenue + count
    const monthly = await db.select({
        month:   sql<string>`strftime('%Y-%m', ${inspections.date})`,
        revenue: sumEffectivePriceCentsSql,
        count:   sql<number>`count(*)`,
    })
        .from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), inWindow))
        .groupBy(sql`strftime('%Y-%m', ${inspections.date})`)
        .orderBy(sql`strftime('%Y-%m', ${inspections.date})`);

    const totalRevenue     = monthly.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const totalInspections = monthly.reduce((s, r) => s + Number(r.count || 0), 0);
    const avgOrderValue    = totalInspections > 0 ? Math.round(totalRevenue / totalInspections) : 0;

    // Top referrers — attribution reads the explicit referred_by_contact_id
    // column (Task 9, two-layer role model), not the buyer_agent seat. Any
    // contact can be the referrer, so "agent" here means "referrer" and a
    // past client shows up under their own name.
    const topAgents = await db.select({
        agentId:   inspections.referredByContactId,
        agentName: contacts.name,
        count:     sql<number>`count(*)`,
        revenue:   sumEffectivePriceCentsSql,
    })
        .from(inspections)
        .leftJoin(contacts, and(
            eq(contacts.id, inspections.referredByContactId),
            eq(contacts.tenantId, inspections.tenantId),
        ))
        .where(and(
            eq(inspections.tenantId, tenantId),
            inWindow,
            sql`${inspections.referredByContactId} is not null`,
        ))
        .groupBy(inspections.referredByContactId)
        .orderBy(sql`count(*) desc`)
        .limit(10)
        .then(rows => rows.map(r => ({
            agentId:   r.agentId ?? null,
            agentName: r.agentName || r.agentId || 'Unknown',
            count:     Number(r.count),
            revenue:   Number(r.revenue || 0),
        })));

    // Service breakdown. Joined to inspections so it obeys the same window as
    // every other figure here — it used to filter on tenant alone, which was
    // invisible while nothing rendered it (IA-82) and would now read as an
    // all-time card sitting inside a page about a chosen date range.
    const serviceBreakdown = await db.select({
        serviceName: inspectionServices.nameSnapshot,
        count:       sql<number>`count(*)`,
        revenue:     sql<number>`sum(coalesce(${inspectionServices.priceOverride}, ${inspectionServices.priceSnapshot}))`,
    })
        .from(inspectionServices)
        .innerJoin(inspections, and(
            eq(inspections.id, inspectionServices.inspectionId),
            eq(inspections.tenantId, inspectionServices.tenantId),
        ))
        // Soft-deleted lines are history; revenue must not count them.
        .where(and(eq(inspectionServices.tenantId, tenantId), eq(inspectionServices.active, true), inWindow))
        .groupBy(inspectionServices.nameSnapshot)
        .orderBy(sql`count(*) desc`)
        .limit(10);

    // Payment summary
    const paymentSummary = await db.select({
        status:  inspections.paymentStatus,
        revenue: sumEffectivePriceCentsSql,
    })
        .from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), inWindow))
        .groupBy(inspections.paymentStatus);

    const paidAmt   = Number(paymentSummary.find(r => r.status === 'paid')?.revenue ?? 0);
    const unpaidAmt = Number(paymentSummary.find(r => r.status === 'unpaid')?.revenue ?? 0);

    // Per-inspector productivity (IA-63) — multi-inspector companies need count,
    // revenue, and turnaround per inspector for team management + commission.
    // "Who did this inspection" authority: the ROSTER's lead row. It used to be
    // coalesce(lead_inspector_id, inspector_id), which agreed with everything
    // else only because lead_inspector_id is NULL on every row — the first write
    // of a lead would have made these numbers disagree with the rest of the app.
    //
    // Joined on role = 'lead' deliberately, NOT the whole roster: grouping over
    // every link row would count an inspection once per assigned person and
    // double its revenue the moment a job has a helper. One inspection is
    // attributed to one person here; this change moves the SOURCE, not the
    // meaning. Turnaround =
    // first publish (report_versions v1 published_at) − inspection date, in days;
    // the LEFT JOIN keeps unpublished inspections in the count while avg() skips
    // their NULL turnaround (so an all-unpublished inspector reports null, not 0).
    // Explicit column projection keeps well under D1's 100-column result cap.
    const inspectorKey = inspectionInspectors.userId;
    const byInspector = await db.select({
        inspectorId:       inspectorKey,
        inspectorName:     users.name,
        count:             sql<number>`count(*)`,
        revenue:           sumEffectivePriceCentsSql,
        avgTurnaroundDays: sql<number | null>`avg(julianday(${reportVersions.publishedAt} / 1000.0, 'unixepoch') - julianday(${inspections.date}))`,
    })
        .from(inspections)
        .leftJoin(reportVersions, and(
            eq(reportVersions.inspectionId, inspections.id),
            eq(reportVersions.tenantId, inspections.tenantId),
            eq(reportVersions.versionNumber, 1),
        ))
        .leftJoin(inspectionInspectors, and(
            eq(inspectionInspectors.inspectionId, inspections.id),
            eq(inspectionInspectors.tenantId, inspections.tenantId),
            eq(inspectionInspectors.role, 'lead'),
        ))
        .leftJoin(users, eq(users.id, inspectorKey))
        .where(and(
            eq(inspections.tenantId, tenantId),
            inWindow,
            sql`${inspectorKey} is not null`,
        ))
        .groupBy(inspectorKey)
        .orderBy(sql`count(*) desc`)
        .limit(50)
        .then(rows => rows.map(r => ({
            inspectorId:       r.inspectorId ?? null,
            inspectorName:     r.inspectorName || r.inspectorId || 'Unknown',
            count:             Number(r.count),
            revenue:           Number(r.revenue || 0),
            avgTurnaroundDays: r.avgTurnaroundDays == null ? null : Math.round(Number(r.avgTurnaroundDays) * 10) / 10,
        })));

    return c.json({
        success: true,
        data: {
            from,
            to,
            totalRevenue,
            totalInspections,
            avgOrderValue,
            monthly: monthly.map(r => ({ month: r.month, revenue: Number(r.revenue || 0), count: Number(r.count) })),
            topAgents,
            byInspector,
            serviceBreakdown: serviceBreakdown.map(r => ({
                serviceName: r.serviceName,
                count:       Number(r.count),
                revenue:     Number(r.revenue || 0),
            })),
            paymentSummary: { paid: paidAmt, unpaid: unpaidAmt, overdue: 0 },
        },
    });
});

export type MetricsApi = typeof metricsRoutes;
export default metricsRoutes;
