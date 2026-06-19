// Inspections API aggregator (incremental refactor in progress).
import {
    CancelInspectionSchema,
    Errors,
    OBSERVER_COOKIE_NAME,
    SuccessResponseSchema,
    aggregateAttachedRecommendations,
    aggregateRecommendationsRoute,
    agreementRequests,
    agreementSignUrl,
    agreementSigners,
    agreements,
    and,
    applyResultsBatch,
    asc,
    auditFromContext,
    autofillPropertyFactsRoute,
    buildPortalUrl,
    buildRenderReportUrl,
    buildReportUrl,
    cloneInspectionRoute,
    completeInspectionRoute,
    contacts,
    createApiResponseSchema,
    createApiRouter,
    createFromWizardRoute,
    createInspectionRoute,
    createRoute,
    deleteInspectionRoute,
    drizzle,
    eq,
    getBaseUrl,
    getBookingHost,
    getCookie,
    getDrizzle,
    getInspectionRoute,
    getPropertyFactsRoute,
    getRepairListRoute,
    getReportDataRoute,
    getResultsRoute,
    getTenantId,
    hubRoute,
    inspectionInspectors,
    inspectionResults,
    inspectionTable,
    logger,
    patchItemFieldRoute,
    peopleRoute,
    preflightRoute,
    publishReadinessRoute,
    publishRoute,
    recipientsRoute,
    reinspectCandidatesRoute,
    reinspectRoute,
    requireRole,
    resolveSignatureInspector,
    resolveTenantSlug,
    resultsBatchRoute,
    returnReportRoute,
    runEnvelopeCompletionPipeline,
    runSignerReceiptEffects,
    safeISODate,
    sendAgreementRequestRoute,
    sendReportPdfRoute,
    submitReportRoute,
    switchRatingSystemRoute,
    syncInspectionAssignments,
    tenants,
    unpublishReportRoute,
    updateInspectionRoute,
    updatePropertyFactsRoute,
    updateResultsRoute,
    updateTemplateSnapshotRoute,
    verifyObserverCookie,
    withMcpMetadata,
    z,
} from './inspections/_shared';
import templatesRoutes from './inspections/templates';
import hierarchyRoutes from './inspections/hierarchy';
import bulkRoutes from './inspections/bulk';
import mediaRoutes from './inspections/media';

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
    .openapi(completeInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = getTenantId(c);
        const service = c.var.services.inspection;
        const { inspection } = await service.getInspection(id, tenantId);

        // Idempotency: if already completed, short-circuit to prevent accidental
        // email storms when the client retries on network errors or double-clicks.
        if (inspection.status === 'completed' || inspection.status === 'delivered') {
            return c.json({ success: true }, 200);
        }

        const db = drizzle(c.env.DB);
        await db.update(inspectionTable).set({ status: 'completed' }).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));

        if (inspection.clientEmail) {
            const tenantSlug = await resolveTenantSlug(c, tenantId);
            // linkUrl: per-recipient TOKENIZED report link so the no-login client
            // can open it (a plain URL 404s "Report not found"). Idempotent per
            // (inspection, recipient) — re-sends keep the same stable link.
            const reportToken = await c.var.services.portalAccess.issueToken({ tenantId, inspectionId: id, recipientEmail: inspection.clientEmail, role: 'client' });
            // linkUrl now lands the no-login client on the unified portal hub
            // (overview) carrying the persistent portalAccess token.
            const linkUrl = buildPortalUrl(getBaseUrl(c), tenantSlug, id, reportToken);
            // renderUrl: token-bearing URL for the headless browser PDF render.
            const renderUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
            const clientEmail = inspection.clientEmail;
            const address = inspection.propertyAddress as string;

            // Sprint B-4a — resolve the inspector record so the report email
            // body carries the rebooking signature footer.
            const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);
            const sigHost = getBookingHost(c);

            // Best-effort PDF: if BROWSER binding is missing or rendering fails,
            // fall back to the existing text-only "Report Ready" email so we
            // never block inspection completion on an optional dependency.
            // Route through the PDF cache — if the publish flow already rendered
            // this content, getOrRender returns the cached record at zero Browser
            // Rendering cost.
            const deliver = async () => {
                try {
                    const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
                    // Everyday email attachment always renders current content.
                    // Frozen per-version PDFs live only on the verify page.
                    const record = await c.var.services.reportPdf.getOrRender(id, tenantId, 'full', { reportUrl: renderUrl, contentHash, versionNumber: null });
                    const obj = await c.var.services.reportPdf.streamPdf(record);
                    if (!obj) throw new Error('PDF unavailable');
                    const pdf = await obj.arrayBuffer();
                    await c.var.services.email.sendInspectionReportPdf(clientEmail, address, linkUrl, pdf, sigInspector, sigHost);
                } catch (err) {
                    logger.error('[complete] PDF generation failed, falling back to text-only email',
                        { inspectionId: id }, err instanceof Error ? err : undefined);
                    await c.var.services.email.sendReportReady(clientEmail, address, linkUrl, sigInspector, sigHost);
                }
            };
            c.executionCtx.waitUntil(deliver());
        }

        // B3: in-app notification for report ready
        c.executionCtx.waitUntil(
            c.var.services.notification.createForAllAdmins(tenantId, {
                type: 'report.published',
                title: `Report ready — ${inspection.propertyAddress ?? 'inspection'}`,
                entityType: 'inspection',
                entityId: inspection.id,
                metadata: { clientEmail: inspection.clientEmail ?? null },
            })
        );

        auditFromContext(c, 'inspection.complete', 'inspection', {
            entityId: id,
            metadata: { propertyAddress: inspection.propertyAddress },
        });
        return c.json({ success: true }, 200);
    })
    .openapi(sendReportPdfRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = getTenantId(c);
        const body = c.req.valid('json') ?? {};
        const service = c.var.services.inspection;
        const { inspection } = await service.getInspection(id, tenantId);

        const recipient = body.toEmail || inspection.clientEmail;
        if (!recipient) {
            throw Errors.BadRequest('No recipient email — set inspection.clientEmail or pass toEmail.');
        }

        const tenantSlug = await resolveTenantSlug(c, tenantId);
        // linkUrl: per-recipient TOKENIZED report link. The report viewer is
        // gated (token / session / owner-preview); a plain URL 404s "Report not
        // found" for a no-login recipient. issueToken is idempotent per
        // (inspection, recipient), so re-sends reuse the same stable link.
        const reportToken = await c.var.services.portalAccess.issueToken({ tenantId, inspectionId: id, recipientEmail: recipient, role: 'client' });
        // linkUrl now lands the no-login client on the unified portal hub
        // (overview) carrying the persistent portalAccess token.
        const linkUrl = buildPortalUrl(getBaseUrl(c), tenantSlug, id, reportToken);
        // renderUrl: token-bearing URL for the headless browser PDF render.
        const renderUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
        const address = inspection.propertyAddress as string;

        // Sprint B-4a — append rebooking signature for the assigned inspector.
        const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);
        const sigHost = getBookingHost(c);

        try {
            // Route through the PDF cache — reuses an existing render when content
            // is unchanged, avoiding a redundant Browser Rendering call.
            // Always tracks current content (versionNumber: null); frozen PDFs
            // are only accessible from the verify page.
            const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
            const record = await c.var.services.reportPdf.getOrRender(id, tenantId, 'full', { reportUrl: renderUrl, contentHash, versionNumber: null });
            const obj = await c.var.services.reportPdf.streamPdf(record);
            if (!obj) throw new Error('PDF unavailable');
            const pdf = await obj.arrayBuffer();
            await c.var.services.email.sendInspectionReportPdf(recipient, address, linkUrl, pdf, sigInspector, sigHost);
            auditFromContext(c, 'inspection.send_pdf', 'inspection', { entityId: id, metadata: { recipient } });
            return c.json({ success: true as const, data: { sentTo: recipient } }, 200);
        } catch (err) {
            logger.error('[send-report-pdf] PDF failed, sending text-only', { inspectionId: id }, err instanceof Error ? err : undefined);
            await c.var.services.email.sendReportReady(recipient, address, linkUrl, sigInspector, sigHost);
            auditFromContext(c, 'inspection.send_text_fallback', 'inspection', { entityId: id, metadata: { recipient } });
            // 200 because the user got AN email, just not a PDF — log + audit captures the degradation
            return c.json({ success: true as const, data: { sentTo: recipient } }, 200);
        }
    })
    .openapi(getReportDataRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const data = await service.getReportData(id, tenantId);
        return c.json({ success: true, data }, 200);
    })
    .openapi(publishReadinessRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const readiness = await service.computePublishReadiness(id, tenantId);
        return c.json(readiness, 200);
    })
    .openapi(getRepairListRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const data = await c.var.services.inspection.getRepairList(id, tenantId);
        return c.json({ success: true, data }, 200);
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/confirm',
        tags: ["inspections"], summary: "Confirm inspection for current tenant",
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Confirmed' } },
        operationId: "confirmInspection",
        description: "Auto-generated placeholder for confirmInspection (POST /{id}/confirm, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        await c.var.services.inspection.confirmInspection(tenantId, id);
        return c.json({ success: true });
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/cancel',
        tags: ["inspections"], summary: "Cancel inspection for current tenant",
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
        request: {
            params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
            body: { content: { 'application/json': { schema: CancelInspectionSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
        },
        responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Cancelled' } },
        operationId: "cancelInspection",
        description: "Auto-generated placeholder for cancelInspection (POST /{id}/cancel, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const { reason, notes } = c.req.valid('json');
        await c.var.services.inspection.cancelInspection(tenantId, id, reason, notes);
        return c.json({ success: true });
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/uncancel',
        tags: ["inspections"], summary: "Create inspection uncancel for current tenant",
        middleware: [requireRole('owner', 'manager')] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Uncancelled' } },
        operationId: "createInspectionUncancel",
        description: "Auto-generated placeholder for createInspectionUncancel (POST /{id}/uncancel, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        await c.var.services.inspection.uncancelInspection(tenantId, id);
        return c.json({ success: true });
    })
    .openapi(recipientsRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id }   = c.req.valid('param');
        const list     = await c.var.services.inspection.getRecipientList(id, tenantId);
        return c.json({ success: true, data: list }, 200);
    })
    .openapi(peopleRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id }   = c.req.valid('param');
        const card     = await c.var.services.inspection.getPeopleCard(id, tenantId);
        return c.json({ success: true, data: card }, 200);
    })
    .openapi(hubRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id }   = c.req.valid('param');

        // Tenant slug for building /report/:tenantSlug/:id links. Public/standalone
        // paths set requestedTenantSlug via tenant routing; saas AUTHENTICATED
        // requests resolve the tenant from the JWT and never set it — fall back
        // to a tenants.slug lookup by the verified tenantId.
        let tenantSlug = c.get('requestedTenantSlug') ?? '';
        if (!tenantSlug) {
            const row = await drizzle(c.env.DB).select({ slug: tenants.slug })
                .from(tenants)
                .where(eq(tenants.id, tenantId))
                .get();
            tenantSlug = row?.slug ?? '';
        }

        const data = await c.var.services.inspection.getInspectionHub(id, tenantId, tenantSlug);
        if (!data) return c.json({ success: false, error: 'Inspection not found' }, 404);
        return c.json({ success: true, data }, 200);
    })
    .openapi(sendAgreementRequestRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id }   = c.req.valid('param');
        const body     = c.req.valid('json');
        const db       = drizzle(c.env.DB);

        // 404 if the inspection is missing or belongs to another tenant.
        const inspection = await db.select().from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        // Resolve the agreement template: explicit id (tenant-scoped) or the
        // tenant's first agreement (same gatekeeper as GET .../agreement).
        let agreement;
        if (body.agreementId) {
            agreement = await db.select().from(agreements)
                .where(and(eq(agreements.id, body.agreementId), eq(agreements.tenantId, tenantId))).get();
            if (!agreement) throw Errors.UnprocessableEntity('The selected agreement template was not found in this workspace.');
        } else {
            agreement = await db.select().from(agreements)
                .where(eq(agreements.tenantId, tenantId)).get();
            if (!agreement) throw Errors.UnprocessableEntity('No agreement template exists yet. Create one in Settings before sending.');
        }

        // Resolve the recipient: explicit email or the inspection's client email.
        const clientEmail = body.email ?? inspection.clientEmail ?? null;
        if (!clientEmail) throw Errors.UnprocessableEntity('No client email on this inspection. Add a client email or enter one to send.');

        // Create the signing request (tenant-scoped inside the service).
        const request = await c.var.services.agreement.createSigningRequest(tenantId, {
            agreementId: agreement.id,
            clientEmail,
            clientName: inspection.clientName ?? null,
            inspectionId: id,
        });

        // Build the public sign URL exactly like the admin send path.
        // Use the saas-aware resolver (requestedTenantSlug is empty in saas → DB fallback).
        const slug = await resolveTenantSlug(c, tenantId);
        const signUrl = agreementSignUrl(getBookingHost(c), slug, request.token);

        // Sign the email with the assigned inspector's rebooking footer (B-4a).
        const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);
        await c.var.services.email.sendAgreementRequest(
            clientEmail, inspection.clientName ?? null, request.agreementName, signUrl, sigInspector, getBookingHost(c),
        );

        // Flip the row to 'sent' (the admin path stamps a request.sent audit
        // event; the hub surfaces row status directly, so we persist it).
        const sentAt = new Date();
        await db.update(agreementRequests)
            .set({ status: 'sent', sentAt })
            .where(and(eq(agreementRequests.id, request.id), eq(agreementRequests.tenantId, tenantId)));

        auditFromContext(c, 'agreement.send', 'agreement_request', {
            entityId: request.id,
            metadata: { agreementId: agreement.id, clientEmail, inspectionId: id },
        });

        return c.json({
            success: true as const,
            data: {
                id:          request.id,
                status:      'sent',
                clientEmail,
                createdAt:   safeISODate(request.createdAt),
            },
        }, 200);
    })
    .openapi(publishRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const service = c.var.services.inspection;
        // Build the publish options explicitly so `recipients` is omitted (not
        // set to `undefined`) when absent — exactOptionalPropertyTypes rejects
        // `recipients: X[] | undefined` against the service's optional param.
        const publishOptions: Parameters<typeof service.publishInspection>[2] = {
            theme: body.theme,
            notifyClient: body.notifyClient,
            notifyAgent: body.notifyAgent,
            requireSignature: body.requireSignature,
            requirePayment: body.requirePayment,
            sendAgreementCopy: body.sendAgreementCopy,
            ...(body.recipients ? { recipients: body.recipients } : {}),
        };
        const result = await service.publishInspection(id, tenantId, publishOptions);

        // Design System 0520 subsystem D phase 9 — Republish snapshot.
        // After the inspection's status flips to published, persist a frozen
        // snapshot into report_versions so the customer-facing viewer can
        // browse history + diff. Best-effort: failures log but do NOT block
        // the publish response. snapshot-too-large (> 1 MB) downgrades to a
        // warning audit entry rather than a 5xx — the report itself remains
        // viewable through the existing /reports/:id path.
        const userId = (c.get('user') as { sub?: string } | undefined)?.sub;
        let publishedVersion: number | null = null;
        if (userId) {
            try {
                const out = await c.var.services.reportVersion.snapshotOnPublish(
                    tenantId, id, userId, body.summary,
                );
                publishedVersion = out.versionNumber;
                logger.info('report-version snapshot saved', {
                    inspectionId:  id,
                    versionNumber: out.versionNumber,
                });
            } catch (err) {
                logger.warn('report-version snapshot failed (non-fatal)', {
                    inspectionId: id,
                    error:        err instanceof Error ? err.message : String(err),
                });
            }
        }

        // Purge transient (versionNumber=null) cached PDFs now that a frozen version
        // exists. Subsequent everyday downloads will render fresh current content
        // rather than serving a stale pre-publish snapshot. Best-effort: failures
        // are logged but never block the publish response.
        try {
            await c.var.services.reportPdf.purgeTransientPdfs(id, tenantId);
        } catch (e) {
            logger.warn('purge transient pdfs failed', { inspectionId: id, error: String(e) });
        }

        // Spec 5A.5 — enqueue + background-render Summary + Full PDFs after
        // publish. Best-effort: failures log but never block the publish
        // response. Persistent record in report_pdfs lets the client UI poll
        // (status: queued -> rendering -> ready) and offer Refresh PDFs.
        //
        // Gated by tenant_configs.enable_pdf_pipeline (default
        // OFF). Free-plan tenants and Paid tenants who don't want the spend
        // skip rendering entirely; the report viewer's window.print() button
        // remains the universal fallback.
        const reportPdf = c.var.services.reportPdf;
        if (await reportPdf.isPipelineEnabled(tenantId)) {
            const tenantSlug = await resolveTenantSlug(c, tenantId);
            // renderUrl: token-bearing URL for the headless browser PDF render.
            const renderUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
            const sourceVersion = Date.now();
            // Content hash enables post-publish owner/client downloads to reuse this
            // render instead of triggering a second Browser Rendering call.
            const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
            const footer = await c.var.services.inspection.getReportPdfFooterContext(id, tenantId);
            const renderBoth = async () => {
                try {
                    await Promise.all([
                        reportPdf.markQueued(id, tenantId, 'summary', publishedVersion),
                        reportPdf.markQueued(id, tenantId, 'full', publishedVersion),
                    ]);
                    await Promise.allSettled([
                        reportPdf.renderAndStore(id, tenantId, 'summary', { reportUrl: renderUrl, sourceVersion, versionNumber: publishedVersion, contentHash, footer }),
                        reportPdf.renderAndStore(id, tenantId, 'full',    { reportUrl: renderUrl, sourceVersion, versionNumber: publishedVersion, contentHash, footer }),
                    ]);
                } catch (err) {
                    logger.error('[publish] PDF render enqueue failed', { inspectionId: id }, err instanceof Error ? err : undefined);
                }
            };
            c.executionCtx.waitUntil(renderBoth());
        }

        return c.json({ success: true, data: result }, 200);
    })
    .openapi(reinspectRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        try {
            const created = await c.var.services.inspection.createReinspection(tenantId, id, {
                selectedItemIds: body.selectedItemIds,
                inspectorId: body.inspectorId,
            });
            return c.json({ success: true, data: { id: created.id, reinspectionRound: created.reinspectionRound ?? 1 } }, 200);
        } catch (err) {
            return c.json({ success: false, error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'Failed to create re-inspection' } }, 400);
        }
    })
    .openapi(reinspectCandidatesRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const candidates = await c.var.services.inspection.getReinspectCandidates(tenantId, id);
        return c.json({ success: true, data: { candidates } }, 200);
    })
    .openapi(submitReportRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        try {
            await c.var.services.inspection.submitReport(id, tenantId);
            return c.json({ success: true as const, data: { reportStatus: 'submitted' } }, 200);
        } catch (err) {
            return c.json({ success: false as const, error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'Failed to submit report' } }, 400);
        }
    })
    .openapi(returnReportRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        try {
            await c.var.services.inspection.returnReport(id, tenantId);
            return c.json({ success: true as const, data: { reportStatus: 'in_progress' } }, 200);
        } catch (err) {
            return c.json({ success: false as const, error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'Failed to return report' } }, 400);
        }
    })
    .openapi(unpublishReportRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        try {
            await c.var.services.inspection.unpublishReport(id, tenantId);
            return c.json({ success: true as const, data: { reportStatus: 'in_progress' } }, 200);
        } catch (err) {
            return c.json({ success: false as const, error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'Failed to unpublish report' } }, 400);
        }
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/pdf/refresh',
        tags: ["inspections"],
        summary: 'Refresh PDF renders (Summary + Full)',
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: {
            202: {
                content: { 'application/json': { schema: createApiResponseSchema(z.object({
                    status: z.string().describe('TODO describe status field for the OpenInspection MCP integration'),
                    summary: z.string().describe('TODO describe summary field for the OpenInspection MCP integration'),
                    full: z.string().describe('TODO describe full field for the OpenInspection MCP integration'),
                })) } },
                description: 'PDF renders enqueued',
            },
        },
        operationId: "refreshInspection",
        description: "Auto-generated placeholder for refreshInspection (POST /{id}/pdf/refresh, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const reportPdf = c.var.services.reportPdf;
        if (!(await reportPdf.isPipelineEnabled(tenantId))) {
            throw Errors.Forbidden('PDF pipeline is disabled for this workspace. Enable it in Settings → Reports.');
        }
        const tenantSlug = await resolveTenantSlug(c, tenantId);
        // renderUrl: token-bearing URL for the headless browser PDF render.
        const renderUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
        const sourceVersion = Date.now();

        // Refresh re-renders the CURRENT (highest) version in place rather than
        // corrupting a different version's archived row (#120). Resolve the
        // current version per type and pass it consistently to markQueued and
        // renderAndStore.
        const currentSummary = await reportPdf.getPdfRecord(id, tenantId, 'summary');
        const currentFull    = await reportPdf.getPdfRecord(id, tenantId, 'full');
        const summaryVersion = currentSummary?.versionNumber ?? null;
        const fullVersion    = currentFull?.versionNumber ?? null;
        // Store content_hash so post-refresh downloads reuse this render (force
        // re-render is still guaranteed — renderAndStore always calls the browser).
        const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
        const footer = await c.var.services.inspection.getReportPdfFooterContext(id, tenantId);

        await Promise.all([
            reportPdf.markQueued(id, tenantId, 'summary', summaryVersion),
            reportPdf.markQueued(id, tenantId, 'full', fullVersion),
        ]);
        c.executionCtx.waitUntil((async () => {
            try {
                await Promise.allSettled([
                    reportPdf.renderAndStore(id, tenantId, 'summary', { reportUrl: renderUrl, sourceVersion, versionNumber: summaryVersion, contentHash, footer }),
                    reportPdf.renderAndStore(id, tenantId, 'full',    { reportUrl: renderUrl, sourceVersion, versionNumber: fullVersion,    contentHash, footer }),
                ]);
            } catch (err) {
                logger.error('[pdf/refresh] background render failed', { inspectionId: id }, err instanceof Error ? err : undefined);
            }
        })());

        return c.json({ success: true, data: { status: 'queued', summary: 'queued', full: 'queued' } }, 202);
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'get', path: '/{id}/pdf',
        tags: ["inspections"],
        summary: 'Download report PDF (Summary or Full)',
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
        request: {
            params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
            query: z.object({ type: z.enum(['summary', 'full']).default('full').describe('TODO describe type field for the OpenInspection MCP integration') }).describe('TODO describe query field for the OpenInspection MCP integration'),
        },
        responses: {
            200: {
                content: { 'application/pdf': { schema: z.any().describe('TODO describe schema field for the OpenInspection MCP integration') } },
                description: 'PDF bytes',
            },
        },
        operationId: "listInspectionPdf",
        description: "Auto-generated placeholder for listInspectionPdf (GET /{id}/pdf, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['read'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId') as string;
        if (!tenantId) return c.json({ success: false, error: { message: 'Tenant required' } }, 400);
        const { id } = c.req.valid('param');
        const { type } = c.req.valid('query');
        // On-demand render — requires CF Browser Rendering + R2 bindings.
        // The publish-time pre-render pipeline (POST /{id}/pdf/refresh) keeps its
        // own isPipelineEnabled gate and is not affected here.
        if (!c.env.BROWSER || !c.env.PHOTOS) {
            return c.json({ success: false, error: { code: 'PDF_UNAVAILABLE', message: 'PDF rendering is not configured on this deployment.' } }, 503);
        }
        // Tenant isolation: getInspection throws NotFound if cross-tenant.
        const { inspection: _inspection } = await c.var.services.inspection.getInspection(id, tenantId);
        // Everyday owner PDF always tracks current content (versionNumber: null →
        // content-hash cache). Frozen per-version PDFs live only on the verify page.
        void _inspection; // fetched for tenant isolation; version freeze dropped per spec.
        const tenantSlug = await resolveTenantSlug(c, tenantId);
        const reportUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
        const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
        const footer = await c.var.services.inspection.getReportPdfFooterContext(id, tenantId);
        const record = await c.var.services.reportPdf.getOrRender(id, tenantId, type, {
            reportUrl,
            contentHash,
            versionNumber: null,
            footer,
        });
        const obj = await c.var.services.reportPdf.streamPdf(record);
        if (!obj) return c.json({ success: false, error: { message: 'PDF object missing in storage' } }, 404);
        const filename = `report-${id}${type === 'summary' ? '-summary' : ''}.pdf`;
        return new Response(obj.body, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'private, max-age=300',
            },
        });
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/agent-token',
        tags: ["inspections"],
        summary: 'Generate shareable agent view token',
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: {
            200: {
                content: { 'application/json': { schema: createApiResponseSchema(z.object({ token: z.string().describe('TODO describe token field for the OpenInspection MCP integration'), url: z.string().describe('TODO describe url field for the OpenInspection MCP integration') })) } },
                description: 'Agent view token and URL',
            },
        },
        operationId: "createInspectionAgentToken",
        description: "Auto-generated placeholder for createInspectionAgentToken (POST /{id}/agent-token, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const token = await c.var.services.inspection.generateAgentViewToken(tenantId, id);
        const tenantSlug = await resolveTenantSlug(c, tenantId);
        const url = `${buildReportUrl(getBookingHost(c), tenantSlug, id)}?view=agent&token=${token}`;
        return c.json({ success: true, data: { token, url } });
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/share-agent',
        tags: ["inspections"],
        summary: 'Email the report share link to the linked agent',
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: {
            200: {
                content: { 'application/json': { schema: createApiResponseSchema(z.object({ sentTo: z.string().describe('TODO describe sentTo field for the OpenInspection MCP integration') })) } },
                description: 'Share link emailed to agent',
            },
        },
        operationId: "createInspectionShareAgent",
        description: "Auto-generated placeholder for createInspectionShareAgent (POST /{id}/share-agent, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const db = getDrizzle(c);

        const inspectionRow = await db.select({
            id: inspectionTable.id,
            propertyAddress: inspectionTable.propertyAddress,
            referredByAgentId: inspectionTable.referredByAgentId,
            inspectorId: inspectionTable.inspectorId,
        }).from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)))
            .get();
        if (!inspectionRow) throw Errors.NotFound('Inspection not found');
        if (!inspectionRow.referredByAgentId) {
            throw Errors.BadRequest('No agent linked to this inspection');
        }

        const agentRow = await db.select({ email: contacts.email })
            .from(contacts)
            .where(and(eq(contacts.id, inspectionRow.referredByAgentId), eq(contacts.tenantId, tenantId)))
            .get();
        if (!agentRow || !agentRow.email) {
            throw Errors.BadRequest('Agent has no email on file');
        }

        const token = await c.var.services.inspection.generateAgentViewToken(tenantId, id);
        const tenantSlug = await resolveTenantSlug(c, tenantId);
        const url = `${buildReportUrl(getBookingHost(c), tenantSlug, id)}?view=agent&token=${token}`;

        // Sprint B-4c — append the inspector's signature so the receiving agent
        // can rebook with the same inspector for future referrals.
        const sigInspector = await resolveSignatureInspector(c, inspectionRow.inspectorId, tenantId);
        const sigHost = getBookingHost(c);

        try {
            await c.var.services.email.sendAgentShareLink(agentRow.email, inspectionRow.propertyAddress, url, sigInspector, sigHost);
        } catch (err) {
            logger.error('[share-agent] email delivery failed', { inspectionId: id }, err instanceof Error ? err : undefined);
            throw Errors.Internal('Failed to send share link');
        }

        auditFromContext(c, 'inspection.share_agent', 'inspection', {
            entityId: id,
            metadata: { agentEmail: agentRow.email },
        });
        return c.json({ success: true, data: { sentTo: agentRow.email } });
    })
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
    .get('/:id/report', async (c) => {
        return c.json({
            success: false,
            error: {
                code: 'MOVED',
                message: 'HTML report rendering has moved to the React Router v7 frontend. Use GET /api/inspections/:id/report-data for JSON data.',
            },
        }, 410);
    })
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
    .get('/:id/sign-status', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

        // Track I-a — signed truth rides the envelope: a signed agreement_requests
        // row for this inspection (any channel — emailed OR on-site) lights it.
        const existing = await db.select({ id: agreementRequests.id }).from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, id),
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.status, 'signed'),
            )).limit(1).get();

        return c.json({ success: true, data: { signed: !!existing } }, 200);
    })
    .get('/:id/agreement', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);
        const svc = c.var.services.agreement;

        // Verify inspection exists (404 distinct from "no template").
        const inspection = await db.select({ id: inspectionTable.id }).from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        // Track I-a — ride the envelope: find-or-create the signing request so the
        // on-site signing surface reads the SAME snapshot + signer set as the
        // emailed flow. No template configured → { agreement: null } as before.
        let env: Awaited<ReturnType<typeof svc.findOrCreate>>;
        try {
            env = await svc.findOrCreate(tenantId, id);
        } catch (e) {
            if (e instanceof Error && /No agreement template configured/.test(e.message)) {
                return c.json({ success: true, data: { agreement: null } }, 200);
            }
            throw e;
        }

        const envelope = await db.select().from(agreementRequests)
            .where(eq(agreementRequests.id, env.requestId)).get();
        if (!envelope) throw Errors.NotFound('Agreement request not found');

        const snapshot = await svc.getSnapshotForRequest(envelope);
        const agreementRow = await db.select({ name: agreements.name }).from(agreements)
            .where(eq(agreements.id, envelope.agreementId)).get();
        const signerRows = await svc.listSigners(tenantId, env.requestId);

        return c.json({
            success: true,
            data: {
                // Backward-compatible subset: callers reading data.agreement.{id,name,content} still work.
                agreement: { id: envelope.agreementId, name: agreementRow?.name ?? 'Agreement', content: snapshot.content },
                requestId: env.requestId,
                completionPolicy: envelope.completionPolicy,
                signers: signerRows.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role, status: s.status })),
            },
        }, 200);
    })
    .post('/:id/sign', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);
        const svc = c.var.services.agreement;

        // Verify inspection exists
        const inspection = await db.select({ id: inspectionTable.id }).from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const raw = await c.req.json();
        const parsed = z.object({
            signatureBase64: z.string().min(1).describe('Base64-encoded signature image (data URL or raw base64) drawn by the signer on-site.'),
            signerId: z.string().optional().describe('Target signer within the envelope; defaults to the first non-terminal signer.'),
            onBehalfOf: z.string().max(200).optional().describe('Name of the party an authorized agent signs for.'),
            onBehalfDisclaimer: z.string().max(2000).optional().describe('Disclaimer the authorized agent attests to when signing on behalf of another.'),
        }).safeParse(raw);
        if (!parsed.success) return c.json({ success: false, error: { message: 'Invalid signature data', code: 'validation_error' } }, 400);
        const body = parsed.data;

        // Idempotency at the inspection level: if a signed envelope already
        // exists for this inspection, short-circuit (don't spin a fresh envelope).
        // Preserves the old `{ alreadySigned: true }` contract.
        const alreadySignedEnv = await db.select({ id: agreementRequests.id, status: agreementRequests.status })
            .from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, id),
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.status, 'signed'),
            )).limit(1).get();
        if (alreadySignedEnv) {
            return c.json({ success: true, data: { signed: true, alreadySigned: true, envelopeStatus: 'signed' } }, 200);
        }

        // Track I-a — on-site signing rides the envelope so every signature carries
        // a snapshot + audit chain + receipt. An envelope requires a template; the
        // old flow recorded signatures against nothing (the legal hole we close).
        let env: Awaited<ReturnType<typeof svc.findOrCreate>>;
        try {
            env = await svc.findOrCreate(tenantId, id);
        } catch (e) {
            if (e instanceof Error && /No agreement template configured/.test(e.message)) {
                return c.json({ success: false, error: { code: 'no_agreement_template', message: 'Create an agreement template before collecting signatures' } }, 409);
            }
            throw e;
        }

        const envelope = await db.select().from(agreementRequests)
            .where(eq(agreementRequests.id, env.requestId)).get();
        if (!envelope) throw Errors.NotFound('Agreement request not found');

        const signers = await db.select().from(agreementSigners)
            .where(eq(agreementSigners.requestId, env.requestId))
            .orderBy(asc(agreementSigners.createdAt)).all();

        // Pick the target signer: explicit signerId, else first non-terminal.
        let signer;
        if (body.signerId) {
            signer = signers.find((s) => s.id === body.signerId);
            if (!signer) throw Errors.NotFound('Signer not found');
        } else {
            signer = signers.find((s) => !['signed', 'declined', 'expired'].includes(s.status));
            if (!signer) {
                // Every signer is terminal — nothing left to sign.
                throw Errors.Conflict('Agreement is no longer signable');
            }
        }

        // Idempotent — an already-signed signer short-circuits without re-firing effects.
        if (signer.status === 'signed') {
            return c.json({ success: true, data: { signed: true, alreadySigned: true, signerId: signer.id, envelopeStatus: envelope.status } }, 200);
        }

        // Terminal-state guard: declined / expired signers must never reach the audit append.
        if (signer.status === 'declined' || signer.status === 'expired') {
            throw Errors.Conflict('Agreement is no longer signable');
        }

        const plaintext = await svc.getSignerLink(env.requestId, signer.id);

        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
        const ua = (c.req.header('user-agent') || '').slice(0, 200) || null;
        const country = c.req.header('cf-ipcountry') || null;
        const tsMs = Date.now();

        // Spec 5H P0 — audit-before-mutation per-signer append (chain integrity
        // survives a partial failure). Hash the signature image for cert reference.
        const sigBytes = (() => {
            try {
                const b64 = body.signatureBase64.replace(/^data:image\/[a-z]+;base64,/, '');
                const bin = atob(b64);
                const out = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
                return out;
            } catch { return new Uint8Array(); }
        })();
        const sigHash = sigBytes.length > 0
            ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', sigBytes)))
                .map((b) => b.toString(16).padStart(2, '0')).join('')
            : null;
        try {
            await c.var.services.auditLog.append(envelope.tenantId, envelope.id, 'signer.signed', {
                envelopeId: envelope.id,
                signerId: signer.id,
                signerEmail: signer.email,
                signerRole: signer.role,
                channel: 'in_person',
                contentHash: envelope.contentHash ?? null,
                onBehalfOf: body.onBehalfOf ?? null,
                country,
                ip,
                signatureImageHash: sigHash ? `sha256:${sigHash}` : null,
                tsMs,
                ua,
            });
        } catch (e) {
            logger.warn('audit.append.signer-signed.failed', { requestId: envelope.id, signerId: signer.id, error: (e as Error).message });
        }

        const result = await svc.markSignedBySigner(plaintext, body.signatureBase64, {
            signedAtMs: tsMs,
            channel: 'in_person',
            ipAddress: ip,
            userAgent: ua,
            onBehalfOf: body.onBehalfOf ?? null,
            onBehalfDisclaimer: body.onBehalfDisclaimer ?? null,
        });

        // Spec 2A — per-signer automation event (fires on EVERY sign).
        if (result.inspectionId) {
            c.var.services.automation.trigger({
                tenantId: result.tenantId,
                inspectionId: result.inspectionId,
                triggerEvent: 'agreement.signer_signed',
                companyName: c.env.APP_NAME || 'OpenInspection',
                reportBaseUrl: c.env.APP_BASE_URL || '',
            }).catch(() => {});
        }

        // Envelope completion side-effects fire EXACTLY ONCE.
        if (result.envelopeCompletedNow) {
            await runEnvelopeCompletionPipeline(c, {
                requestId: result.requestId,
                tenantId: result.tenantId,
                inspectionId: result.inspectionId,
                clientEmail: envelope.clientEmail ?? null,
                clientName: envelope.clientName ?? null,
                agreementId: envelope.agreementId,
            });
        }

        // Per-signer in-person receipt — every signer gets a receipt at their own
        // email EXCEPT when this same sign completed the envelope and the signer
        // IS the envelope client (the completion pipeline already emailed them).
        const completedSelf = result.envelopeCompletedNow
            && !!envelope.clientEmail
            && signer.email.trim().toLowerCase() === envelope.clientEmail.trim().toLowerCase();
        if (!completedSelf) {
            await runSignerReceiptEffects(c, {
                signerEmail: signer.email,
                signerName: signer.name,
                inspectionId: result.inspectionId,
                requestId: result.requestId,
            });
        }

        return c.json({ success: true, data: { signed: true, signerId: signer.id, envelopeStatus: result.envelopeStatus } }, 200);
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
