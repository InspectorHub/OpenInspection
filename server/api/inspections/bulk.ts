// Dashboard, list, inspectors, bulk update, counts, schedule + sync conflicts sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability, capabilitiesFor } from '../../lib/middleware/require-capability';
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
import { inspections as inspectionTable } from '../../lib/db/schema';
import { syncInspectionAssignmentsBatch } from '../../lib/db/assignment-links';
import { findScheduleConflicts } from '../../lib/schedule-conflicts';
import { refuseCancelViaStatusWrite, refuseLeaveCancelledViaStatusWrite } from './cancel-write-path';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { eq, inArray, and } from 'drizzle-orm';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import { safeISODate } from '../../lib/date';

/**
 * `getDashboardBuckets` hands back raw `inspections` rows, whose `created_at` /
 * `confirmed_at` are `timestamp_ms` columns — drizzle materialises them as `Date`
 * instances. `DashboardResponseSchema` says those two fields are ISO strings, and
 * the schema is the one telling the truth: it is the published OpenAPI/MCP
 * contract, `app/lib/dashboard-schema.ts` declares `confirmedAt?: string | null`,
 * and JSON has no Date — `JSON.stringify` was already emitting exactly
 * `Date#toISOString()` on the wire. So the handler was the wrong side: it fed
 * `c.json()` a value the response type never described.
 *
 * Serialising here (per the D1 date-safety rule in CLAUDE.md) is byte-identical
 * on the wire — `safeISODate(Date)` IS `toISOString()`. `null` is passed through
 * rather than run through `safeISODate`, which would turn it into `''` and
 * genuinely change the payload.
 */
