// Dashboard, list, inspectors, bulk update, counts, schedule + sync conflicts sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies are
// byte-identical to the original (only the dynamic-import path depth changed).
import {
    Errors,
    and,
    auditFromContext,
    bulkUpdateRoute,
    createApiRouter,
    dashboardRoute,
    drizzle,
    eq,
    findScheduleConflicts,
    getCountsRoute,
    inArray,
    inspectionTable,
    listConflictsRoute,
    listInspectionsRoute,
    listInspectorsRoute,
    listPendingConflicts,
    logger,
    resolveConflicts,
    resolveConflictsRoute,
    scheduleConflictsRoute,
    syncInspectionAssignmentsBatch,
} from './_shared';

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
    })
    .openapi(listConflictsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');

        // Ownership guard — 404 on tenant mismatch keeps the enumeration leak closed.
        try {
            await c.var.services.inspection.getInspection(id, tenantId);
        } catch {
            throw Errors.NotFound('Inspection not found');
        }

        const db = drizzle(c.env.DB);
        const data = await listPendingConflicts(db, tenantId, id);
        return c.json({ success: true as const, data }, 200);
    })
    // Typed-Hono dead-routes cleanup Task 13 — clear adjudicated conflicts.
    .openapi(resolveConflictsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { resolutions } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!userId) throw Errors.Unauthorized('Missing user identity');

        try {
            await c.var.services.inspection.getInspection(id, tenantId);
        } catch {
            throw Errors.NotFound('Inspection not found');
        }

        const db = drizzle(c.env.DB);
        const data = await resolveConflicts(db, tenantId, id, resolutions);
        auditFromContext(c, 'inspection.conflicts_resolved', 'inspection', {
            entityId: id, metadata: { resolved: data.resolved, by: userId },
        });
        return c.json({ success: true as const, data }, 200);
    });

export default bulkRoutes;
