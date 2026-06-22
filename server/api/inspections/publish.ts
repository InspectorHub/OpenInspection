// Report lifecycle sub-router: complete, publish-readiness gate, confirm /
// cancel / uncancel, publish, re-inspection create + candidates, the report
// review state machine (submit / return / unpublish), and the PDF render
// pipeline (refresh + download). The read/delivery side (report-data, repair
// list, recipients, people, hub, send-pdf, agent share) lives in
// ./report-delivery.ts; the agreement signing envelope lives in ./agreements.ts.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import { auditFromContext } from '../../lib/audit';
import { getBookingHost, getBaseUrl, resolveTenantSlug } from '../../lib/url';
import { buildRenderReportUrl } from '../../lib/public-urls';
import { buildPortalUrl } from '../../lib/portal-urls';
import { logger } from '../../lib/logger';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { PublishInspectionSchema, CreateReinspectionSchema, CancelInspectionSchema } from '../../lib/validations/inspection.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections as inspectionTable } from '../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { resolveSignatureInspector } from '../../lib/signature-helpers';
import { getTenantId } from '../../lib/route-helpers';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

/**
 * POST /api/inspections/:id/complete
 */
export const completeInspectionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/complete',
    tags: ["inspections"],
    summary: "Complete inspection for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "completeInspection",
    description: "Auto-generated placeholder for completeInspection (POST /{id}/complete, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/**
 * GET /api/inspections/:id/publish-readiness
 *
 * Task 12 — pre-publish gate: reports which included defects are missing
 * required fields (location + trade). The frontend pre-publish modal
 * consumes this before allowing the inspector to publish the report.
 */
export const PublishDefectEntrySchema = z.object({
    sectionId:        z.string(),
    sectionTitle:     z.string(),
    itemId:           z.string(),
    itemLabel:        z.string(),
    cannedId:         z.string(),
    cannedTitle:      z.string(),
    missing:          z.array(z.enum(['location', 'trade'])),
    unresolvedTokens: z.array(z.string()),
});

export const publishReadinessRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/publish-readiness',
    tags: ['inspections'],
    summary: 'Check whether an inspection is ready to publish (required defect fields filled)',
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection identifier to evaluate for publish readiness') }),
    },
    responses: {
        200: {
            description: 'Readiness payload',
            content: {
                'application/json': {
                    schema: z.object({
                        ready: z.boolean(),
                        blockingDefects: z.array(PublishDefectEntrySchema),
                        // Track H (IA-7) — incomplete-but-not-required defects:
                        // yellow warning on the gate, never a block.
                        warningDefects: z.array(PublishDefectEntrySchema),
                    }),
                },
            },
        },
    },
    operationId: 'getInspectionPublishReadiness',
    description: 'Returns ready=true when every included defect has its REQUIRED fields filled (configurable per tenant/inspection — Track H IA-7); non-required gaps surface as warningDefects.',
}, { scopes: ['read'], tier: 'extended' }));

/**
 * POST /api/inspections/:id/submit
 * Submits a completed report for review (in_progress → submitted).
 * Does NOT require the `publish` capability — any inspector/manager/owner can submit.
 */
export const submitReportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/submit',
    tags: ['inspections'],
    summary: 'Submit report for review',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection id') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ reportStatus: z.string() })) } },
            description: 'Report submitted for review',
        },
        400: { description: 'Invalid precondition (e.g. report already submitted, inspection not completed)' },
    },
    operationId: 'submitReport',
    description: 'Transitions reportStatus from in_progress → submitted. Requires inspection.status === completed.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/inspections/:id/return
 * Returns a submitted report to the inspector for revision (submitted → in_progress).
 * Requires the `publish` capability (owner/manager by default; inspector only if not overridden).
 */
export const returnReportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/return',
    tags: ['inspections'],
    summary: 'Return submitted report to inspector for revision',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('publish')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection id') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ reportStatus: z.string() })) } },
            description: 'Report returned to inspector',
        },
        400: { description: 'Invalid precondition (report is not in submitted state)' },
        403: { description: 'Missing publish capability' },
    },
    operationId: 'returnReport',
    description: 'Transitions reportStatus from submitted → in_progress. Requires publish capability.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/inspections/:id/unpublish
 * Unpublishes a published report, reverting it to in_progress (published → in_progress).
 * Requires the `publish` capability.
 */
