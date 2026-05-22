import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HonoConfig } from '../types/hono';
import { requireRole } from '../lib/middleware/rbac';
import {
    CreateContactSchema, UpdateContactSchema,
    ContactResponseSchema, ContactListQuerySchema,
} from '../lib/validations/contact.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const contactRoutes = new OpenAPIHono<HonoConfig>();

const listContactsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["contacts"], summary: "List contacts for current tenant",
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: { query: ContactListQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ contacts: z.array(ContactResponseSchema).describe('TODO describe contacts field for the OpenInspection MCP integration'), total: z.number().describe('TODO describe total field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listContacts",
    description: "Auto-generated placeholder for listContacts (GET /, contacts domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'primary' }));

contactRoutes.openapi(listContactsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const q = c.req.valid('query');
    const opts: { type?: 'agent' | 'client'; search?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.type) opts.type = q.type;
    if (q.search) opts.search = q.search;
    const rows = await c.var.services.contact.listContacts(tenantId, opts);
    return c.json({ success: true as const, data: { contacts: rows, total: rows.length } }, 200);
});

const createContactRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["contacts"], summary: "Create contact for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: CreateContactSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ contact: ContactResponseSchema.describe('TODO describe contact field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Created',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createContact",
    description: "Auto-generated placeholder for createContact (POST /, contacts domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary' }));

contactRoutes.openapi(createContactRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const data = c.req.valid('json');
    const user = c.get('user');
    const contact = await c.var.services.contact.createContact(tenantId, {
        ...data,
        createdByUserId: user?.sub ?? null,
    });
    if (c.env.QBO_CLIENT_ID) {
        c.executionCtx.waitUntil(
            c.var.services.qbo.upsertCustomer(tenantId, contact),
        );
    }
    return c.json({ success: true as const, data: { contact } }, 201);
});

const updateContactRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/{id}',
    tags: ["contacts"], summary: "Replace contact for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateContactSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ contact: ContactResponseSchema.describe('TODO describe contact field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "replaceContact",
    description: "Auto-generated placeholder for replaceContact (PUT /{id}, contacts domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

contactRoutes.openapi(updateContactRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    const raw = c.req.valid('json');
    // Strip undefined keys to satisfy exactOptionalPropertyTypes
    const data: Partial<{ type: 'agent' | 'client'; name: string; email: string | null; phone: string | null; agency: string | null; notes: string | null }> = {};
    if (raw.type !== undefined) data.type = raw.type;
    if (raw.name !== undefined) data.name = raw.name;
    if ('email' in raw) data.email = raw.email ?? null;
    if ('phone' in raw) data.phone = raw.phone ?? null;
    if ('agency' in raw) data.agency = raw.agency ?? null;
    if ('notes' in raw) data.notes = raw.notes ?? null;
    const contact = await c.var.services.contact.updateContact(id as string, tenantId, data);
    if (c.env.QBO_CLIENT_ID) {
        c.executionCtx.waitUntil(
            c.var.services.qbo.upsertCustomer(tenantId, contact),
        );
    }
    return c.json({ success: true as const, data: { contact } }, 200);
});

const deleteContactRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}',
    tags: ["contacts"], summary: "Delete contact for current tenant",
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Deleted',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "deleteContact",
    description: "Auto-generated placeholder for deleteContact (DELETE /{id}, contacts domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary' }));

contactRoutes.openapi(deleteContactRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    await c.var.services.contact.deleteContact(id as string, tenantId);
    return c.json({ success: true }, 200);
});

export default contactRoutes;
