import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { requireCapability } from '../lib/middleware/require-capability';
import {
    CreateInvoiceSchema,
    InvoiceResponseSchema,
    MarkInvoicePaidSchema,
    RequestPaymentSchema,
    RequestPaymentResponseSchema,
} from '../lib/validations/invoice.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { normalizePaymentMethod } from '../lib/payment-method';
import { inspections, inspectionServices, tenantConfigs } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { getBookingHost } from '../lib/url';
import { paymentUrl } from '../lib/public-urls';
import { resolveSignatureInspector } from '../lib/signature-helpers';
import { getTenantId, getDrizzle } from '../lib/route-helpers';
import { resolveLocale } from '../lib/locale';
import { formatCurrency } from '../lib/format';

const listInvoicesRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["invoices"], summary: "List invoices for current tenant",
    // Task 10 — financial capability gates the primary financial-data read.
    // owner/admin always pass; layered here so an inspector granted
    // {financial:true} (and added to the role list in a future change) would be
    // governed by the capability rather than a bare role check.
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('financial')],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.array(InvoiceResponseSchema).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listInvoices",
    description: "Auto-generated placeholder for listInvoices (GET /, invoices domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'primary' }));

const createInvoiceRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["invoices"], summary: "Create invoice for current tenant",
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: CreateInvoiceSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ invoice: InvoiceResponseSchema.describe('TODO describe invoice field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Created',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createInvoice",
    description: "Auto-generated placeholder for createInvoice (POST /, invoices domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary' }));

const markSentRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/mark-sent',
    tags: ["invoices"], summary: 'Mark invoice as sent',
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Success' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "markSentInvoice",
    description: "Auto-generated placeholder for markSentInvoice (POST /{id}/mark-sent, invoices domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const markPaidRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/mark-paid',
    tags: ["invoices"], summary: 'Mark invoice as paid',
    middleware: [requireRole('owner', 'manager')],
    request: {
        params: z.object({ id: z.string().uuid().describe('Invoice id to mark as paid.') }).describe('Path params for the mark-paid endpoint.'),
        body: { content: { 'application/json': { schema: MarkInvoicePaidSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('Whether the invoice was marked paid.') }).describe('Mark-paid result.') } }, description: 'Success' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "markPaidInvoice",
    description: "Marks an invoice as paid and records the payment method. Manual offline/check payments flip the linked inspection's payment gate so the report unlocks; syncs the payment to QuickBooks when connected."
}, { scopes: ['write'], tier: 'extended' }));

const deleteInvoiceRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}',
    tags: ["invoices"], summary: "Delete invoice for current tenant",
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Deleted' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "deleteInvoice",
    description: "Auto-generated placeholder for deleteInvoice (DELETE /{id}, invoices domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary' }));

/**
 * Task 8 (Issue #111) — POST /api/invoices/request-payment.
 *
 * The hub Invoice card "Request payment" button posts here. Resolves (or
 * creates) the inspection's invoice per the money authority chain (Σ service
 * snapshots → inspections.price), marks it sent, and emails the client a link
 * to the public `/invoice/:id` payment page. Reuses any existing draft/sent
 * invoice rather than duplicating; rejects an already-paid invoice (409) and a
 * recipient-less or zero-amount inspection (422).
 */
const requestPaymentRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/request-payment',
    tags: ['invoices'], summary: 'Create + email an invoice payment request for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { body: { content: { 'application/json': { schema: RequestPaymentSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: RequestPaymentResponseSchema } }, description: 'Invoice marked sent and emailed' },
        404: { description: 'Inspection not found in this tenant' },
        409: { description: 'Invoice already paid' },
        422: { description: 'No client email, or amount resolves to zero' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'requestInvoicePayment',
    description: 'Resolves or creates the inspection invoice (money authority chain), marks it sent, and emails the client a link to the public payment page.',
}, { scopes: ['write'], tier: 'extended' }));

