import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { MetricsQuerySchema, MetricsApiResponseSchema } from '../lib/validations/metrics.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections, inspectionServices, contacts, inspectionPeople, contactRoleProfiles, users, reportVersions } from '../lib/db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const metricsRoutes = createApiRouter()
    .openapi(createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["metrics"],
    middleware: [requireRole('owner', 'manager')] as const,
    request: { query: MetricsQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: { 200: { content: { 'application/json': { schema: MetricsApiResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Metrics' } },
    operationId: "listMetrics",
    summary: "List metrics for current tenant",
    description: "Auto-generated placeholder for listMetrics (GET /, metrics domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' })), async (c) => {
    const tenantId = c.get('tenantId');
    const { period } = c.req.valid('query');
    const db = drizzle(c.env.DB);

    const months = period === '3m' ? 3 : period === '6m' ? 6 : 12;
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - months);
    const fromStr = fromDate.toISOString().slice(0, 10);

    // Monthly revenue + count
    const monthly = await db.select({
        month:   sql<string>`strftime('%Y-%m', ${inspections.date})`,
        revenue: sql<number>`sum(${inspections.price})`,
        count:   sql<number>`count(*)`,
    })
        .from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), gte(inspections.date, fromStr)))
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
        revenue:   sql<number>`sum(${inspections.price})`,
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
            gte(inspections.date, fromStr),
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

    // Service breakdown
    const serviceBreakdown = await db.select({
        serviceName: inspectionServices.nameSnapshot,
        count:       sql<number>`count(*)`,
        revenue:     sql<number>`sum(${inspectionServices.priceSnapshot})`,
    })
        .from(inspectionServices)
        .where(eq(inspectionServices.tenantId, tenantId))
        .groupBy(inspectionServices.nameSnapshot)
        .orderBy(sql`count(*) desc`)
        .limit(10);

    // Payment summary
    const paymentSummary = await db.select({
        status:  inspections.paymentStatus,
        revenue: sql<number>`sum(${inspections.price})`,
    })
        .from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), gte(inspections.date, fromStr)))
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
        revenue:           sql<number>`sum(${inspections.price})`,
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
            gte(inspections.date, fromStr),
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
            period,
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
