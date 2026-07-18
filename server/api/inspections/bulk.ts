// Dashboard, list, inspectors, bulk update, counts, schedule + sync conflicts sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import { auditFromContext } from '../../lib/audit';
import { logger } from '../../lib/logger';
import { Errors } from '../../lib/errors';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import {
    InspectionListQuerySchema,
    BulkInspectionSchema,
    InspectionListResponseSchema,
    InspectionCountsSchema,
    DashboardResponseSchema,
} from '../../lib/validations/inspection.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections as inspectionTable } from '../../lib/db/schema';
import { syncInspectionAssignmentsBatch } from '../../lib/db/assignment-links';
import { findScheduleConflicts } from '../../lib/schedule-conflicts';
import { eq, inArray, and } from 'drizzle-orm';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

// --- GET /api/inspections/dashboard — Spec 3A ---
const dashboardRoute = createRoute(withMcpMetadata({
    method: 'get',
    path:   '/dashboard',
    tags: ["inspections"],
    summary: 'Bucketed inspections for dashboard',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(DashboardResponseSchema) } },
            description: 'Dashboard buckets',
        },
    },
    operationId: "dashboardInspection",
    description: "Auto-generated placeholder for dashboardInspection (GET /dashboard, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * GET /api/inspections
 * List inspections with pagination and stats.
 */
const listInspectionsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/',
    tags: ["inspections"],
    summary: "List inspections for current tenant",
    description: 'Retrieve a paginated list of inspections with optional filtering.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        query: InspectionListQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: InspectionListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listInspections"
}, { scopes: ['read'], tier: 'primary' }));

/**
 * GET /api/inspections/inspectors
 */
const listInspectorsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspectors',
    tags: ["inspections"],
    summary: "List inspection inspectors for current tenant",
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().openapi({ example: true }).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.array(z.object({
                            id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
                            email: z.string().describe('TODO describe email field for the OpenInspection MCP integration'),
                            role: z.string().describe('TODO describe role field for the OpenInspection MCP integration'),
                            // Handler returns raw service rows; createdAt is a Date instance.
                            createdAt: z.date().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
                        })).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listInspectionInspectors",
    description: "Auto-generated placeholder for listInspectionInspectors (GET /inspectors, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * PATCH /api/inspections/bulk
 */
const bulkUpdateRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/bulk',
    tags: ["inspections"],
    summary: "Bulk inspection for current tenant",
    description: "Perform mass operations on multiple inspections. (PATCH /bulk, inspections domain).",
    request: {
        body: {
            content: {
                'application/json': {
                    schema: BulkInspectionSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    // Task 10 — bulk assignInspector is the canonical "schedule a DIFFERENT
    // inspector" mutation, so the scheduleOthers capability gates this route.
    // owner/admin always pass; an inspector only passes with an explicit
    // {scheduleOthers:true} override. NOTE: this route also serves the
    // updateStatus bulk action, which is correspondingly gated (acceptable —
    // bulk status changes are an admin-grade operation).
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('scheduleOthers')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ count: z.number().describe('TODO describe count field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Success',
        },
    },
    operationId: "bulkInspection"
}, { scopes: ['write'], tier: 'extended' }));

/**
 * GET /api/inspections/counts
 */
const getCountsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/counts',
    tags: ["inspections"],
    summary: 'Get inspection tab counts',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(InspectionCountsSchema) } },
            description: 'Tab counts',
        },
    },
    operationId: "countsInspection",
    description: "Auto-generated placeholder for countsInspection (GET /counts, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// IA-6 — GET /api/inspections/schedule-conflicts
// MUST be registered before /{id} to avoid 'schedule-conflicts' matching as an id param.
const scheduleConflictsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/schedule-conflicts',
    tags: ['inspections'],
    summary: 'Detect same-day-hour assignment conflicts for an inspector',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        query: z.object({
            inspectorId: z.string().min(1).optional().describe('Inspector user id to check; defaults to the caller (solo wizard flow assigns the creator).'),
            date: z.string().min(1).describe('Proposed date/time — ISO datetime or YYYY-MM-DD.'),
            excludeId: z.string().optional().describe('Inspection id being rescheduled; excluded from collision results.'),
        }).describe('Conflict query'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().describe('Whether the request succeeded'),
                        data: z.object({
                            conflicts: z.array(z.object({
                                inspectionId: z.string().describe('Colliding inspection id'),
                                propertyAddress: z.string().describe('Colliding inspection address'),
                                date: z.string().describe('Colliding inspection date'),
                            })).describe('Same-day-hour collisions for this inspector'),
                        }).describe('Conflict payload'),
                    }).describe('Conflict response'),
                },
            },
            description: 'Success',
        },
    },
    operationId: 'getScheduleConflicts',
    description: 'IA-6 — advisory same-day-hour collision check counting lead and helper assignments. Callers render a warning; scheduling is never blocked.',
}, { scopes: ['read'], tier: 'extended' }));

