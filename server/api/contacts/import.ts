import { createRoute } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import {
    ContactImportPreviewSchema, ContactImportPreviewResponseSchema,
    ContactImportSchema, ContactImportResponseSchema,
} from '../../lib/validations/contact.schema';
import { parseCsvPreview, importContacts } from '../../services/contacts-import.service';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

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

export const contactsImportRoutes = createApiRouter()
    .openapi(importPreviewRoute, async (c) => {
        const { csv } = c.req.valid('json');
        const data = parseCsvPreview(csv);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(importRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { csv, mapping } = c.req.valid('json');
        const db = drizzle(c.env.DB);
        const data = await importContacts(db, tenantId, csv, mapping);
        return c.json({ success: true as const, data }, 200);
    });

export type ContactsImportApi = typeof contactsImportRoutes;
export default contactsImportRoutes;
