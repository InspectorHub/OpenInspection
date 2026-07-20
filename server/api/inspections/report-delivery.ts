// Report read + delivery/share sub-router: structured report data, repair
// list, recipients, people card, the aggregate hub payload, PDF email re-send,
// agent view tokens, and the agent share-link email. The report review state
// machine + publish + PDF render pipeline live in ./publish.ts; the agreement
// signing envelope lives in ./agreements.ts.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { getBookingHost, getBaseUrl, resolveTenantSlug } from '../../lib/url';
import { reportUrl as buildReportUrl, buildRenderReportUrl } from '../../lib/public-urls';
import { buildPortalUrl } from '../../lib/portal-urls';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import {
    InspectionRecipientsResponseSchema,
    InspectionHubResponseSchema,
    ReportDataResponseSchema,
} from '../../lib/validations/inspection.schema';
import { SendReportSchema, SendReportResponseDataSchema } from '../../lib/validations/send-report.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections as inspectionTable, contacts, tenants } from '../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { resolveSignatureInspector } from '../../lib/signature-helpers';
import { getTenantId, getDrizzle } from '../../lib/route-helpers';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { resolveReportTier } from '../../lib/report-tier';

const sendReportPdfRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/send-report-pdf',
    tags: ["inspections"],
    summary: 'Send the inspection report to one or more role-keyed recipients',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': { schema: SendReportSchema },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(SendReportResponseDataSchema) } },
            description: 'Report email(s) sent (see data.sentTo / data.skipped for per-recipient outcome)',
        },
        400: { description: 'Malformed request body (no recipients, or a recipient with neither contactId nor email)' },
        404: { description: 'Inspection not found' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createInspectionSendReportPdf",
    description: "Renders the report PDF once and sends it (or a text-only fallback if rendering fails) to every recipient in the request body, each with their own role-keyed portal link. Per-recipient failures (no resolvable email, unknown roleKey, send failure) are collected in the response and do not fail the whole request."
}, { scopes: ['write'], tier: 'extended' }));

/**
 * GET /api/inspections/:id/report-data
 */
const getReportDataRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/report-data',
    tags: ["inspections"],
    summary: 'Get structured report data',
    request: {
        params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(ReportDataResponseSchema),
                },
            },
            description: 'Report data',
        },
    },
    operationId: "listInspectionReportData",
    description: "Auto-generated placeholder for listInspectionReportData (GET /{id}/report-data, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * GET /api/inspections/:id/repair-list
 *
 * Track E1 (ITB §11, UC-ITB-07) — flat punch-list of every defect-rated
 * item across the inspection, suitable for handing to a contractor or
 * realtor. Authenticated route; the public viewer page hits the same
 * service via a server-side render at /inspections/:id/repair-list.
 */