export const unpublishReportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/unpublish',
    tags: ['inspections'],
    summary: 'Unpublish a published report',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('publish')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection id') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ reportStatus: z.string() })) } },
            description: 'Report unpublished',
        },
        400: { description: 'Invalid precondition (report is not published)' },
        403: { description: 'Missing publish capability' },
    },
    operationId: 'unpublishReport',
    description: 'Transitions reportStatus from published → in_progress. Requires publish capability.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/inspections/:id/publish
 */
export const publishRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/publish',
    tags: ["inspections"],
    summary: "Publish inspection for current tenant",
    // Task 10 — publish capability layered on top of the role gate. owner/admin
    // always pass; an inspector with permission_overrides {publish:false}
    // ("requires review") is 403'd here.
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('publish')] as const,
    request: {
        params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: PublishInspectionSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ reportUrl: z.string().describe('TODO describe reportUrl field for the OpenInspection MCP integration'), reportStatus: z.string().describe('TODO describe reportStatus field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Published',
        },
    },
    operationId: "publishInspection",
    description: "Auto-generated placeholder for publishInspection (POST /{id}/publish, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/**
 * Issue #119 (Re-inspections) Task 4 — POST /api/inspections/:id/reinspect
 * Creates a new linked inspection that carries forward the selected still-open
 * flagged items from a published baseline report. 400 when the baseline is not
 * published.
 */
export const reinspectRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/reinspect',
    tags: ['inspections'],
    summary: 'Create a re-inspection from this (published) baseline report',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().describe('Baseline inspection id (original or a prior re-inspection; must be published).') }),
        body: { content: { 'application/json': { schema: CreateReinspectionSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(z.object({ id: z.string(), reinspectionRound: z.number() })) } }, description: 'Re-inspection created' },
        400: { description: 'Baseline not published / invalid' },
    },
    operationId: 'createReinspection',
    description: 'Creates a new linked inspection that carries forward the selected still-open flagged items from a published baseline report.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * Issue #119 (Re-inspections) Task 6 — GET /api/inspections/:id/reinspect-candidates
 * The still-open flagged items off a published baseline, so the hub's
 * "Create re-inspection" modal can list them with the carry-forward set
 * pre-checked. Empty array when the baseline is unpublished.
 */
export const reinspectCandidatesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/reinspect-candidates',
    tags: ['inspections'],
    summary: 'Candidate carry-forward items for a re-inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('Baseline inspection id (the published report to re-inspect).') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({
                candidates: z.array(z.object({
                    itemId: z.string(),
                    label: z.string(),
                    originalNotes: z.string().nullable(),
                    open: z.boolean(),
                })),
            })) } },
            description: 'Re-inspection candidate items',
        },
    },
    operationId: 'getReinspectCandidates',
    description: 'Returns the baseline report\'s flagged items (still-open ones pre-flagged) so the inspector can choose which to carry forward into a new re-inspection.',
}, { scopes: ['read'], tier: 'extended' }));


// Shared body for the three report state-machine transitions (submit / return /
// unpublish): run the service mutation, mapping a thrown error to a 400-ready
// failure message. The per-route handlers keep their own valid('param') reads
// and c.json() calls so each route's typed request/response shape stays exact.
type ReportTransitionResult = { ok: true } | { ok: false; message: string };
async function runReportTransition(
    mutate: () => Promise<unknown>,
    fallbackMessage: string,
): Promise<ReportTransitionResult> {
    try {
        await mutate();
        return { ok: true };
    } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : fallbackMessage };
    }
}

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
    .openapi(publishReadinessRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const readiness = await service.computePublishReadiness(id, tenantId);
        return c.json(readiness, 200);
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
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const result = await runReportTransition(() => c.var.services.inspection.submitReport(id, tenantId), 'Failed to submit report');
        if (!result.ok) return c.json({ success: false as const, error: { code: 'BAD_REQUEST', message: result.message } }, 400);
        return c.json({ success: true as const, data: { reportStatus: 'submitted' } }, 200);
    })
    .openapi(returnReportRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const result = await runReportTransition(() => c.var.services.inspection.returnReport(id, tenantId), 'Failed to return report');
        if (!result.ok) return c.json({ success: false as const, error: { code: 'BAD_REQUEST', message: result.message } }, 400);
        return c.json({ success: true as const, data: { reportStatus: 'in_progress' } }, 200);
    })
    .openapi(unpublishReportRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const result = await runReportTransition(() => c.var.services.inspection.unpublishReport(id, tenantId), 'Failed to unpublish report');
        if (!result.ok) return c.json({ success: false as const, error: { code: 'BAD_REQUEST', message: result.message } }, 400);
        return c.json({ success: true as const, data: { reportStatus: 'in_progress' } }, 200);
    });

export default publishRoutes;
