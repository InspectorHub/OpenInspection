// Report read + delivery/share sub-router: structured report data, repair
// list, recipients, people card, the aggregate hub payload, PDF email re-send,
// agent view tokens, and the agent share-link email. The report review state
// machine + publish + PDF render pipeline live in ./publish.ts; the agreement
// signing envelope lives in ./agreements.ts.
// Extracted from inspections.ts, then fixed in place: not a copy of anything,
// the only definition of these routes.
import { guardSendReport, guardReportLink } from './report-send-guards';
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { capabilitiesFor } from '../../lib/middleware/require-capability';
import { redactMoney } from '../../lib/auth/money-redaction';
import { auditFromContext } from '../../lib/audit';
import { getBookingHost, getBaseUrl, resolveTenantSlug } from '../../lib/url';
import { reportUrl as buildReportUrl, buildRenderReportUrl } from '../../lib/public-urls';
import { buildPortalUrl } from '../../lib/portal-urls';
import { Errors, AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import {
    InspectionRecipientsResponseSchema,
    InspectionHubResponseSchema,
    ReportDataResponseSchema,
} from '../../lib/validations/inspection.schema';
import { SendReportSchema, SendReportResponseDataSchema } from '../../lib/validations/send-report.schema';
import { inspections as inspectionTable, contacts, tenants } from '../../lib/db/schema';
import { makeManualSendLogger } from '../../services/automation/manual-log';
import { resolveAutomationCompanyName } from '../../services/automation/company-name';
import { formatScheduledDate, readTenantDisplay } from '../../lib/inspection/scheduled-date-display';
import { eq, and } from 'drizzle-orm';
import { resolveSignatureInspector } from '../../lib/signature-helpers';
import { getTenantId, getDrizzle } from '../../lib/route-helpers';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { resolveRoleEmailTemplate } from '../../lib/people/role-template';
import { interpolate } from '../../services/automation/shared';
import { resolveReportTier } from '../../lib/report-tier';
import { hubPayUrl } from '../../lib/inspection/hub-pay-url';

const sendReportPdfRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/send-report-pdf',
    tags: ["inspections"],
    summary: 'Send the inspection report to one or more role-keyed recipients',
    middleware: [requireRole('owner', 'manager', 'inspector'), guardSendReport],
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection whose report is sent.') }),
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
    description: "Renders the report PDF once and sends it (or a text-only fallback if rendering fails) to every recipient in the request body, each with their own role-keyed portal link. Per-recipient failures (no resolvable email, unknown roleKey, send failure) are collected in the response and do not fail the whole request. Available to owner and manager roles, and to inspectors assigned to the inspection or granted the scheduleOthers capability. The report must be published (409 NOT_PUBLISHED otherwise). At most 10 recipients per request, each a person already on the inspection (matched by contact id, or by that person's email); anything else is refused with 400. The same recipient is sent the same inspection at most 3 times per hour (429 after that)."
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
        params: z.object({ id: z.string().describe('Inspection id.') }),
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
    description: "Return the structured report payload of an inspection: header facts, rating levels, rating counts and sections with their items."
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
    sectionId:           z.string(),
    sectionTitle:        z.string(),
    itemId:              z.string(),
    itemLabel:           z.string(),
    comment:             z.string(),
    location:            z.string().nullable(),
    category:            z.enum(['safety', 'recommendation', 'maintenance']),
    recommendationId:    z.string().nullable(),
    recommendationLabel: z.string().nullable(),
    // No estimateLow / estimateHigh: the platform publishes no repair price,
    // and this response is on the MCP `extended` tier (see
    // scripts/check-price-capability.mjs).
    photos:              z.array(z.object({ key: z.string(), url: z.string() })),
    source:              z.enum(['canned', 'custom']),
});
const RepairListResponseSchema = z.object({
    inspection: z.object({
        id:              z.string(),
        propertyAddress: z.string(),
        date:            z.string().nullable(),
        inspectorName:   z.string().nullable(),
    }),
    defects: z.array(RepairListEntrySchema),
    totals: z.object({
        count:           z.number(),
        safety:          z.number(),
        recommendation:  z.number(),
        maintenance:     z.number(),
        // Counts, not money — `estimateLowSum` / `estimateHighSum` are gone.
    }),
    showEstimates: z.boolean(),
});

const getRepairListRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/repair-list',
    tags: ["inspections"],
    summary: 'Get aggregated repair list (defects-only punch list)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().describe('Id of the inspection whose repair list to return.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(RepairListResponseSchema) } },
            description: 'Repair list',
        },
    },
    operationId: "listInspectionRepairList",
    description: "Returns the inspection's repair list: a flat list of every defect marked as included in the report, both defects picked from the template's canned comments and custom ones the inspector added, each with section and item, comment, location, category (safety, recommendation or maintenance), recommendation, photos and a source flag (canned or custom). Defects marked as not included are omitted. totals gives the overall count and a count per category; no repair costs are published. Custom defects carry no photos in this list. Returns 404 when the inspection is not in this company. Read-only. Available to owner, manager and inspector roles."
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
    request: { params: z.object({ id: z.string().describe('Id of the inspection whose eligible recipients to list.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRecipientsResponseSchema } },
            description: 'Recipient list',
        },
    },
    operationId: "listInspectionRecipients",
    description: "Lists the people the Publish dialog can send the report to for one inspection: the client, the buyer's agent and the listing agent, as {contactId, name, role (client, agent_buyer or agent_listing), email, phone}. People in other roles (such as co-clients or attorneys) and people with neither an email nor a phone are left out. Returns 404 when the inspection is not in this company. Read-only; sends nothing. Available to owner, manager and inspector roles."
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
    description: 'Returns one aggregate payload for the inspector portal page so the loader makes a single round trip: core inspection fields, the people card, booked service lines, the tenant agreement templates, this inspection\'s agreement requests, the most recent invoice, and the publish-readiness summary.',
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
    request: { params: z.object({ id: z.string().describe('Inspection whose report PDFs are re-rendered.') }) },
    responses: {
        202: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({
                status: z.string(),
                summary: z.string(),
                full: z.string(),
            })) } },
            description: 'PDF renders enqueued',
        },
    },
    operationId: "refreshInspection",
    description: "Force a fresh render of both report PDFs (Summary and Full) for an inspection. Marks both as queued, answers 202 immediately and renders in the background, replacing the stored PDF for the current version rather than an archived one; poll the PDF download route for the result. Returns 403 when the PDF pipeline is switched off for the company (Settings, Reports). The inspection id is not checked for existence. Safe to repeat, each call just queues another render. Restricted to owners, managers and inspectors."
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
        params: z.object({ id: z.string().describe('Id of the inspection whose report PDF to download.') }),
        query: z.object({ type: z.enum(['summary', 'full']).default('full').describe('Which PDF to download: summary or the full report.') }),
    },
    responses: {
        200: {
            content: { 'application/pdf': { schema: z.any() } },
            description: 'PDF bytes',
        },
    },
    operationId: "listInspectionPdf",
    description: "Downloads the inspection's report PDF as an attachment, either the full report (default) or the summary. Always renders the current content: a stored render is reused when the report content is unchanged, otherwise it is rendered on demand, so a first call can be slow; frozen per-version PDFs are not served here. Returns 503 when the deployment has no PDF rendering or storage configured, 404 when the inspection is not in this company or the stored file is missing. Responses are marked private with a 5 minute cache lifetime. Available to owner, manager and inspector roles."
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

        // What `{{company_name}}` renders as, and the locale + timezone `{{scheduled_date}}` renders in.
        // Both are properties of the WORKSPACE rather than of a recipient, so both are resolved ONCE per
        // request (two small reads, next to a PDF render) rather than inside the loop below. companyName
        // is deliberately NOT `tenantSlug`: a slug is a URL identifier — lowercase, hyphenated, often an
        // abbreviation — and the recipients of this email are outside the tenant, so a slug gives them no
        // way to recognise the company that inspected their property. Shares the resolver with every other
        // `{{company_name}}` reader so one email can never carry two company names, including its empty
        // fallback: a blank reads as a template gap the operator will report, whereas any substitute (slug
        // or platform name) reads as a confident claim about who wrote the email that is simply wrong.
        const [companyName, display] = await Promise.all([resolveAutomationCompanyName(db, tenantId), readTenantDisplay(db, tenantId)]);

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

        // A2.2 — manual sends land in the SAME ledger the automations write,
        // with `automation_id IS NULL` as the manual marker; one factory call =
        // one shared sendAt = one Outbox notice for the whole batch.
        const logManualSend = makeManualSendLogger(db, tenantId, id);

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
                    const reason = 'No email on file for this recipient';
                    skipped.push({ recipient: recipientLabel, reason });
                    await logManualSend({ recipient: recipientLabel, contactId: recipient.contactId ?? null, roleKey: recipient.roleKey, status: 'skipped', error: reason });
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

                // The role's own email template, when it names one. Every
                // recipient of a manual send used to get identical copy — see
                // resolveRoleEmailTemplate for why this is scoped to the manual
                // path and not offered as a general mechanism.
                const roleTemplate = await resolveRoleEmailTemplate(db, c.env.DB, tenantId, recipient.roleKey);
                if (roleTemplate) {
                    const vars: Record<string, string> = {
                        client_name:      (inspection.clientName as string | null) ?? '',
                        property_address: address,
                        scheduled_date:   formatScheduledDate(inspection.date as string | null, display),
                        report_url:       linkUrl,
                        company_name:     companyName,
                        role_label:       roleTemplate.roleLabel,
                    };
                    // The PDF rides along, exactly as it does on the default
                    // path. The first version of this branch omitted it, so a
                    // recipient whose role named a template got a link-only
                    // email while everyone else got the attachment — after the
                    // render cost had already been paid once for the batch.
                    // Choosing different WORDING must not change what is
                    // ENCLOSED.
                    await c.var.services.email.sendEmail(
                        [recipientEmail],
                        interpolate(roleTemplate.subject, vars),
                        interpolate(roleTemplate.body, vars),
                        pdf ? [{ filename: `${address.replace(/[^a-z0-9]+/gi, '-')}-report.pdf`, content: pdf }] : undefined,
                        // Same class as the two branches below: only the WORDING
                        // differs, chosen by role. A different template is not a
                        // different thing to have a preference about.
                        { inspector: sigInspector, classId: pdf ? 'report-ready-pdf' : 'report-ready' },
                    );
                } else if (pdf) {
                    await c.var.services.email.sendInspectionReportPdf(recipientEmail, address, linkUrl, pdf, sigInspector, sigHost);
                } else {
                    await c.var.services.email.sendReportReady(recipientEmail, address, linkUrl, sigInspector, sigHost);
                }
                auditFromContext(c, 'inspection.send_pdf', 'inspection', {
                    entityId: id,
                    metadata: { recipient: recipientEmail, roleKey: recipient.roleKey },
                });
                sentTo.push(recipientEmail);
                await logManualSend({ recipient: recipientEmail, contactId: recipient.contactId ?? null, roleKey: recipient.roleKey, status: 'sent' });
            } catch (err) {
                // Platform-level refusals (cooling window, quota exhausted, domain
                // unverified, address suppressed) apply to ALL recipients — abort
                // the batch and let the route return a 4xx so the caller knows why
                // nothing was sent, rather than silently counting every recipient
                // as a per-recipient skip.
                if (err instanceof AppError) throw err;
                logger.error('[send-report-pdf] recipient send failed', { inspectionId: id, recipient: recipientLabel }, err instanceof Error ? err : undefined);
                const reason = err instanceof Error ? err.message : 'Send failed';
                skipped.push({ recipient: recipientLabel, reason });
                await logManualSend({ recipient: recipientLabel, contactId: recipient.contactId ?? null, roleKey: recipient.roleKey, status: 'failed', error: reason });
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
            const row = await getDrizzle(c).select({ slug: tenants.slug })
                .from(tenants)
                .where(eq(tenants.id, tenantId))
                .get();
            tenantSlug = row?.slug ?? '';
        }

        const data = await c.var.services.inspection.getInspectionHub(id, tenantId, tenantSlug);
        if (!data) return c.json({ success: false, error: 'Inspection not found' }, 404);

        const payUrl = await hubPayUrl(c, tenantId, id, data.invoice);
        const hub = { ...data, invoice: data.invoice ? { ...data.invoice, payUrl } : null };
        // IA-95 — two kinds of money in one aggregate, projected field by field: this
        // inspection's price lines (`inspectionFees`) and the invoice block (`companyFinance`).
        const caps = await capabilitiesFor(c);
        const { invoice, ...rest } = hub;
        return c.json({ success: true, data: { ...redactMoney(rest, caps, 'inspectionFees'), invoice: redactMoney(invoice, caps, 'companyFinance') } }, 200);
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/agent-token',
        tags: ["inspections"],
        summary: 'Generate shareable agent view token',
        middleware: [requireRole('owner', 'manager', 'inspector'), guardReportLink] as const,
        request: { params: z.object({ id: z.string().describe('Inspection the agent view link is for.') }) },
        responses: {
            200: {
                content: { 'application/json': { schema: createApiResponseSchema(z.object({ token: z.string().describe('The newly minted agent view token, also embedded in the url field.'), url: z.string().describe('Full report URL ending in the agent view query string, ready to share with the agent.') })) } },
                description: 'Agent view token and URL',
            },
        },
        operationId: "createInspectionAgentToken",
        description: "Mint a read-only agent view link for an inspection report. Stores a new token that expires after 30 days and returns it with the full report URL (?view=agent&token=...). Nothing is sent: the caller delivers the link. Every call mints a new token and earlier tokens keep working until they expire. Returns 404 for an unknown inspection. Restricted to owners and managers, and to inspectors assigned to the inspection or granted the scheduleOthers capability; the report must be published (409 NOT_PUBLISHED otherwise)."
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
        middleware: [requireRole('owner', 'manager', 'inspector'), guardReportLink] as const,
        request: { params: z.object({ id: z.string().describe('Inspection whose report link is emailed to the buyer agent.') }) },
        responses: {
            200: {
                content: { 'application/json': { schema: createApiResponseSchema(z.object({ sentTo: z.string().describe('Email address of the buyer agent the report link was sent to.') })) } },
                description: 'Share link emailed to agent',
            },
        },
        operationId: "createInspectionShareAgent",
        description: "Email the report link to the inspection's buyer agent. Mints a new agent view token (valid 30 days), builds the agent view URL and sends it to the email on the buyer agent contact, with the inspector's signature appended, then writes an inspection.share_agent audit entry. Returns 400 when no buyer agent is linked to the inspection or that contact has no email, 404 for an unknown inspection and 500 if the email fails to send. Each call sends another email with a new token. Restricted to owners and managers, and to inspectors assigned to the inspection or granted the scheduleOthers capability; the report must be published (409 NOT_PUBLISHED otherwise)."
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