const RepairListEntrySchema = z.object({
    sectionId:           z.string().describe('TODO describe sectionId field for the OpenInspection MCP integration'),
    sectionTitle:        z.string().describe('TODO describe sectionTitle field for the OpenInspection MCP integration'),
    itemId:              z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
    itemLabel:           z.string().describe('TODO describe itemLabel field for the OpenInspection MCP integration'),
    comment:             z.string().describe('TODO describe comment field for the OpenInspection MCP integration'),
    location:            z.string().nullable().describe('TODO describe location field for the OpenInspection MCP integration'),
    category:            z.enum(['safety', 'recommendation', 'maintenance']).describe('TODO describe category field for the OpenInspection MCP integration'),
    recommendationId:    z.string().nullable().describe('TODO describe recommendationId field for the OpenInspection MCP integration'),
    recommendationLabel: z.string().nullable().describe('TODO describe recommendationLabel field for the OpenInspection MCP integration'),
    estimateLow:         z.number().nullable().describe('TODO describe estimateLow field for the OpenInspection MCP integration'),
    estimateHigh:        z.number().nullable().describe('TODO describe estimateHigh field for the OpenInspection MCP integration'),
    photos:              z.array(z.object({ key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'), url: z.string().describe('TODO describe url field for the OpenInspection MCP integration') })).describe('TODO describe photos field for the OpenInspection MCP integration'),
    source:              z.enum(['canned', 'custom']).describe('TODO describe source field for the OpenInspection MCP integration'),
});
const RepairListResponseSchema = z.object({
    inspection: z.object({
        id:              z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
        propertyAddress: z.string().describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
        date:            z.string().nullable().describe('TODO describe date field for the OpenInspection MCP integration'),
        inspectorName:   z.string().nullable().describe('TODO describe inspectorName field for the OpenInspection MCP integration'),
    }).describe('TODO describe inspection field for the OpenInspection MCP integration'),
    defects: z.array(RepairListEntrySchema).describe('TODO describe defects field for the OpenInspection MCP integration'),
    totals: z.object({
        count:           z.number().describe('TODO describe count field for the OpenInspection MCP integration'),
        safety:          z.number().describe('TODO describe safety field for the OpenInspection MCP integration'),
        recommendation:  z.number().describe('TODO describe recommendation field for the OpenInspection MCP integration'),
        maintenance:     z.number().describe('TODO describe maintenance field for the OpenInspection MCP integration'),
        estimateLowSum:  z.number().describe('TODO describe estimateLowSum field for the OpenInspection MCP integration'),
        estimateHighSum: z.number().describe('TODO describe estimateHighSum field for the OpenInspection MCP integration'),
    }).describe('TODO describe totals field for the OpenInspection MCP integration'),
    showEstimates: z.boolean().describe('TODO describe showEstimates field for the OpenInspection MCP integration'),
});

const getRepairListRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/repair-list',
    tags: ["inspections"],
    summary: 'Get aggregated repair list (defects-only punch list)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(RepairListResponseSchema) } },
            description: 'Repair list',
        },
    },
    operationId: "listInspectionRepairList",
    description: "Auto-generated placeholder for listInspectionRepairList (GET /{id}/repair-list, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * Round-2 F1 — GET /api/inspections/:id/recipients
 * Returns the multi-party list (client + buyer agent + listing agent) that
 * the Publish modal renders per-recipient Email/Text checkboxes against.
 */
const recipientsRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{id}/recipients',
    tags: ["inspections"],
    summary: 'List the recipients eligible for the Publish modal',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRecipientsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Recipient list',
        },
    },
    operationId: "listInspectionRecipients",
    description: "Auto-generated placeholder for listInspectionRecipients (GET /{id}/recipients, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * GET /api/inspections/:id/hub
 *
 * Issue #111 — single aggregate payload powering the `/inspections/:id` hub
 * page. One round trip drives all six blocks (People / Schedule / Services /
 * Agreement / Invoice / Report status). 404 when the inspection does not exist
 * or belongs to another tenant.
 */
const hubRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{id}/hub',
    tags: ['inspections'],
    summary: 'Aggregate hub payload (people, schedule, services, agreement, invoice, report status)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('Inspection identifier') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionHubResponseSchema } },
            description: 'Inspection hub payload',
        },
        404: { description: 'Inspection not found in this tenant' },
    },
    operationId: 'getInspectionHub',
    description: 'Returns one aggregate payload for the inspection hub page so the loader makes a single round trip: core inspection fields, the people card, booked service lines, the tenant agreement templates, this inspection\'s agreement requests, the most recent invoice, and the publish-readiness summary.',
}, { scopes: ['read'], tier: 'extended' }));

// ── Spec 5A — report PDF render pipeline (download side) ───────────────────
// POST /{id}/pdf/refresh re-enqueues Summary + Full renders; GET /{id}/pdf
// streams (on-demand renders if needed) the requested PDF. These sit on the
// delivery side of the report lifecycle; the publish/state-machine routes live
// in ./publish.ts.
const refreshPdfRoute = createRoute(withMcpMetadata({
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
}, { scopes: ['write'], tier: 'extended' }));

// ── Commercial PCA Phase W Task 4 — .docx export status + download ─────────
// POST /{id}/export/word (Task 5) enqueues the build job; these two GETs are
// the polling status endpoint and the streaming R2 download the UI's
// "Export to Word" button (Task 6) uses once status flips to 'ready'.
const getExportStatusRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/export/{exportId}',
    tags: ["inspections"],
    summary: 'Get Word export status',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id: z.string().min(1).describe('Inspection identifier'),
            exportId: z.string().min(1).describe('report_exports row id'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({
                status: z.enum(['queued', 'building', 'ready', 'failed']),
                r2Key: z.string().nullable().optional(),
                error: z.string().nullable().optional(),
            })) } },
            description: 'Export status',
        },
        404: { description: 'Export not found' },
    },
    operationId: "getInspectionExportStatus",
    description: "Poll the status of a queued/building .docx export (Commercial PCA Phase W).",
}, { scopes: ['read'], tier: 'extended' }));

// Commercial PCA Phase W Task 5 — enqueue the async .docx build. Async-only
// (no synchronous fast path — see the plan's Global Constraints): this route
// only writes a `queued` status row and sends the job envelope; the queue
// consumer (server/services/report-export-consumer.ts) does all the work.
const enqueueWordExportRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/export/word',
    tags: ["inspections"],
    summary: 'Enqueue a .docx export of the commercial PCA report',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection identifier') }),
    },
    responses: {
        202: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ exportId: z.string() })) } },
            description: 'Export enqueued',
        },
        400: { description: 'Word export is only available for commercial PCA reports' },
        503: { description: 'Word export queue not configured on this deployment' },
    },
    operationId: "createInspectionExportWord",
    description: "Enqueue an async .docx export build (Commercial PCA Phase W). Async-only — every export goes through the queue regardless of size.",
}, { scopes: ['write'], tier: 'extended' }));

const downloadExportRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/export/{exportId}/download',
    tags: ["inspections"],
    summary: 'Download the built .docx export',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id: z.string().min(1).describe('Inspection identifier'),
            exportId: z.string().min(1).describe('report_exports row id'),
        }),
    },
    responses: {
        200: {
            content: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { schema: z.any() } },
            description: '.docx bytes',
        },
        404: { description: 'Export not found or not ready' },
    },
    operationId: "downloadInspectionExport",
    description: "Stream the .docx bytes for a ready export from R2 (Commercial PCA Phase W).",
}, { scopes: ['read'], tier: 'extended' }));

const downloadPdfRoute = createRoute(withMcpMetadata({
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
}, { scopes: ['read'], tier: 'extended' }));


const reportDeliveryRoutes = createApiRouter()
    .openapi(sendReportPdfRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = getTenantId(c);
        const { recipients } = c.req.valid('json');
        const db = getDrizzle(c);
        const service = c.var.services.inspection;
        const { inspection } = await service.getInspection(id, tenantId);

        const tenantSlug = await resolveTenantSlug(c, tenantId);
        // renderUrl: token-bearing URL for the headless browser PDF render.
        const renderUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
        const address = inspection.propertyAddress as string;

        // Sprint B-4a — append rebooking signature for the assigned inspector.
        const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);
        const sigHost = getBookingHost(c);

        // Spec 2 Task 6 — render the PDF ONCE, before the recipient loop, and
        // reuse the same ArrayBuffer for every recipient. If rendering fails,
        // `pdf` stays null and every recipient falls back to the text-only
        // email (mirrors the previous per-request try/catch posture, but the
        // render itself only ever runs once regardless of recipient count).
        let pdf: ArrayBuffer | null = null;
        try {
            // Route through the PDF cache — reuses an existing render when content
            // is unchanged, avoiding a redundant Browser Rendering call.
            // Always tracks current content (versionNumber: null); frozen PDFs
            // are only accessible from the verify page.
            const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
            const record = await c.var.services.reportPdf.getOrRender(id, tenantId, 'full', { reportUrl: renderUrl, contentHash, versionNumber: null });
            const obj = await c.var.services.reportPdf.streamPdf(record);
            if (!obj) throw new Error('PDF unavailable');
            pdf = await obj.arrayBuffer();
        } catch (err) {
            logger.error('[send-report-pdf] PDF render failed, recipients get text-only', { inspectionId: id }, err instanceof Error ? err : undefined);
        }

        const sentTo: string[] = [];
        const skipped: Array<{ recipient: string; reason: string }> = [];

        for (const recipient of recipients) {
            const recipientLabel = recipient.contactId ?? recipient.email ?? 'unknown';
            try {
                // Resolve the recipient's email: an explicit one-off email wins;
                // otherwise look up the contact (tenant-scoped).
                let recipientEmail = recipient.email ?? null;
                if (!recipientEmail && recipient.contactId) {
                    const contactRow = await db.select({ email: contacts.email }).from(contacts)
                        .where(and(eq(contacts.id, recipient.contactId), eq(contacts.tenantId, tenantId)))
                        .get();
                    recipientEmail = contactRow?.email ?? null;
                }
                if (!recipientEmail) {
                    skipped.push({ recipient: recipientLabel, reason: 'No email on file for this recipient' });
                    continue;
                }

                // linkUrl: per-recipient TOKENIZED report link, keyed by their
                // role profile. The report viewer is gated (token / session /
                // owner-preview); a plain URL 404s "Report not found" for a
                // no-login recipient. issueToken is idempotent per (inspection,
                // recipient), so re-sends reuse the same stable link.
                // issueToken validates roleKey against the tenant's active
                // contact_role_profiles and throws BadRequest for an unknown
                // key — caught below so one bad role doesn't sink the batch.
                const reportToken = await c.var.services.portalAccess.issueToken({
                    tenantId, inspectionId: id, recipientEmail, role: recipient.roleKey,
                });
                // linkUrl now lands the no-login recipient on the unified
                // portal hub (overview) carrying the persistent portalAccess token.
                const linkUrl = buildPortalUrl(getBaseUrl(c), tenantSlug, id, reportToken);

                if (pdf) {
                    await c.var.services.email.sendInspectionReportPdf(recipientEmail, address, linkUrl, pdf, sigInspector, sigHost);
                } else {
                    await c.var.services.email.sendReportReady(recipientEmail, address, linkUrl, sigInspector, sigHost);
                }
                auditFromContext(c, 'inspection.send_pdf', 'inspection', {
                    entityId: id,
                    metadata: { recipient: recipientEmail, roleKey: recipient.roleKey },
                });
                sentTo.push(recipientEmail);
            } catch (err) {
                logger.error('[send-report-pdf] recipient send failed', { inspectionId: id, recipient: recipientLabel }, err instanceof Error ? err : undefined);
                skipped.push({ recipient: recipientLabel, reason: err instanceof Error ? err.message : 'Send failed' });
            }
        }

        return c.json({ success: true as const, data: { sentTo, ...(skipped.length ? { skipped } : {}) } }, 200);
    })
    .openapi(getReportDataRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const data = await service.getReportData(id, tenantId);
        return c.json({ success: true, data }, 200);
    })
    .openapi(getRepairListRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const data = await c.var.services.inspection.getRepairList(id, tenantId);
        return c.json({ success: true, data }, 200);
    })
    .openapi(recipientsRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id }   = c.req.valid('param');
        const list     = await c.var.services.inspection.getRecipientList(id, tenantId);
        return c.json({ success: true, data: list }, 200);
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
            inspectorId: inspectionTable.inspectorId,
        }).from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)))
            .get();
        if (!inspectionRow) throw Errors.NotFound('Inspection not found');

        // Buyer's-agent attribution now lives on inspection_people (role
        // buyer_agent) rather than the legacy inspections.referredByAgentId
        // column — see PeopleService.contactIdForRole.
        const buyerAgentContactId = await c.var.services.people.contactIdForRole(tenantId, id, 'buyer_agent');
        if (!buyerAgentContactId) {
            throw Errors.BadRequest('No agent linked to this inspection');
        }

        const agentRow = await db.select({ email: contacts.email })
            .from(contacts)
            .where(and(eq(contacts.id, buyerAgentContactId), eq(contacts.tenantId, tenantId)))
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
    .openapi(refreshPdfRoute, async (c) => {
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
    .openapi(downloadPdfRoute, async (c) => {
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
    .openapi(enqueueWordExportRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        // Fail-closed / graceful degrade — same pattern as the BROWSER/PDF gate:
        // the producer binding is optional (standalone + one-click get it via the
        // committed wrangler.jsonc; a deploy that stripped it degrades cleanly).
        if (!c.env.WORD_EXPORT_QUEUE) {
            return c.json({ success: false, error: { code: 'EXPORT_UNAVAILABLE', message: 'Word export is not configured on this deployment.' } }, 503);
        }
        const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);
        const tier = resolveReportTier({
            propertyType: (inspection as { propertyType?: string | null }).propertyType ?? null,
            storedTier: (inspection as { reportTier?: 'light_commercial' | 'full_pca' | null }).reportTier ?? null,
        });
        if (!tier) {
            throw Errors.BadRequest('Word export is only available for commercial PCA reports.');
        }
        const { id: exportId } = await c.var.services.reportExport.create(tenantId, id, 'docx');
        await c.env.WORD_EXPORT_QUEUE.send({ exportId, tenantId, inspectionId: id, format: 'docx' });
        return c.json({ success: true, data: { exportId } }, 202);
    })
    .openapi(getExportStatusRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id, exportId } = c.req.valid('param');
        const record = await c.var.services.reportExport.get(exportId, tenantId);
        // Defense in depth: the export must belong to the inspection in the path
        // (tenant scoping is already enforced by get()).
        if (!record || record.inspectionId !== id) return c.json({ success: false, error: { message: 'Export not found' } }, 404);
        return c.json({ success: true, data: { status: record.status, r2Key: record.r2Key, error: record.error } }, 200);
    })
    .openapi(downloadExportRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id, exportId } = c.req.valid('param');
        const record = await c.var.services.reportExport.get(exportId, tenantId);
        if (!record || record.inspectionId !== id) return c.json({ success: false, error: { message: 'Export not found' } }, 404);
        const obj = await c.var.services.reportExport.stream(record);
        if (!obj) return c.json({ success: false, error: { message: 'Export object missing in storage' } }, 404);
        return new Response(obj.body, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'Content-Disposition': 'attachment; filename="report.docx"',
            },
        });
    })
    .get('/:id/report', async (c) => {
        return c.json({
            success: false,
            error: {
                code: 'MOVED',
                message: 'HTML report rendering has moved to the React Router v7 frontend. Use GET /api/inspections/:id/report-data for JSON data.',
            },
        }, 410);
    });

export default reportDeliveryRoutes;
