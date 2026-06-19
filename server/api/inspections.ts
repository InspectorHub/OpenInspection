// Inspections API aggregator (incremental refactor in progress).
import {
    Errors,
    OBSERVER_COOKIE_NAME,
    aggregateAttachedRecommendations,
    aggregateRecommendationsRoute,
    and,
    applyResultsBatch,
    auditFromContext,
    autofillPropertyFactsRoute,
    cloneInspectionRoute,
    createApiRouter,
    createFromWizardRoute,
    createInspectionRoute,
    deleteInspectionRoute,
    drizzle,
    eq,
    getCookie,
    getInspectionRoute,
    getPropertyFactsRoute,
    getResultsRoute,
    inspectionInspectors,
    inspectionResults,
    inspectionTable,
    patchItemFieldRoute,
    preflightRoute,
    requireRole,
    resultsBatchRoute,
    switchRatingSystemRoute,
    syncInspectionAssignments,
    updateInspectionRoute,
    updatePropertyFactsRoute,
    updateResultsRoute,
    updateTemplateSnapshotRoute,
    verifyObserverCookie,
} from './inspections/_shared';
import templatesRoutes from './inspections/templates';
import hierarchyRoutes from './inspections/hierarchy';
import bulkRoutes from './inspections/bulk';
import mediaRoutes from './inspections/media';
import publishRoutes from './inspections/publish';

