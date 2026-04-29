import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HonoConfig } from '../types/hono';
import { requireRole } from '../lib/middleware/rbac';
import { CreateInvoiceSchema, InvoiceResponseSchema } from '../lib/validations/invoice.schema';

const invoiceRoutes = new OpenAPIHono<HonoConfig>();

const listInvoicesRoute = createRoute({
    method: 'get', path: '/',
    tags: ['Invoices'], summary: 'List invoices',
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ invoices: z.array(InvoiceResponseSchema) }) }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
});

invoiceRoutes.openapi(listInvoicesRoute, async (c) => {
    const rows = await c.var.services.invoice.listInvoices(c.get('tenantId'));
    return c.json({ success: true as const, data: { invoices: rows } }, 200);
});

const createInvoiceRoute = createRoute({
    method: 'post', path: '/',
    tags: ['Invoices'], summary: 'Create invoice',
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: CreateInvoiceSchema } } } },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ invoice: InvoiceResponseSchema }) }) } },
            description: 'Created',
        },
    },
    security: [{ bearerAuth: [] }],
});

invoiceRoutes.openapi(createInvoiceRoute, async (c) => {
    const invoice = await c.var.services.invoice.createInvoice(c.get('tenantId'), c.req.valid('json'));
    return c.json({ success: true as const, data: { invoice } }, 201);
});

const markSentRoute = createRoute({
    method: 'post', path: '/{id}/mark-sent',
    tags: ['Invoices'], summary: 'Mark invoice as sent',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Success' },
    },
    security: [{ bearerAuth: [] }],
});

invoiceRoutes.openapi(markSentRoute, async (c) => {
    await c.var.services.invoice.markSent(c.req.valid('param').id as string, c.get('tenantId'));
    return c.json({ success: true }, 200);
});

const markPaidRoute = createRoute({
    method: 'post', path: '/{id}/mark-paid',
    tags: ['Invoices'], summary: 'Mark invoice as paid',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Success' },
    },
    security: [{ bearerAuth: [] }],
});

invoiceRoutes.openapi(markPaidRoute, async (c) => {
    await c.var.services.invoice.markPaid(c.req.valid('param').id as string, c.get('tenantId'));
    return c.json({ success: true }, 200);
});

const deleteInvoiceRoute = createRoute({
    method: 'delete', path: '/{id}',
    tags: ['Invoices'], summary: 'Delete invoice',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Deleted' },
    },
    security: [{ bearerAuth: [] }],
});

invoiceRoutes.openapi(deleteInvoiceRoute, async (c) => {
    await c.var.services.invoice.deleteInvoice(c.req.valid('param').id as string, c.get('tenantId'));
    return c.json({ success: true }, 200);
});

export default invoiceRoutes;
