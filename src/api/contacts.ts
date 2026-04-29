import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HonoConfig } from '../types/hono';
import { requireRole } from '../lib/middleware/rbac';
import {
    CreateContactSchema, UpdateContactSchema,
    ContactResponseSchema, ContactListQuerySchema,
} from '../lib/validations/contact.schema';

const contactRoutes = new OpenAPIHono<HonoConfig>();

const listContactsRoute = createRoute({
    method: 'get', path: '/',
    tags: ['Contacts'], summary: 'List contacts',
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: { query: ContactListQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ contacts: z.array(ContactResponseSchema), total: z.number() }) }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
});

contactRoutes.openapi(listContactsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const q = c.req.valid('query');
    const opts: { type?: 'agent' | 'client'; search?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
    if (q.type) opts.type = q.type;
    if (q.search) opts.search = q.search;
    const rows = await c.var.services.contact.listContacts(tenantId, opts);
    return c.json({ success: true as const, data: { contacts: rows, total: rows.length } }, 200);
});

const createContactRoute = createRoute({
    method: 'post', path: '/',
    tags: ['Contacts'], summary: 'Create contact',
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: CreateContactSchema } } } },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ contact: ContactResponseSchema }) }) } },
            description: 'Created',
        },
    },
    security: [{ bearerAuth: [] }],
});

contactRoutes.openapi(createContactRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const data = c.req.valid('json');
    const contact = await c.var.services.contact.createContact(tenantId, data);
    return c.json({ success: true as const, data: { contact } }, 201);
});

const updateContactRoute = createRoute({
    method: 'put', path: '/{id}',
    tags: ['Contacts'], summary: 'Update contact',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { 'application/json': { schema: UpdateContactSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ contact: ContactResponseSchema }) }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
});

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
    return c.json({ success: true as const, data: { contact } }, 200);
});

const deleteContactRoute = createRoute({
    method: 'delete', path: '/{id}',
    tags: ['Contacts'], summary: 'Delete contact',
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
            description: 'Deleted',
        },
    },
    security: [{ bearerAuth: [] }],
});

contactRoutes.openapi(deleteContactRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    await c.var.services.contact.deleteContact(id as string, tenantId);
    return c.json({ success: true }, 200);
});

export default contactRoutes;
