// GET /api/metrics — the reporting surface.
//
// The gate is `requireRole('owner', 'manager', 'inspector')` plus row scoping
// inside the handler, not a capability on the route: an inspector may see a
// single-row view of THEMSELVES (own pay, own counts, own turnaround) and none
// of the company's money. That is the same third state the pay-split routes
// implement — `financial: false` AND `subject = self` — and no boolean
// permission expresses it. A caller without `financial` gets the company
// aggregates as NULL rather than as zero: zero is a claim about the business,
// null says "not yours to see".
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { capabilitiesFor } from '../lib/middleware/require-capability';
import { MetricsQuerySchema, MetricsApiResponseSchema } from '../lib/validations/metrics.schema';
import { inspections, inspectionServices, contacts } from '../lib/db/schema';
import { perInspectorMetrics } from '../services/metrics/inspector-metrics';
import { eq, and, gte, lte, sql } from 'drizzle-orm';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { sumEffectivePriceCentsSql } from '../lib/effective-price.sql';
import { inclusiveUpperBound, resolveMetricsWindow } from '../lib/metrics-window';
import { getDrizzle } from '../lib/route-helpers';

const metricsRoutes = createApiRouter()
    .openapi(createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["metrics"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { query: MetricsQuerySchema.describe('Inclusive civil-date window the figures cover.') },
    responses: { 200: { content: { 'application/json': { schema: MetricsApiResponseSchema.describe('Revenue, volume, agent, inspector and service aggregates for the window.') } }, description: 'Metrics' } },
    operationId: "listMetrics",
    summary: "List metrics for current tenant",
    description: "Revenue and volume aggregates over an inclusive `from`..`to` civil-date window: monthly series, referral sources, per-inspector pay and attributed revenue, service mix, and paid/unpaid split. A caller without the financial capability receives only their own inspector row and null company figures. Omitting both bounds returns the trailing three months."
}, { scopes: ['read'], tier: 'extended' })), async (c) => {
    const tenantId = c.get('tenantId');
    const { from, to } = resolveMetricsWindow(c.req.valid('query'));
    const db = getDrizzle(c);
    const caps = await capabilitiesFor(c);
    const self = c.get('user')?.sub ?? '';

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
            kind:      'contact' as const,
            count:     Number(r.count),
            revenue:   Number(r.revenue || 0),
        })));

    // The coarse bucket. `referred_by_contact_id` is the precise axis — a real
    // contact row — and `referral_source` is free text ("Google", "repeat
    // client"). They are different KINDS of answer, so they are not merged into
    // one column; but the contact-keyed query filters `is not null`, which
    // silently DROPPED every source-only row, and for a one-person firm those
    // are usually the only rows there are. "Who sends me work" is the single
    // number a solo tenant can act on next month.
    const referralSources = await db.select({
        source:  inspections.referralSource,
        count:   sql<number>`count(*)`,
        revenue: sumEffectivePriceCentsSql,
    })
        .from(inspections)
        .where(and(
            eq(inspections.tenantId, tenantId),
            inWindow,
            sql`${inspections.referredByContactId} is null`,
            sql`coalesce(trim(${inspections.referralSource}), '') <> ''`,
        ))
        .groupBy(inspections.referralSource)
        .orderBy(sql`count(*) desc`)
        .limit(10)
        .then(rows => rows.map(r => ({
            agentId:   null,
            agentName: r.source ?? 'Unknown',
            kind:      'source' as const,
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

    // Per-inspector: counts split lead/helper, PAY and ATTRIBUTED REVENUE as two
    // labelled figures, and a MEDIAN turnaround with its basis. See
    // services/metrics/inspector-metrics.ts for why each of those is the shape
    // it is — the reasoning is long and belongs next to the arithmetic.
    const everyInspector = await perInspectorMetrics(db, tenantId, { from, to });

    // The scoping rule, and the reason it is here rather than in a redactor: a
    // caller without `financial` is not being shown a censored version of the
    // company's numbers, they are being shown THEIR OWN row. A colleague's pay
    // is absent from the payload, not hidden inside it.
    const byInspector = caps.financial
        ? everyInspector
        : everyInspector
            .filter(r => r.inspectorId === self)
            // Attributed revenue is the company's side of the line. Pay is not.
            .map(r => ({ ...r, attributedRevenueCents: null }));

    return c.json({
        success: true,
        data: {
            from,
            to,
            scope: caps.financial ? ('all' as const) : ('self' as const),
            totalRevenue: caps.financial ? totalRevenue : null,
            totalInspections,
            avgOrderValue: caps.financial ? avgOrderValue : null,
            monthly: caps.financial
                ? monthly.map(r => ({ month: r.month, revenue: Number(r.revenue || 0), count: Number(r.count) }))
                : [],
            // "Which agent sends the most work" is commercially sensitive in a
            // multi-inspector firm — same gate as attributed revenue.
            topAgents: caps.financial ? [...topAgents, ...referralSources] : [],
            byInspector,
            serviceBreakdown: caps.financial
                ? serviceBreakdown.map(r => ({
                    serviceName: r.serviceName,
                    count:       Number(r.count),
                    revenue:     Number(r.revenue || 0),
                }))
                : [],
            paymentSummary: caps.financial ? { paid: paidAmt, unpaid: unpaidAmt, overdue: 0 } : null,
        },
    });
});

export type MetricsApi = typeof metricsRoutes;
export default metricsRoutes;
