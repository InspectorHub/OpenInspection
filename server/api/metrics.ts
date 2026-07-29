import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { MetricsQuerySchema, MetricsApiResponseSchema } from '../lib/validations/metrics.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections, inspectionServices, contacts, inspectionPeople, contactRoleProfiles, users, reportVersions } from '../lib/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { sumEffectivePriceCentsSql } from '../lib/effective-price.sql';
import { inclusiveUpperBound, resolveMetricsWindow } from '../lib/metrics-window';

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
    const db = drizzle(c.env.DB);

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

    // Top agents — single JOIN query instead of N+1. Buyer's-agent
    // attribution via inspection_people (role buyer_agent) — contact_role_profiles
    // is joined before inspection_people so the join stays scoped to
    // buyer_agent only (joining inspection_people first would fan out over
    // every role on the inspection). The old "referredByAgentId is not null"
    // filter is now implicit: an inspection with no buyer_agent
    // inspection_people row simply has no matching row to group on.
    const topAgents = await db.select({
        agentId:   inspectionPeople.contactId,
        agentName: contacts.name,
        count:     sql<number>`count(*)`,
        revenue:   sumEffectivePriceCentsSql,
    })
        .from(inspections)
        .leftJoin(contactRoleProfiles, and(
            eq(contactRoleProfiles.tenantId, inspections.tenantId),
            eq(contactRoleProfiles.key, 'buyer_agent'),
            eq(contactRoleProfiles.active, true),
        ))
        .leftJoin(inspectionPeople, and(
            eq(inspectionPeople.roleProfileId, contactRoleProfiles.id),
            eq(inspectionPeople.inspectionId, inspections.id),
            eq(inspectionPeople.tenantId, inspections.tenantId),
        ))
        .leftJoin(contacts, and(
            eq(contacts.id, inspectionPeople.contactId),
            eq(contacts.tenantId, inspections.tenantId),
        ))
        .where(and(
            eq(inspections.tenantId, tenantId),
            inWindow,
            sql`${inspectionPeople.contactId} is not null`,
        ))
        .groupBy(inspectionPeople.contactId)
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
        .where(and(eq(inspectionServices.tenantId, tenantId), inWindow))
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
    // "Who did this inspection" authority: lead_inspector_id, falling back to
    // inspector_id (schema: lead is primary, NULL ⇒ inspector_id). Turnaround =
    // first publish (report_versions v1 published_at) − inspection date, in days;
    // the LEFT JOIN keeps unpublished inspections in the count while avg() skips
    // their NULL turnaround (so an all-unpublished inspector reports null, not 0).
    // Explicit column projection keeps well under D1's 100-column result cap.
    const inspectorKey = sql<string>`coalesce(${inspections.leadInspectorId}, ${inspections.inspectorId})`;
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