const bulkRoutes = createApiRouter()
    .openapi(dashboardRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const buckets  = await c.var.services.inspection.getDashboardBuckets(tenantId);
        // Agent Accounts A3 — count concierge bookings awaiting this inspector's
        // approval so the dashboard's UPCOMING card can render the substate line.
        let conciergePending = 0;
        try {
            const result = await c.var.services.concierge.listAwaitingInspector(tenantId);
            conciergePending = result.count;
        } catch (err) {
            logger.warn('inspections.dashboard.concierge.failed', {
                tenantId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        return c.json({ success: true, data: { ...buckets, conciergePending } });
    })
    .openapi(listInspectionsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const params = c.req.valid('query');
        const service = c.var.services.inspection;

        // Filter undefined values for exactOptionalPropertyTypes compliance
        const serviceParams = Object.fromEntries(
            Object.entries(params).filter(([_, v]) => v !== undefined)
        ) as typeof params;

        const result = await service.listInspections(tenantId, serviceParams);

        // Add stats on the first page
        let counts;
        if (!params.cursor) {
            counts = await service.getStats(tenantId);
        }

        return c.json({
            success: true,
            data: result.inspections,
            meta: {
                nextCursor: result.nextCursor,
                counts
            }
        }, 200);
    })
    .openapi(listInspectorsRoute, async (c) => {
        const service = c.var.services.admin;
        const { members } = await service.getMembers(c.get('tenantId'));
        return c.json({ success: true, data: members }, 200);
    })
    .openapi(bulkUpdateRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const db = drizzle(c.env.DB);

        if (body.action === 'assignInspector') {
            if (!body.inspectorId) throw Errors.BadRequest('inspectorId is required for assignInspector.');
            // DB-8: fetch team fields BEFORE the update so the link-table mirror
            // carries ALL canonical assignment columns (preserves team-mode lead/
            // helpers that bulk-assign cannot change).
            const affected = await db.select({
                id:                 inspectionTable.id,
                leadInspectorId:    inspectionTable.leadInspectorId,
                helperInspectorIds: inspectionTable.helperInspectorIds,
            }).from(inspectionTable)
                .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)))
                .all();
            await db.update(inspectionTable).set({ inspectorId: body.inspectorId })
                .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)));
            // DB-8: re-sync the link table for each reassigned inspection, preserving
            // team-mode rows that this bulk operation cannot change. B-29: one
            // db.batch round trip for all N resyncs (was a 2N-statement loop).
            const inspectorId = body.inspectorId;
            await syncInspectionAssignmentsBatch(db, tenantId, affected.map(row => {
                let helpers: string[] = [];
                try { helpers = JSON.parse(row.helperInspectorIds ?? '[]'); } catch { /* malformed legacy JSON */ }
                return {
                    inspectionId:       row.id,
                    inspectorId,
                    leadInspectorId:    row.leadInspectorId,
                    helperInspectorIds: helpers,
                };
            }));

            auditFromContext(c, 'inspection.bulk_assign', 'inspection', {
                metadata: { ids: body.ids, inspectorId: body.inspectorId },
            });
        } else {
            if (!body.status) throw Errors.BadRequest('status is required for updateStatus.');
            await db.update(inspectionTable).set({ status: body.status })
                .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)));

            auditFromContext(c, 'inspection.bulk_status', 'inspection', {
                metadata: { ids: body.ids, status: body.status },
            });
        }

        return c.json({ success: true, data: { count: body.ids.length } }, 200);
    })
    .openapi(getCountsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const counts = await c.var.services.inspection.getCounts(tenantId);
        return c.json({ success: true, data: counts });
    })
    // IA-6 — advisory schedule conflict check; placed before /{id} to prevent
    // 'schedule-conflicts' being matched as a param value.
    .openapi(scheduleConflictsRoute, async (c) => {
        const { inspectorId, date, excludeId } = c.req.valid('query');
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);
        // Solo wizard flow sends no inspectorId — the inspection will be
        // assigned to the creator, so that is who we check against.
        const targetId = inspectorId || c.get('user').sub;
        const conflicts = await findScheduleConflicts(db, tenantId, targetId, date, excludeId);
        return c.json({ success: true, data: { conflicts } }, 200);
    });

export default bulkRoutes;
