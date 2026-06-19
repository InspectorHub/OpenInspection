// Complete, publish lifecycle, report data, recipients, agreements, PDF/share sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies are
// byte-identical to the original (only the dynamic-import path depth changed).
import {
    CancelInspectionSchema,
    Errors,
    SuccessResponseSchema,
    agreementRequests,
    agreementSignUrl,
    agreementSigners,
    agreements,
    and,
    asc,
    auditFromContext,
    buildPortalUrl,
    buildRenderReportUrl,
    buildReportUrl,
    completeInspectionRoute,
    contacts,
    createApiResponseSchema,
    createApiRouter,
    createRoute,
    drizzle,
    eq,
    getBaseUrl,
    getBookingHost,
    getDrizzle,
    getRepairListRoute,
    getReportDataRoute,
    getTenantId,
    hubRoute,
    inspectionTable,
    logger,
    peopleRoute,
    publishReadinessRoute,
    publishRoute,
    recipientsRoute,
    reinspectCandidatesRoute,
    reinspectRoute,
    requireRole,
    resolveSignatureInspector,
    resolveTenantSlug,
    returnReportRoute,
    runEnvelopeCompletionPipeline,
    runSignerReceiptEffects,
    safeISODate,
    sendAgreementRequestRoute,
    sendReportPdfRoute,
    submitReportRoute,
    tenants,
    unpublishReportRoute,
    withMcpMetadata,
    z,
} from './_shared';

const publishRoutes = createApiRouter()
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
    .get('/:id/report', async (c) => {
        return c.json({
            success: false,
            error: {
                code: 'MOVED',
                message: 'HTML report rendering has moved to the React Router v7 frontend. Use GET /api/inspections/:id/report-data for JSON data.',
            },
        }, 410);
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
    });

export default publishRoutes;
