import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HonoConfig } from '../types/hono';
import { requireRole } from '../lib/middleware/rbac';
import { CreateInvoiceSchema, InvoiceResponseSchema } from '../lib/validations/invoice.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const invoiceRoutes = new OpenAPIHono<HonoConfig>();

const listInvoicesRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["invoices"], summary: "List invoices for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ invoices: z.array(InvoiceResponseSchema).describe('TODO describe invoices field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listInvoices",
    description: "Auto-generated placeholder for listInvoices (GET /, invoices domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'primary' }));

invoiceRoutes.openapi(listInvoicesRoute, async (c) => {
    const rows = await c.var.services.invoice.listInvoices(c.get('tenantId'));
    return c.json({ success: true as const, data: rows }, 200);
});

const createInvoiceRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["invoices"], summary: "Create invoice for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
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

invoiceRoutes.openapi(createInvoiceRoute, async (c) => {
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
});

const markSentRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/mark-sent',
    tags: ["invoices"], summary: 'Mark invoice as sent',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Success' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "markSentInvoice",
    description: "Auto-generated placeholder for markSentInvoice (POST /{id}/mark-sent, invoices domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

invoiceRoutes.openapi(markSentRoute, async (c) => {
    const id = c.req.valid('param').id as string;
    const tenantId = c.get('tenantId');
    await c.var.services.invoice.markSent(id, tenantId);
    if (c.env.QBO_CLIENT_ID) {
        const inv = (await c.var.services.invoice.listInvoices(tenantId)).find(i => i.id === id);
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
});

const markPaidRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/mark-paid',
    tags: ["invoices"], summary: 'Mark invoice as paid',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Success' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "markPaidInvoice",
    description: "Auto-generated placeholder for markPaidInvoice (POST /{id}/mark-paid, invoices domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

invoiceRoutes.openapi(markPaidRoute, async (c) => {
    const id = c.req.valid('param').id as string;
    const tenantId = c.get('tenantId');
    await c.var.services.invoice.markPaid(id, tenantId, 'oi');
    if (c.env.QBO_CLIENT_ID) {
        const inv = (await c.var.services.invoice.listInvoices(tenantId)).find(i => i.id === id);
        if (inv) {
            c.executionCtx.waitUntil(
                c.var.services.qbo.recordPayment(tenantId, id, inv.amountCents / 100),
            );
        }
    }
    return c.json({ success: true }, 200);
});

const deleteInvoiceRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}',
    tags: ["invoices"], summary: "Delete invoice for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Deleted' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "deleteInvoice",
    description: "Auto-generated placeholder for deleteInvoice (DELETE /{id}, invoices domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary' }));

invoiceRoutes.openapi(deleteInvoiceRoute, async (c) => {
    const id = c.req.valid('param').id as string;
    const tenantId = c.get('tenantId');
    await c.var.services.invoice.deleteInvoice(id, tenantId);
    if (c.env.QBO_CLIENT_ID) {
        c.executionCtx.waitUntil(
            c.var.services.qbo.voidInvoice(tenantId, id),
        );
    }
    return c.json({ success: true }, 200);
});

export default invoiceRoutes;
