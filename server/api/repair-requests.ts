/**
 * Sprint 3 Track B (S3-2) — Public Customer Repair Request email endpoint.
 *
 * POST /api/public/repair-request/email
 *
 * Public, no JWT — the customer who received the inspection report can
 * email a copy of the customer-facing repair-request export to themselves
 * (or to a contractor). Same gates as `/r/:id/repair-request`:
 *   - Tenant must opt in via tenant_configs.enable_customer_repair_export
 *   - Inspection's payment + agreement requirements must be satisfied
 *   - Tenant resolved from slug (or single-tenant default in standalone)
 *
 * Audit log: writes 'repair_request.exported' on success.
 *
 * Rate-limited by IP via the existing booking rate-limit bucket — the same
 * abuse profile applies (public, unauthenticated, sends email to a user-
 * supplied address).
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, agreementRequests, tenantConfigs, users } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { checkRateLimit } from '../lib/rate-limit';
import { logger } from '../lib/logger';
import { writeAuditLog } from '../lib/audit';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const EmailRequestSchema = z.object({
    inspectionId:     z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    recipientEmail:   z.string().email('Invalid email address').openapi({ example: 'buyer@example.com' }).describe('TODO describe recipientEmail field for the OpenInspection MCP integration'),
    customerComments: z.string().max(5000).optional().openapi({ example: 'Roof › Shingles: please replace by end of June.' }).describe('TODO describe customerComments field for the OpenInspection MCP integration'),
}).openapi('CustomerRepairRequestEmail');

const EmailResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({
        sent: z.literal(true).describe('TODO describe sent field for the OpenInspection MCP integration'),
    }).describe('TODO describe data field for the OpenInspection MCP integration'),
});

const sendEmailRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/repair-request/email',
    tags: ["inspections", "public"],
    summary: 'Email a copy of the repair-request export to the supplied address',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: EmailRequestSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: EmailResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Email queued for delivery',
        },
    },
    operationId: "createRepairRequestRepairRequestEmail",
    description: "Auto-generated placeholder for createRepairRequestRepairRequestEmail (POST /repair-request/email, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: [], tier: 'extended' }));

// C-10 ③-D — GET /api/public/repair-request/:id — the data the public
// repair-request page renders (property + defects + estimates + prefill email).
// Tenant resolved from slug; the unguessable inspection id is the key.
const RepairDefectSchema = z.object({
    sectionId:           z.string().describe('Report section id.'),
    sectionTitle:        z.string().describe('Report section title.'),
    itemId:              z.string().describe('Inspection item id.'),
    itemLabel:           z.string().describe('Inspection item label.'),
    comment:             z.string().describe('Defect comment text.'),
    location:            z.string().nullable().describe('Defect location, when set.'),
    category:            z.enum(['safety', 'recommendation', 'maintenance']).describe('Defect severity bucket.'),
    recommendationLabel: z.string().nullable().describe('Resolved recommendation label, when set.'),
    estimateLow:         z.number().nullable().describe('Low repair estimate (cents).'),
    estimateHigh:        z.number().nullable().describe('High repair estimate (cents).'),
    photos:              z.array(z.object({ key: z.string(), url: z.string() })).describe('Defect photos.'),
});
const RepairRequestDataSchema = z.object({
    success: z.literal(true).describe('Always true on the 200 path.'),
    data: z.object({
        inspectionId:    z.string().describe('Inspection id.'),
        propertyAddress: z.string().describe('Property address.'),
        inspectionDate:  z.string().nullable().describe('Scheduled inspection date.'),
        inspectorName:   z.string().nullable().describe('Assigned inspector name.'),
        clientEmail:     z.string().nullable().describe('Client email to prefill the "email me a copy" field.'),
        defects:         z.array(RepairDefectSchema).describe('Flattened repair-list defects.'),
        showEstimates:   z.boolean().describe('Whether the tenant exposes repair estimates.'),
    }).describe('Repair-request page payload.'),
});

const getRepairRequestRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/repair-request/{id}',
    tags: ["inspections", "public"],
    summary: 'Public repair-request page data for an inspection',
    request: { params: z.object({ id: z.string().describe('Inspection id.') }) },
    responses: {
        200: { content: { 'application/json': { schema: RepairRequestDataSchema } }, description: 'Repair-request data' },
        404: { description: 'Tenant not resolved' },
    },
    operationId: "getPublicRepairRequest",
    description: "Public, no-login repair-request page data (property + flattened defect list + estimates) for an inspection, resolved by tenant slug + the unguessable inspection id.",
}, { scopes: [], tier: 'extended' }));

export const repairRequestRoutes = createApiRouter()
    .openapi(sendEmailRoute, async (c) => {
    await checkRateLimit(c, 'book');

    const body = c.req.valid('json');
    const db = drizzle(c.env.DB);

    let tenantId = c.get('tenantId') || c.get('resolvedTenantId');
    if (!tenantId) {
        // SaaS: this POST carries the unguessable inspection id in the BODY,
        // so path-based resolution can't see it. Derive tenancy from the id —
        // the same capability model as the /r/ inspection-id resolver.
        const owner = await db.select({ tenantId: inspections.tenantId })
            .from(inspections)
            .where(eq(inspections.id, body.inspectionId))
            .get();
        tenantId = owner?.tenantId;
    }
    if (!tenantId) throw Errors.Forbidden('Tenant context missing.');

    // Tenant opt-in check.
    const cfg = await db.select({
        enableCustomerRepairExport: tenantConfigs.enableCustomerRepairExport,
    }).from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId as string))
        .get();
    if (!cfg?.enableCustomerRepairExport) {
        throw Errors.Forbidden('Customer repair-request export is not enabled for this workspace.');
    }

    // Inspection lookup + tenant scoping in a single query.
    const insp = await db.select({
        id:                inspections.id,
        propertyAddress:   inspections.propertyAddress,
        date:              inspections.date,
        inspectorId:       inspections.inspectorId,
        paymentRequired:   inspections.paymentRequired,
        paymentStatus:     inspections.paymentStatus,
        agreementRequired: inspections.agreementRequired,
    }).from(inspections)
        .where(and(eq(inspections.id, body.inspectionId), eq(inspections.tenantId, tenantId as string)))
        .get();
    if (!insp) throw Errors.NotFound('Inspection');

    // Same gating as /report/:id and /r/:id/repair-request.
    if (insp.paymentRequired === true && insp.paymentStatus !== 'paid') {
        throw Errors.Forbidden('Payment is required before this report can be exported.');
    }
    if (insp.agreementRequired === true) {
        const signed = await db.select({ id: agreementRequests.id })
            .from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, body.inspectionId),
                eq(agreementRequests.tenantId, tenantId as string),
                eq(agreementRequests.status, 'signed'),
            ))
            .limit(1);
        if (signed.length === 0) {
            throw Errors.Forbidden('Inspection agreement must be signed before this report can be exported.');
        }
    }

    // Inspector name for the email body footer.
    let inspectorName: string | null = null;
    if (insp.inspectorId) {
        const insRow = await db.select({ name: users.name })
            .from(users)
            .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, tenantId as string)))
            .get();
        inspectorName = insRow?.name ?? null;
    }

    // Build the email body. The report-export link drives the recipient
    // back to the same page they exported from for the rich (printable)
    // version; the email body shows the inline comments only.
    const baseUrl = (c.env.APP_BASE_URL || '').replace(/\/$/, '')
        || (c.req.header('host') ? `https://${c.req.header('host')}` : '');
    const exportUrl = `${baseUrl}/r/${body.inspectionId}/repair-request`;
    const branding = c.get('branding');
    const siteName = branding?.siteName || c.env.APP_NAME || 'OpenInspection';

    const safeAddress = escapeHtml(insp.propertyAddress || 'your property');
    const safeComments = body.customerComments
        ? escapeHtml(body.customerComments).replace(/\n/g, '<br/>')
        : '';
    const safeInspector = inspectorName ? escapeHtml(inspectorName) : '';

    const html = `
        <div style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
            <p style="font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: #64748b; margin: 0 0 4px;">Repair Request</p>
            <h1 style="font-size: 22px; line-height: 1.25; font-weight: 600; margin: 0 0 16px;">${safeAddress}</h1>
            <p style="font-size: 14px; line-height: 1.5; color: #475569;">
                Here is your repair-request list, generated from the inspection report${safeInspector ? ` by <strong>${safeInspector}</strong>` : ''}. You can hand this list to your contractor or share it with the seller.
            </p>
            ${safeComments ? `
            <div style="margin-top: 20px; padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
                <p style="font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #64748b; margin: 0 0 8px;">Your notes</p>
                <p style="font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeComments}</p>
            </div>` : ''}
            <p style="margin-top: 24px;">
                <a href="${exportUrl}" style="display: inline-block; padding: 10px 16px; background: #0f172a; color: white; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 700;">Open the printable list</a>
            </p>
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 32px 0;" />
            <p style="font-size: 11px; color: #94a3b8;">
                Sent by ${escapeHtml(siteName)}. This list reflects items flagged in your inspection report and does not constitute a legally binding contract or repair scope.
            </p>
        </div>
    `;

    try {
        await c.var.services.email.sendEmail(
            [body.recipientEmail],
            `Repair request — ${insp.propertyAddress || 'your property'}`,
            html,
        );
    } catch (err) {
        logger.error('[repair-request.email] send failed', { tenantId, inspectionId: body.inspectionId },
            err instanceof Error ? err : undefined);
        throw Errors.ServiceUnavailable('Email delivery failed. Please try again later.');
    }

    writeAuditLog({
        db: c.env.DB,
        tenantId: tenantId as string,
        action: 'repair_request.exported',
        entityType: 'inspection',
        entityId: body.inspectionId,
        metadata: {
            recipientEmail: body.recipientEmail,
            hasComments: !!body.customerComments && body.customerComments.length > 0,
        },
        ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || undefined,
        executionCtx: c.executionCtx,
    });

    return c.json({ success: true as const, data: { sent: true as const } }, 200);
    })
    .openapi(getRepairRequestRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = (c.get('tenantId') || c.get('resolvedTenantId')) as string | null;
        if (!tenantId) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
        const data = await c.var.services.inspection.getRepairRequestData(id, tenantId);
        return c.json({ success: true as const, data }, 200);
    });

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export type RepairRequestsApi = typeof repairRequestRoutes;

export default repairRequestRoutes;
