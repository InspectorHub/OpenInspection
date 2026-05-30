import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import {
    CreateContactSchema, UpdateContactSchema,
    ContactResponseSchema, ContactListQuerySchema,
    ContactImportPreviewSchema, ContactImportPreviewResponseSchema,
    ContactImportSchema, ContactImportResponseSchema,
} from '../lib/validations/contact.schema';
import { parseCsvPreview, importContacts } from '../services/contacts-import.service';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const listContactsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["contacts"], summary: "List contacts for current tenant",
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: { query: ContactListQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.array(ContactResponseSchema).describe('TODO describe data field for the OpenInspection MCP integration'), meta: z.object({ total: z.number().describe('TODO describe total field for the OpenInspection MCP integration') }).describe('TODO describe meta field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listContacts",
    description: "Auto-generated placeholder for listContacts (GET /, contacts domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'primary' }));

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

// ─── CSV bulk import (preview + commit) ─────────────────────────────────────
const importPreviewRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/import/preview',
    tags: ['contacts'], summary: 'Preview parsed CSV rows for the contact-import mapping UI',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: { content: { 'application/json': { schema: ContactImportPreviewSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ContactImportPreviewResponseSchema } },
            description: 'Preview parsed rows',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'previewContactImport',
    description: 'Parses the first 20 rows of an uploaded CSV blob without writing to the DB so the frontend can render a column-mapping UI before commit.',
}, { scopes: ['write'], tier: 'extended' }));

const importRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/import',
    tags: ['contacts'], summary: 'Bulk-insert contacts from a CSV blob + mapping',
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        body: { content: { 'application/json': { schema: ContactImportSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ContactImportResponseSchema } },
            description: 'Import complete',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'importContacts',
    description: 'Bulk-inserts contacts from a previously-previewed CSV blob using the user-confirmed column mapping. Per-row errors are returned in the response without aborting the batch.',
}, { scopes: ['write'], tier: 'extended' }));

export const contactRoutes = createApiRouter()
    .openapi(listContactsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const q = c.req.valid('query');
        const opts: { type?: 'agent' | 'client'; search?: string; limit: number; offset: number } = { limit: q.limit, offset: q.offset };
        if (q.type) opts.type = q.type;
        if (q.search) opts.search = q.search;
        const rows = await c.var.services.contact.listContacts(tenantId, opts);
        return c.json({ success: true as const, data: rows, meta: { total: rows.length } }, 200);
    })
    .openapi(createContactRoute, async (c) => {
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
    })
    .openapi(updateContactRoute, async (c) => {
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
    })
    .openapi(deleteContactRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        await c.var.services.contact.deleteContact(id as string, tenantId);
        return c.json({ success: true }, 200);
    })
    .openapi(importPreviewRoute, async (c) => {
        const { csv } = c.req.valid('json');
        const data = parseCsvPreview(csv);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(importRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { csv, mapping } = c.req.valid('json');
        const db = drizzle<any>(c.env.DB as any);
        const data = await importContacts(db, tenantId, csv, mapping);
        return c.json({ success: true as const, data }, 200);
    });

export type ContactsApi = typeof contactRoutes;

export default contactRoutes;