const invoiceRoutes = createApiRouter()
    .openapi(listInvoicesRoute, async (c) => {
        const rows = await c.var.services.invoice.listInvoices(c.get('tenantId'));
        return c.json({ success: true as const, data: rows }, 200);
    })
    .openapi(createInvoiceRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const invoice = await c.var.services.invoice.createInvoice(tenantId, c.req.valid('json'));
        if (c.env.QBO_CLIENT_ID) {
            c.executionCtx.waitUntil(
                c.var.services.qbo.upsertInvoice(tenantId, {
                    id:        invoice.id,
                    dueDate:   invoice.dueDate,
                    lineItems: invoice.lineItems,
                    status:    invoice.status,
                }),
            );
        }
        return c.json({ success: true as const, data: { invoice } }, 201);
    })
    .openapi(markSentRoute, async (c) => {
        const id = c.req.valid('param').id as string;
        const tenantId = c.get('tenantId');
        await c.var.services.invoice.markSent(id, tenantId);
        if (c.env.QBO_CLIENT_ID) {
            const inv = (await c.var.services.invoice.listInvoices(tenantId)).find(
                (i: Awaited<ReturnType<typeof c.var.services.invoice.listInvoices>>[number]) => i.id === id,
            );
            if (inv) {
                c.executionCtx.waitUntil(
                    c.var.services.qbo.upsertInvoice(tenantId, {
                        id:        inv.id,
                        contactId: inv.contactId ?? null,
                        dueDate:   inv.dueDate,
                        lineItems: inv.lineItems,
                        status:    'sent',
                    }),
                );
            }
        }
        return c.json({ success: true }, 200);
    })
    .openapi(markPaidRoute, async (c) => {
        const id = c.req.valid('param').id as string;
        const { method } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const paymentMethod = normalizePaymentMethod(method);
        await c.var.services.invoice.markPaid(id, tenantId, 'oi', paymentMethod);

        const inv = (await c.var.services.invoice.listInvoices(tenantId)).find(
            (i: Awaited<ReturnType<typeof c.var.services.invoice.listInvoices>>[number]) => i.id === id,
        );
        // Manual payment must also close the report's payment gate (markPaid only
        // touches the invoice row; the gate reads inspections.paymentStatus).
        if (inv?.inspectionId) {
            await c.var.services.inspection.markPaymentReceived(tenantId, inv.inspectionId);
        }
        if (c.env.QBO_CLIENT_ID && inv) {
            c.executionCtx.waitUntil(
                c.var.services.qbo.recordPayment(tenantId, id, inv.amountCents / 100),
            );
        }
        return c.json({ success: true }, 200);
    })
    .openapi(deleteInvoiceRoute, async (c) => {
        const id = c.req.valid('param').id as string;
        const tenantId = c.get('tenantId');
        await c.var.services.invoice.deleteInvoice(id, tenantId);
        if (c.env.QBO_CLIENT_ID) {
            c.executionCtx.waitUntil(
                c.var.services.qbo.voidInvoice(tenantId, id),
            );
        }
        return c.json({ success: true }, 200);
    })
    .openapi(requestPaymentRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { inspectionId } = c.req.valid('json');
        const db = getDrizzle(c);

        // 404 if the inspection is missing or belongs to another tenant.
        const inspection = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        // Recipient is mandatory — we cannot request payment with nowhere to send it.
        const clientEmail = inspection.clientEmail ?? null;
        if (!clientEmail) {
            throw Errors.UnprocessableEntity('No client email on this inspection. Add a client email before requesting payment.');
        }

        // Reuse the most recent invoice for this inspection when one exists.
        const existing = await c.var.services.invoice.findByInspectionId(tenantId, inspectionId);
        if (existing?.status === 'paid') {
            throw Errors.Conflict('This invoice is already paid.');
        }

        let invoiceId: string;
        let amountCents: number;
        // Currency label comes from the invoice's own snapshot (Phase B), not the
        // live tenant setting — a paid CAD invoice keeps reading CAD after a switch.
        let invoiceCurrency: string;
        if (existing) {
            // Existing draft/sent/partial — reuse it as-is (authority already set).
            invoiceId = existing.id;
            amountCents = existing.amountCents;
            invoiceCurrency = existing.currency;
        } else {
            // No invoice yet — resolve the amount via the money authority chain:
            // Σ service snapshots (override ?? snapshot) when any exist, else the
            // denormalized inspections.price cache. 422 if it resolves to zero.
            const serviceRows = await db.select({
                name:          inspectionServices.nameSnapshot,
                priceSnapshot: inspectionServices.priceSnapshot,
                priceOverride: inspectionServices.priceOverride,
            }).from(inspectionServices)
                .where(and(
                    eq(inspectionServices.tenantId, tenantId),
                    eq(inspectionServices.inspectionId, inspectionId),
                ))
                .all();

            let lineItems: Array<{ description: string; amountCents: number }>;
            if (serviceRows.length > 0) {
                lineItems = serviceRows.map(s => ({ description: s.name, amountCents: s.priceOverride ?? s.priceSnapshot }));
                amountCents = lineItems.reduce((sum, li) => sum + li.amountCents, 0);
            } else {
                amountCents = inspection.price ?? 0;
                lineItems = [{ description: 'Inspection services', amountCents }];
            }
            if (!amountCents || amountCents <= 0) {
                throw Errors.UnprocessableEntity('This inspection has no amount to invoice. Add a price or service before requesting payment.');
            }

            const created = await c.var.services.invoice.createInvoice(tenantId, {
                inspectionId,
                clientName: inspection.clientName ?? clientEmail,
                clientEmail,
                amountCents,
                lineItems,
            });
            invoiceId = created.id;
            invoiceCurrency = created.currency;
        }

        // Mark sent (tenant-scoped inside the service) before notifying.
        await c.var.services.invoice.markSent(invoiceId, tenantId);

        // Build the public pay URL exactly like the agreement send path's host
        // resolution; `/invoice/:id` is keyed by inspection id (no slug).
        const payUrl = paymentUrl(getBookingHost(c), inspectionId);
        // Format the amount in the RECIPIENT's locale (external client, no user row,
        // so the tenant default locale) but in the INVOICE's snapshot currency (Phase B).
        const cfg = await db.select({ defaultLocale: tenantConfigs.defaultLocale })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const amountLabel = formatCurrency(amountCents, {
            locale: resolveLocale(cfg?.defaultLocale),
            currency: invoiceCurrency,
        });

        // Sign the email with the assigned inspector's rebooking footer (B-4).
        const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);

        // Bare await — let an email failure surface as a 502 so the row stays
        // truthful (Task 7's reviewer-endorsed choice). markSent already ran, so
        // a failed send means "sent, delivery failed", which the user can retry.
        await c.var.services.email.sendInvoiceRequest(
            clientEmail, inspection.clientName ?? null, amountLabel, payUrl, sigInspector, getBookingHost(c),
        );

        // Re-read for the canonical post-send status + sentAt.
        const sent = await c.var.services.invoice.findByInspectionId(tenantId, inspectionId);
        return c.json({
            id:          invoiceId,
            status:      sent?.status ?? 'sent',
            amountCents,
            sentAt:      sent?.sentAt ?? null,
        }, 200);
    });

export type InvoicesApi = typeof invoiceRoutes;

export default invoiceRoutes;