export const inspectionsRoutes = createApiRouter()
    .route('/', bulkRoutes)
    .route('/', templatesRoutes)
    .openapi(getInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const result = await service.getInspection(id, c.get('tenantId'));
        return c.json({
            success: true,
            data: result
        }, 200);
    })
    .openapi(deleteInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const service = c.var.services.inspection;
        const { inspection } = await service.getInspection(id, tenantId);

        const db = drizzle(c.env.DB);
        // DB-8: delete link rows before (or together with) the inspection row.
        await db.delete(inspectionInspectors).where(and(eq(inspectionInspectors.inspectionId, id), eq(inspectionInspectors.tenantId, tenantId)));
        await db.delete(inspectionTable).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));

        auditFromContext(c, 'inspection.delete', 'inspection', {
            entityId: id,
            metadata: { propertyAddress: inspection.propertyAddress },
        });
        return c.json({ success: true }, 200);
    })
    .openapi(updateInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const db = drizzle(c.env.DB);

        const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);

        // DB-16 — coverPhotoId holds the R2 key of a photo belonging to THIS
        // inspection (an attached item photo or a loose pool photo); null clears
        // the cover. Reject foreign/dangling keys so the preflight gate + report
        // renderer can always resolve the image.
        if (typeof body.coverPhotoId === 'string') {
            const ok = await c.var.services.inspection.isInspectionPhotoKey(id, tenantId, body.coverPhotoId);
            if (!ok) {
                return c.json({ success: false as const, error: { code: 'INVALID_COVER_PHOTO', message: 'coverPhotoId does not reference a photo of this inspection' } }, 400);
            }
        }

        // Tenant-ownership pre-check above guards access. The validated `body`
        // can legitimately be empty: the settings sheet forwards its whole form
        // and the BFF sanitizer drops empty-string "unchanged" fields, so a save
        // that touched nothing (or only fields outside UpdateInspectionSchema)
        // arrives as `{}`. drizzle throws "No values to set" on `.set({})`, which
        // used to surface as a 500 → the sheet's "Error — try again". Treat the
        // no-op as a successful save instead of writing an empty UPDATE.
        if (Object.keys(body).length > 0) {
            await db.update(inspectionTable).set(body).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));
        }

        // DB-8: re-sync link table when inspectorId is explicitly updated.
        // DB-8: mirror ALL canonical assignment columns — PATCH can only change
        // inspectorId, so preserve the pre-patch team-mode fields (leadInspectorId,
        // helperInspectorIds) from the fetched row so the link table stays a faithful
        // mirror of post-patch canonical state and team-mode rows are not wiped.
        if ('inspectorId' in body) {
            let helpers: string[] = [];
            try { helpers = JSON.parse(inspection.helperInspectorIds ?? '[]'); } catch { /* malformed legacy JSON -> no helpers */ }
            await syncInspectionAssignments(db, tenantId, id, {
                inspectorId:        body.inspectorId ?? null,
                leadInspectorId:    inspection.leadInspectorId,
                helperInspectorIds: helpers,
            });
        }

        if (body.status && body.status !== inspection.status) {
            auditFromContext(c, 'inspection.status_change', 'inspection', {
                entityId: id,
                metadata: { from: inspection.status, to: body.status },
            });
        }
        return c.json({ success: true }, 200);
    })
    .openapi(getPropertyFactsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const facts = await c.var.services.inspection.getPropertyFacts(id, tenantId);
        return c.json({ success: true, data: facts }, 200);
    })
    .openapi(updatePropertyFactsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const facts = await c.var.services.inspection.updatePropertyFacts(id, tenantId, body);
        auditFromContext(c, 'inspection.property_facts.update', 'inspection', {
            entityId: id,
            metadata: { fields: Object.keys(body) },
        });
        return c.json({ success: true, data: facts }, 200);
    })
    .openapi(autofillPropertyFactsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const { addressString } = c.req.valid('json');

        // Tenant ownership guard — refuses cross-tenant lookups.
        await c.var.services.inspection.getInspection(id, tenantId);

        const result = await c.var.services.propertyLookup.lookup(addressString);
        auditFromContext(c, 'inspection.property_facts.autofill', 'inspection', {
            entityId: id,
            metadata: { source: result.source ?? 'manual_required', reason: result.reason },
        });

        return c.json({
            success: true as const,
            data: {
                facts:  result.data,
                source: result.source ?? ('manual_required' as const),
                ...(result.reason ? { reason: result.reason } : {}),
            },
        }, 200);
    })
    .openapi(getResultsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const db = drizzle(c.env.DB);
        await c.var.services.inspection.getInspection(id, c.get('tenantId'));
        const results = await db.select().from(inspectionResults).where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, c.get('tenantId')))).get();
        return c.json({ success: true, data: { results: (results?.data || {}) } }, 200);
    })
    .openapi(updateResultsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { data } = c.req.valid('json');
        const service = c.var.services.inspection;
        await service.updateResults(id, c.get('tenantId'), data);
        return c.json({ success: true }, 200);
    })
    .openapi(updateTemplateSnapshotRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { snapshot } = c.req.valid('json');
        await c.var.services.inspection.updateTemplateSnapshot(id, c.get('tenantId'), snapshot);
        auditFromContext(c, 'inspection.template_snapshot.update', 'inspection', {
            entityId: id,
            metadata: { sectionCount: snapshot.sections?.length ?? 0 },
        });
        return c.json({ success: true }, 200);
    })
    .openapi(switchRatingSystemRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { ratingSystemId, mode } = c.req.valid('json');
        const stats = await c.var.services.inspection.switchRatingSystem(id, c.get('tenantId'), ratingSystemId, mode);
        auditFromContext(c, 'inspection.rating_system.switch', 'inspection', {
            entityId: id,
            metadata: { ratingSystemId, mode, ...stats },
        });
        return c.json({ success: true, data: stats }, 200);
    })
    .openapi(aggregateRecommendationsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;

        const db = drizzle(c.env.DB);
        const row = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();
        const { items, totals } = aggregateAttachedRecommendations(row?.data as Record<string, unknown> | undefined);
        return c.json({ success: true as const, data: { items, totals } }, 200);
    })
    .openapi(createInspectionRoute, async (c) => {
        const body = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const service = c.var.services.inspection;
        const contactService = c.var.services.contact;

        // Filter undefined values and handle inspectorId logic
        const createData = Object.fromEntries(
            Object.entries(body).filter(([_, v]) => v !== undefined)
        ) as typeof body;

        // IA-1: Resolve client contact before creating the inspection.
        let clientContactId: string | undefined;
        if (body.client) {
            const { id } = await contactService.upsertClientContact(tenantId, {
                name:  body.client.name,
                email: body.client.email,
                phone: body.client.phone,
                type:  'client',
            });
            clientContactId = id;
            // Double-write denormalized columns so legacy read paths keep working.
            // Unconditional: the structured client object is the authoritative
            // source — the flat clientName carries a zod default ('Private
            // Client') that would otherwise always win and mask the real name.
            (createData as Record<string, unknown>).clientName = body.client.name;
            (createData as Record<string, unknown>).clientEmail = body.client.email ?? null;
            (createData as Record<string, unknown>).clientPhone = body.client.phone ?? null;
        }

        // IA-1: Resolve agent — newAgent creates/finds a contacts row; agentContactId uses an existing one.
        let resolvedAgentId: string | undefined = createData.referredByAgentId as string | undefined;
        if (body.newAgent) {
            const { id } = await contactService.upsertClientContact(tenantId, {
                name:  body.newAgent.name,
                email: body.newAgent.email,
                type:  'agent',
            });
            resolvedAgentId = id;
        } else if (body.agentContactId) {
            resolvedAgentId = body.agentContactId;
        }

        const inspection = await service.createInspection(tenantId, {
            ...createData,
            inspectorId:       body.inspectorId || c.get('user').sub,
            referredByAgentId: resolvedAgentId ?? null,
            // IA-1: pass the resolved contact ids through; createInspection stores them.
            clientContactId,
        } as Parameters<typeof service.createInspection>[1]);

        // IA-1: Apply serviceSelections price overrides — replace null priceOverride
        // for any service whose id appears in serviceSelections with a set override.
        if (body.serviceSelections && body.serviceSelections.length > 0) {
            await service.applyServicePriceOverrides(inspection.id, tenantId, body.serviceSelections);
        }

        auditFromContext(c, 'inspection.create', 'inspection', {
            entityId: inspection.id,
            metadata: { propertyAddress: inspection.propertyAddress },
        });

        return c.json({
            success: true,
            data: { inspection }
        }, 201);
    })
    .openapi(cloneInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const clone = await service.cloneInspection(id, c.get('tenantId'));

        auditFromContext(c, 'inspection.create', 'inspection', {
            entityId: clone.id,
            metadata: { clonedFrom: id, propertyAddress: clone.propertyAddress },
        });
        return c.json({ success: true, data: { inspection: clone } }, 201);
    })
    .route('/', mediaRoutes)
    .route('/', publishRoutes)
    .openapi(createFromWizardRoute, async (c) => {
        const input    = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!userId) throw Errors.Unauthorized('Missing user identity');

        const out = await c.var.services.inspection.createFromWizard(tenantId, userId, input);
        return c.json({ success: true as const, data: out }, 200);
    })
    .openapi(patchItemFieldRoute, async (c) => {
        const { id, itemId } = c.req.valid('param');
        const { field, value, expectedVersion, force, sectionId } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!userId) throw Errors.Unauthorized('Missing user identity');

        const out = await c.var.services.inspection.patchItem(
            id, tenantId, itemId, field, value, expectedVersion, userId, { force: force ?? false }, sectionId,
        );

        if (out.kind === 'not_found') {
            throw Errors.NotFound('Inspection not found');
        }
        if (out.kind === 'conflict') {
            return c.json({ success: false as const, error: { code: 'CONFLICT', current: out.current, yours: out.yours } }, 409);
        }
        return c.json({ success: true as const, data: { kind: 'ok', newVersion: out.newVersion, by: out.by, at: out.at } }, 200);
    })
    .openapi(preflightRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const out = await c.var.services.inspection.computePreflight(id, tenantId);
        return c.json({ success: true as const, data: out }, 200);
    })
    .route('/', hierarchyRoutes)
    .openapi(resultsBatchRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { patches } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!userId) throw Errors.Unauthorized('Missing user identity');

        // Ownership guard mirrors the single-field PATCH — 404 on tenant
        // mismatch keeps the existence-enumeration leak closed.
        try {
            await c.var.services.inspection.getInspection(id, tenantId);
        } catch {
            throw Errors.NotFound('Inspection not found');
        }

        const db = drizzle(c.env.DB);
        const data = await applyResultsBatch(db, id, patches, { tenantId, userId });
        auditFromContext(c, 'inspection.results_batch_patched', 'inspection', {
            entityId: id, metadata: { applied: data.applied, by: userId },
        });
        return c.json({ success: true as const, data }, 200);
    })
    // Typed-Hono dead-routes cleanup Task 12 — list persisted sync conflicts.
    .get('/:id/full', requireRole('owner', 'manager', 'inspector'), async (c) => {
        const id       = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const svc      = c.var.services.inspection;
        try {
            const { inspection, template } = await svc.getInspection(id, tenantId);
            const db = drizzle(c.env.DB);
            const results = await db.select().from(inspectionResults)
                .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();
            return c.json({ success: true, data: { inspection, template: template || null, results: results || null, base: null } });
        } catch (err) {
            if (err instanceof Error && err.message.includes('not found')) {
                return c.json({ success: false, error: { code: 'not_found', message: 'Inspection not found' } }, 404);
            }
            throw err;
        }
    })
    .get('/:id/presence/ws', async (c) => {
        if (c.req.header('Upgrade') !== 'websocket') {
            return new Response('expected websocket', { status: 426 });
        }
        if (!c.env.INSPECTION_PRESENCE) {
            return new Response('presence unavailable', { status: 501 });
        }

        const id = c.req.param('id');
        if (!id) return new Response('not found', { status: 404 });

        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;

        // Design System 0520 subsystem D phase 6 — observer fallback.
        // Inspector path uses JWT; observers carry the dedicated
        // __Host-observer_session cookie. We try JWT first (the common
        // case) then degrade to the observer cookie. Both produce a DO
        // attach request with `x-user-role: inspector` or `observer`
        // respectively — the DO already routes the two roles correctly
        // (observers are read-only in the roster snapshot).
        let attachUserId: string;
        let attachName:   string;
        let attachRole:   'inspector' | 'observer';

        if (userId && tenantId) {
            let ins;
            try {
                const out = await c.var.services.inspection.getInspection(id, tenantId);
                ins = out.inspection;
            } catch {
                return new Response('not found', { status: 404 });
            }

            let helpers: string[] = [];
            try {
                const parsed = JSON.parse(ins.helperInspectorIds ?? '[]');
                if (Array.isArray(parsed)) helpers = parsed as string[];
            } catch { /* malformed — treat as no helpers */ }

            const allowed = ins.inspectorId === userId
                         || ins.leadInspectorId === userId
                         || helpers.includes(userId);
            if (!allowed) return new Response('forbidden', { status: 403 });

            attachUserId = userId;
            attachName   = ins.inspectorId === userId ? 'Inspector' : 'Helper';
            attachRole   = 'inspector';
        } else {
            const cookie = getCookie(c, OBSERVER_COOKIE_NAME);
            if (!cookie) return new Response('unauthorized', { status: 401 });
            const payload = await verifyObserverCookie(cookie, c.env.JWT_SECRET);
            if (!payload || payload.inspectionId !== id) {
                return new Response('forbidden', { status: 403 });
            }
            attachUserId = `observer-${payload.linkId}`;
            attachName   = 'Observer';
            attachRole   = 'observer';
        }

        const doId = c.env.INSPECTION_PRESENCE.idFromName(id);
        const stub = c.env.INSPECTION_PRESENCE.get(doId);

        const fwd = new Request('https://do.local/ws', {
            method:  'GET',
            headers: {
                'Upgrade':          'websocket',
                'x-user-id':        attachUserId,
                'x-user-name':      attachName,
                'x-user-photo-url': '',
                'x-user-role':      attachRole,
            },
        });
        return stub.fetch(fwd);
    });;

export type InspectionsApi = typeof inspectionsRoutes;

export default inspectionsRoutes;
