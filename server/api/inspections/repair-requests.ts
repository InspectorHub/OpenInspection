/**
 * #69 — the Repair Request Log: the inspection company's READ of the repair
 * request lists its clients and their agents built from a published report.
 *
 * Every other repair route lives on `/api/public` and authenticates a share
 * token, a portal token or an owner-preview JWT (`lib/repair-access.ts`). This
 * one does not: its caller is staff on an ordinary session, its answer spans
 * lists the caller did not author, and it must never be reachable with a token
 * a client could forward. So it sits under `/api/inspections`, behind the
 * global JWT gate and `requireRole`, and reads the tenant from the verified
 * claims — the URL's `:id` names the inspection, never the tenant.
 *
 * READ ONLY, and there is no sibling write. The industry answer is a log the
 * inspector goes and looks at: Spectora's RRB Log is view-only, and the
 * respondable flow the other vendor ships belongs to the buyer's agent, not to
 * the inspection company. A reply from the company on the buyer's own
 * negotiating document is a different product decision, not this endpoint's
 * missing half.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { getDrizzle, getTenantId } from '../../lib/route-helpers';
import { inspections } from '../../lib/db/schema';
import { isReportPublished } from '../../lib/status/report-status';
import { REPAIR_ACTION_TAGS } from '../../lib/repair-action-tag';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import type { RepairRequestWithItems } from '../../services/repair-request.service';

const LogItemSchema = z.object({
    id: z.string(),
    findingKey: z.string(),
    sectionTitle: z.string(),
    itemLabel: z.string(),
    defectTitleSnapshot: z.string().nullable(),
    locationSnapshot: z.string().nullable(),
    categorySnapshot: z.string().nullable(),
    tradeSnapshot: z.string().nullable(),
    commentSnapshot: z.string().nullable(),
    note: z.string().nullable(),
    requestedCreditCents: z.number().nullable(),
    repairActionTag: z.enum(REPAIR_ACTION_TAGS).nullable(),
});

const LogListSchema = z.object({
    id: z.string(),
    createdByKind: z.enum(['client', 'agent', 'inspector']),
    // WHO built the list, as `lib/repair-access.ts` resolved them — usually an
    // email address (see the column comment in schema/repair-request.ts). It is
    // the tenant's own client's address on the tenant's own inspection, which
    // staff already read on the people card; it is here because a log of
    // several lists is unusable if they cannot be told apart.
    createdByRef: z.string(),
    customIntro: z.string().nullable(),
    createdAt: z.number().describe('Epoch milliseconds.'),
    items: z.array(LogItemSchema),
});

const RepairRequestLogResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        propertyAddress: z.string().describe('The property address, for the page heading.'),
        published: z.boolean().describe('Whether the order\'s report is published. False means the log is withheld, not empty.'),
        lists: z.array(LogListSchema),
    }),
});

const repairRequestLogRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/repair-requests',
    tags: ['inspections'],
    summary: 'Repair Request Log: every repair list built from this order\'s report',
    // Same trio as the hub payload this page is entered from. An inspector who
    // may read the order may read what was asked of it: withholding the buyer's
    // ask from the person who wrote the finding it is about would leave them
    // answering questions about a document they cannot see.
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('Inspection identifier') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: RepairRequestLogResponseSchema } },
            description: 'The log, or `published: false` with no lists',
        },
        404: { description: 'Inspection not found in this tenant' },
    },
    operationId: 'getInspectionRepairRequestLog',
    description:
        'Returns every repair request list built for this order, newest first, each with the items on it — '
        + 'what the buyer or their agent asked for, what they wrote about it, and any credit they named. '
        + 'Read only. Withheld until the order\'s report is published, matching the client-facing builder that '
        + 'produces these lists: before publication no list can legitimately exist, so a log shown then would '
        + 'be reporting on a document nobody has been given.',
}, { scopes: ['read'], tier: 'extended' }));

const inspectionRepairRequestRoutes = createApiRouter()
    .openapi(repairRequestLogRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');

        const insp = await getDrizzle(c)
            .select({
                reportStatus: inspections.reportStatus,
                propertyAddress: inspections.propertyAddress,
            })
            .from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) {
            return c.json({ success: false as const, error: 'Inspection not found' }, 404);
        }

        // The publish gate, and it fails CLOSED: on the unpublished branch the
        // lists are never queried, so there is no ordering of later edits that
        // can leak one. Same predicate and same column as `runBuilderGate`, so
        // the surface that WRITES these lists and the surface that reads them
        // cannot disagree about when they exist.
        //
        // NOT also gated on `tenant_configs.enable_customer_repair_export`,
        // unlike the builder. That flag decides whether a client may build a
        // new list; a company that switches it off afterwards still owns the
        // asks already made of it, and hiding its own records behind a
        // feature toggle would look like data loss.
        if (!isReportPublished(insp.reportStatus)) {
            return c.json({
                success: true as const,
                data: {
                    propertyAddress: insp.propertyAddress,
                    published: false,
                    lists: [],
                },
            }, 200);
        }

        const rows: RepairRequestWithItems[] = await c.var.services.repairRequest.listForInspection(tenantId, id);

        return c.json({
            success: true as const,
            data: {
                propertyAddress: insp.propertyAddress,
                published: true,
                lists: rows.map((rr) => ({
                    id: rr.id,
                    createdByKind: rr.createdByKind,
                    createdByRef: rr.createdByRef,
                    customIntro: rr.customIntro,
                    createdAt: rr.createdAt instanceof Date ? rr.createdAt.getTime() : Number(rr.createdAt),
                    // An EXPLICIT projection, not a spread: `repair_requests`
                    // carries a live `share_token`, and spreading the row would
                    // put a bearer credential for the client's own list into a
                    // staff page's HTML the day someone adds a column.
                    items: rr.items.map((item) => ({
                        id: item.id,
                        findingKey: item.findingKey,
                        sectionTitle: item.sectionTitle,
                        itemLabel: item.itemLabel,
                        defectTitleSnapshot: item.defectTitleSnapshot,
                        locationSnapshot: item.locationSnapshot,
                        categorySnapshot: item.categorySnapshot,
                        tradeSnapshot: item.tradeSnapshot,
                        commentSnapshot: item.commentSnapshot,
                        note: item.note,
                        requestedCreditCents: item.requestedCreditCents,
                        repairActionTag: item.repairActionTag,
                    })),
                })),
            },
        }, 200);
    });

export default inspectionRepairRequestRoutes;
