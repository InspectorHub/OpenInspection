import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { HonoConfig } from '../types/hono';
import { MetricsQuerySchema, MetricsApiResponseSchema } from '../lib/validations/metrics.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections, inspectionServices, contacts } from '../lib/db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';

const metricsRoutes = new OpenAPIHono<HonoConfig>();

metricsRoutes.openapi(createRoute({
    method: 'get', path: '/',
    tags: ['Metrics'],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { query: MetricsQuerySchema },
    responses: { 200: { content: { 'application/json': { schema: MetricsApiResponseSchema } }, description: 'Metrics' } },
}), async (c) => {
    const tenantId = c.get('tenantId');
    const { period } = c.req.valid('query');
    const db = drizzle(c.env.DB as any);

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

    // Top agents — single JOIN query instead of N+1
    const topAgents = await db.select({
        agentId:   inspections.referredByAgentId,
        agentName: contacts.name,
        count:     sql<number>`count(*)`,
        revenue:   sql<number>`sum(${inspections.price})`,
    })
        .from(inspections)
        .leftJoin(contacts, and(
            eq(contacts.id, inspections.referredByAgentId),
            eq(contacts.tenantId, inspections.tenantId),
        ))
        .where(and(
            eq(inspections.tenantId, tenantId),
            gte(inspections.date, fromStr),
            sql`${inspections.referredByAgentId} is not null`,
        ))
        .groupBy(inspections.referredByAgentId)
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

    return c.json({
        success: true,
        data: {
            period,
            totalRevenue,
            totalInspections,
            avgOrderValue,
            monthly: monthly.map(r => ({ month: r.month, revenue: Number(r.revenue || 0), count: Number(r.count) })),
            topAgents,
            serviceBreakdown: serviceBreakdown.map(r => ({
                serviceName: r.serviceName,
                count:       Number(r.count),
                revenue:     Number(r.revenue || 0),
            })),
            paymentSummary: { paid: paidAmt, unpaid: unpaidAmt, overdue: 0 },
        },
    });
});

export default metricsRoutes;
