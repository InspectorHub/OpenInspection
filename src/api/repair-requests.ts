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
 *   - Tenant resolved from subdomain (or single-tenant default in standalone)
 *
 * Audit log: writes 'repair_request.exported' on success.
 *
 * Rate-limited by IP via the existing booking rate-limit bucket — the same
 * abuse profile applies (public, unauthenticated, sends email to a user-
 * supplied address).
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, agreementRequests, tenantConfigs, users } from '../lib/db/schema';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { checkRateLimit } from '../lib/rate-limit';
import { logger } from '../lib/logger';
import { writeAuditLog } from '../lib/audit';

const repairRequestRoutes = new OpenAPIHono<HonoConfig>();

const EmailRequestSchema = z.object({
    inspectionId:     z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    recipientEmail:   z.string().email('Invalid email address').openapi({ example: 'buyer@example.com' }),
    customerComments: z.string().max(5000).optional().openapi({ example: 'Roof › Shingles: please replace by end of June.' }),
}).openapi('CustomerRepairRequestEmail');

const EmailResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        sent: z.literal(true),
    }),
});

const sendEmailRoute = createRoute({
    method: 'post',
    path: '/repair-request/email',
    tags: ['Public'],
    summary: 'Email a copy of the repair-request export to the supplied address',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: EmailRequestSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: EmailResponseSchema } },
            description: 'Email queued for delivery',
        },
    },
});

repairRequestRoutes.openapi(sendEmailRoute, async (c) => {
    await checkRateLimit(c, 'book');

    const body = c.req.valid('json');
    const tenantId = c.get('tenantId') || c.get('resolvedTenantId');
    if (!tenantId) throw Errors.Forbidden('Tenant context missing.');

    const db = drizzle(c.env.DB);

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
});

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export default repairRequestRoutes;