const toWireDates = <T extends { createdAt: Date; confirmedAt: Date | null }>(rows: T[]) =>
    rows.map((row) => ({
        ...row,
        createdAt:   safeISODate(row.createdAt),
        confirmedAt: row.confirmedAt === null ? null : safeISODate(row.confirmedAt),
    }));

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
    description: "Returns the inspection dashboard in one response, as buckets of inspections for the whole company (not filtered to the caller): needsAttention, today, thisWeek (after today through 7 days ahead), later (beyond 7 days, capped at the first 50, with laterTotal giving the full count), recentReports (completed with a published report) and cancelled (cancelled in the last 30 days judged by creation time, at most 20). The today, thisWeek and later buckets exclude cancelled inspections. Each row carries defect counts, agent name and status flags. Also returns conciergePending, the number of agent bookings awaiting inspector approval (0 if that lookup fails), and defectAggregate. needsAttention uses the company's attention thresholds (see the attention thresholds route). Dates are compared as UTC calendar days. Read-only. Available to owner, manager and inspector roles."
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
        query: InspectionListQuerySchema,
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: InspectionListResponseSchema,
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
    // The assignee picker's data source: it lists every account's email and role,
    // so it is gated like the writes it feeds (bulk reassign, schedule).
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('scheduleOthers')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().openapi({ example: true }),
                        data: z.array(z.object({
                            id: z.string(),
                            email: z.string(),
                            role: z.string(),
                            // Handler returns raw service rows; createdAt is a Date instance.
                            createdAt: z.date(),
                        })),
                    }),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listInspectionInspectors",
    description: "Lists every user account of the company, not only users with the inspector role, for assignee pickers: id, email, role, creation time, and whether a calendar is connected and when it last synced. Owners, managers and inspectors are all included; pending invitations are not. Not paginated. Read-only. Available to owner and manager roles, and to inspectors who have been granted the scheduleOthers capability; other inspectors get 403."
}, { scopes: ['read'], tier: 'extended', capability: 'scheduleOthers' }));

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
                    schema: BulkInspectionSchema.describe('The inspections to change, the action to apply to all of them, and the inspector or status that action needs.'),
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
                    schema: createApiResponseSchema(z.object({ count: z.number() })),
                },
            },
            description: 'Success',
        },
        400: { description: 'Missing action argument; a request to cancel — cancellation is writable only through POST /{id}/cancel, one inspection at a time, so the fee and refund cannot be skipped (#78); or a batch containing an already-cancelled inspection, which only POST /{id}/uncancel may move (#81)' },
    },
    operationId: "bulkInspection"
}, { scopes: ['write'], tier: 'extended', capability: 'scheduleOthers' }));

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
    description: "Returns six counts across all of the company's inspections for the list tabs: all; today (scheduled date is today, UTC); upcoming (dated after today and not completed or cancelled); past (dated before today, or completed or cancelled); needsConfirmation (status scheduled or requested); awaitingReport (completed with the report not yet published). Cancelled inspections are counted in all and past. The tab counts overlap, so they do not sum to all. Read-only. Available to owner, manager and inspector roles."
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
    description: "IA-6 — advisory same-day-hour collision check counting lead and helper assignments, for the inspector named by inspectorId (default: the caller). Returns the colliding inspections' ids, property addresses and dates. Callers render a warning; scheduling is never blocked. Available to owner, manager and inspector roles; checking an inspector other than yourself requires owner or manager, or an inspector granted the scheduleOthers capability, and other inspectors get 403.",
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
        return c.json({
            success: true,
            data: {
                ...buckets,
                needsAttention: toWireDates(buckets.needsAttention),
                today:          toWireDates(buckets.today),
                thisWeek:       toWireDates(buckets.thisWeek),
                later:          toWireDates(buckets.later),
                recentReports:  toWireDates(buckets.recentReports),
                cancelled:      toWireDates(buckets.cancelled),
                conciergePending,
            },
        });
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
        const db = getDrizzle(c);

        if (body.action === 'assignInspector') {
            if (!body.inspectorId) throw Errors.BadRequest('inspectorId is required for assignInspector.');
            // DB-8: fetch team fields BEFORE the update so the link-table mirror
            // carries the ids being reassigned.
            const affected = await db.select({
                id: inspectionTable.id,
            }).from(inspectionTable)
                .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)))
                .all();
            await db.update(inspectionTable).set({ inspectorId: body.inspectorId })
                .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)));
            // DB-8: re-sync the link table for each reassigned inspection. B-29:
            // one db.batch round trip for all N resyncs (was a 2N-statement loop).
            const inspectorId = body.inspectorId;
            await syncInspectionAssignmentsBatch(db, tenantId,
                affected.map(row => ({ inspectionId: row.id, inspectorId })));

            auditFromContext(c, 'inspection.bulk_assign', 'inspection', {
                metadata: { ids: body.ids, inspectorId: body.inspectorId },
            });
        } else {
            if (!body.status) throw Errors.BadRequest('status is required for updateStatus.');

            // #78 — the surface the cancel route's own comment predicted. A
            // bulk cancel is not one confirmation covering N jobs: each has its
            // own price, its own notice window and its own fee, so there is no
            // single figure a caller could have acknowledged. See
            // ./cancel-write-path.
            const cancelRefusal = refuseCancelViaStatusWrite(body.status);
            if (cancelRefusal) return c.json({ success: false as const, error: cancelRefusal }, 400);

            // #81 — and the other direction, which was the WORSE of the two here.
            // This write never consulted the row it was overwriting, so a bulk
            // move of a cancelled inspection back to `scheduled` left
            // `cancel_reason = 'no_show'` attached to a live job: the one lie the
            // single PATCH went out of its way to prevent. Recovery is
            // per-inspection anyway — it is a decision about one mis-click, not a
            // batch operation — so the whole batch is refused rather than the
            // cancelled members silently skipped.
            const stuck = await db.select({ id: inspectionTable.id }).from(inspectionTable)
                .where(and(
                    inArray(inspectionTable.id, body.ids),
                    eq(inspectionTable.tenantId, tenantId),
                    eq(inspectionTable.status, INSPECTION_STATUS.CANCELLED),
                ))
                .limit(1).get();
            const leaveRefusal = refuseLeaveCancelledViaStatusWrite(
                stuck ? INSPECTION_STATUS.CANCELLED : null,
            );
            if (leaveRefusal) return c.json({ success: false as const, error: leaveRefusal }, 400);

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
        const db = getDrizzle(c);
        // Solo wizard flow sends no inspectorId — the inspection will be
        // assigned to the creator, so that is who we check against.
        const callerId = c.get('user').sub;
        const targetId = inspectorId || callerId;
        // Another inspector's schedule (their addresses and dates) is the same
        // "act on others' bookings" verb the assignee picker and bulk reassign gate
        // on. Checking yourself is the wizard's own flow and stays open to all.
        if (targetId !== callerId && !(await capabilitiesFor(c)).scheduleOthers) {
            throw Errors.Forbidden("Requires the 'scheduleOthers' capability to check another inspector's schedule");
        }
        const conflicts = await findScheduleConflicts(db, tenantId, targetId, date, excludeId);
        return c.json({ success: true, data: { conflicts } }, 200);
    });

export default bulkRoutes;
