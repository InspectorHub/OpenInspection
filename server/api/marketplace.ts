import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { Errors, AppError } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import {
    LibraryReplaceParamsSchema,
    LibraryReplaceBodySchema,
} from '../lib/validations/library-replace.schema';
import {
    ImportHistoryQuerySchema,
} from '../lib/validations/import-history.schema';
import {
    paginationQuerySchema,
    PaginatedMetaSchema,
    buildMeta,
} from '../lib/validations/pagination.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

export const marketplaceRoutes = createApiRouter()
// GET /api/templates/marketplace
    .openapi(createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["marketplace"],
    summary: "List marketplaces for current tenant",
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        query: paginationQuerySchema.extend({
            search:   z.string().optional().describe('Free-text search over marketplace template names'),
            category: z.enum(['residential', 'commercial', 'trec', 'condo', 'new_construction', 'standards_aligned']).optional().describe('Filter marketplace templates by inspection category'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean(),
                data:    z.array(z.any()),
                meta:    PaginatedMetaSchema,
            }) } },
            description: 'Paginated list of marketplace templates for the current tenant.',
        },
    },
    operationId: "listMarketplaces",
    description: "Paginated list of marketplace templates for the current tenant.",
}, { scopes: ['read'], tier: 'primary' })), async (c) => {
    const q = c.req.valid('query');
    const { rows, total } = await c.var.services.marketplace.list({
        ...(q.search   !== undefined ? { search:   q.search }   : {}),
        ...(q.category !== undefined ? { category: q.category } : {}),
        page:     q.page,
        pageSize: q.pageSize,
    });
    return c.json({
        success: true,
        data: rows,
        meta: buildMeta({ total, page: q.page, pageSize: q.pageSize }),
    });
})
// POST /api/templates/marketplace/:id/import
    .openapi(createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/import',
    tags: ["marketplace"],
    summary: 'Import marketplace template as tenant copy',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ localTemplateId: z.string().describe('TODO describe localTemplateId field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Imported',
        },
        404: { description: 'Not found' },
    },
    operationId: "importMarketplace",
    description: "Auto-generated placeholder for importMarketplace (POST /{id}/import, marketplace domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id } = c.req.valid('param');
    try {
        const localTemplateId = await c.var.services.marketplace.importTemplate(id);
        return c.json({ success: true, data: { localTemplateId } }, 201);
    } catch (err) {
        if (err instanceof Error && err.message === 'Marketplace template not found') {
            throw Errors.NotFound('Marketplace template not found');
        }
        throw err;
    }
})
// Spec 5G M2 — Library marketplace (comments, snippets)
    .openapi(createRoute(withMcpMetadata({
    method: 'get', path: '/libraries',
    tags: ["marketplace"],
    summary: 'List marketplace libraries (comment packs, snippet packs)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        query: z.object({ kind: z.enum(['comments', 'snippets']).optional().describe('TODO describe kind field for the OpenInspection MCP integration') }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'), data: z.array(z.any()).describe('TODO describe data field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'OK' },
    },
    operationId: "listMarketplaceLibraries",
    description: "Auto-generated placeholder for listMarketplaceLibraries (GET /libraries, marketplace domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' })), async (c) => {
    const q = c.req.valid('query');
    const data = await c.var.services.marketplace.listLibraries(q.kind ? { kind: q.kind } : {});
    return c.json({ success: true, data });
})
// Round 37 — Update an already-imported template to the latest marketplace
// semver. Scheme 2: creates a NEW local copy with a "(vX.Y.Z)" suffix and
// re-points the import marker; the old local row is preserved so existing
// inspections do not break.
    .openapi(createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/update',
    tags: ["marketplace"],
    summary: 'Update tenant copy to latest marketplace version (creates new local copy)',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
                data: z.object({
                    newLocalId: z.string().describe('TODO describe newLocalId field for the OpenInspection MCP integration'),
                    newName: z.string().describe('TODO describe newName field for the OpenInspection MCP integration'),
                    fromSemver: z.string().describe('TODO describe fromSemver field for the OpenInspection MCP integration'),
                    toSemver: z.string().describe('TODO describe toSemver field for the OpenInspection MCP integration'),
                }).describe('TODO describe data field for the OpenInspection MCP integration'),
            }) } },
            description: 'Updated',
        },
        400: { description: 'No update available' },
        404: { description: 'Not found' },
    },
    operationId: "createMarketplaceUpdate",
    description: "Auto-generated placeholder for createMarketplaceUpdate (POST /{id}/update, marketplace domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id } = c.req.valid('param');
    try {
        const result = await c.var.services.marketplace.updateTemplateImport(id);
        auditFromContext(c, 'template.marketplace.updated', 'template', {
            entityId: result.newLocalId,
            metadata: {
                marketplaceId: id,
                fromSemver:    result.fromSemver,
                toSemver:      result.toSemver,
                oldLocalId:    result.oldLocalId,
                newLocalId:    result.newLocalId,
            },
        });
        return c.json({
            success: true,
            data: {
                newLocalId: result.newLocalId,
                newName:    result.newName,
                fromSemver: result.fromSemver,
                toSemver:   result.toSemver,
            },
        }, 200);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw err;
    }
})
    .openapi(createRoute(withMcpMetadata({
    method: 'post', path: '/libraries/{id}/import',
    tags: ["marketplace"],
    summary: 'Import marketplace library into tenant',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        201: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ rowCount: z.number().describe('TODO describe rowCount field for the OpenInspection MCP integration'), localFirstId: z.string().describe('TODO describe localFirstId field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } }, description: 'Imported' },
        404: { description: 'Not found' },
    },
    operationId: "importMarketplace",
    description: "Auto-generated placeholder for importMarketplace (POST /libraries/{id}/import, marketplace domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id } = c.req.valid('param');
    try {
        const result = await c.var.services.marketplace.importLibrary(id);
        return c.json({ success: true, data: result }, 201);
    } catch (err) {
        if (err instanceof Error && err.message === 'Marketplace library not found') {
            throw Errors.NotFound('Marketplace library not found');
        }
        // Diagnostic: surface real error to caller for debugging
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? (err.stack || '').slice(0, 500) : '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return c.json({ success: false, error: { code: 'import_failed', message: msg, stack } }, 500) as any;
    }
})
// Round 37 — Update an already-imported library to the latest marketplace
// semver. Scheme 2: appends new rows; does NOT delete previous import.
    .openapi(createRoute(withMcpMetadata({
    method: 'post', path: '/libraries/{id}/update',
    tags: ["marketplace"],
    summary: 'Update tenant library import to latest marketplace version (adds new rows)',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
                data: z.object({
                    rowsAdded:  z.number().describe('TODO describe rowsAdded field for the OpenInspection MCP integration'),
                    newSemver:  z.string().describe('TODO describe newSemver field for the OpenInspection MCP integration'),
                    fromSemver: z.string().describe('TODO describe fromSemver field for the OpenInspection MCP integration'),
                }).describe('TODO describe data field for the OpenInspection MCP integration'),
            }) } },
            description: 'Updated',
        },
        400: { description: 'No update available' },
        404: { description: 'Not found' },
    },
    operationId: "createMarketplaceLibrariesUpdate",
    description: "Auto-generated placeholder for createMarketplaceLibrariesUpdate (POST /libraries/{id}/update, marketplace domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id } = c.req.valid('param');
    try {
        const result = await c.var.services.marketplace.updateLibraryImport(id);
        auditFromContext(c, 'library.marketplace.updated', 'library', {
            entityId: id,
            metadata: {
                libraryId:   id,
                libraryName: result.libraryName,
                fromSemver:  result.fromSemver,
                toSemver:    result.toSemver,
                rowsAdded:   result.rowsAdded,
            },
        });
        return c.json({
            success: true,
            data: {
                rowsAdded:  result.rowsAdded,
                newSemver:  result.toSemver,
                fromSemver: result.fromSemver,
            },
        }, 200);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw err;
    }
})
// Sprint 2 S2-7 — Library "replace" mode update. Deletes prior-import rows
// before inserting the new pack. Owner/admin only; user must acknowledge the
// edit-loss when prior rows have been modified.
    .openapi(createRoute(withMcpMetadata({
    method: 'post', path: '/libraries/{libraryId}/imports/replace',
    tags: ["marketplace"],
    summary: 'Replace tenant library import (deletes prior rows + inserts new pack)',
    description: "Auto-generated placeholder for replaceMarketplace (POST /libraries/{libraryId}/imports/replace, marketplace domain). TODO: replace with a real description sourced from the handler.",
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: {
        params: LibraryReplaceParamsSchema.describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: LibraryReplaceBodySchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            required: false,
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
                data: z.object({
                    rowsAdded:   z.number().int().describe('TODO describe rowsAdded field for the OpenInspection MCP integration'),
                    rowsDeleted: z.number().int().describe('TODO describe rowsDeleted field for the OpenInspection MCP integration'),
                    fromSemver:  z.string().describe('TODO describe fromSemver field for the OpenInspection MCP integration'),
                    toSemver:    z.string().describe('TODO describe toSemver field for the OpenInspection MCP integration'),
                    libraryName: z.string().describe('TODO describe libraryName field for the OpenInspection MCP integration'),
                    mode:        z.literal('replace').describe('TODO describe mode field for the OpenInspection MCP integration'),
                }).describe('TODO describe data field for the OpenInspection MCP integration'),
            }) } },
            description: 'Replaced',
        },
        400: { description: 'No update available or library not imported' },
        404: { description: 'Library not found' },
    },
    operationId: "replaceMarketplace"
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { libraryId } = c.req.valid('param');
    let body: { confirmLossOfEdits?: boolean } | undefined;
    try { body = c.req.valid('json'); } catch { body = undefined; }

    const userId = (c.get('user')?.sub as string) || 'system';
    try {
        const result = await c.var.services.marketplace.updateLibraryImport(libraryId, {
            mode: 'replace',
            confirmLossOfEdits: body?.confirmLossOfEdits ?? false,
            userId,
        });

        auditFromContext(c, 'library.marketplace.updated', 'library', {
            entityId: libraryId,
            metadata: {
                mode:        'replace',
                fromSemver:  result.fromSemver,
                toSemver:    result.toSemver,
                rowsAdded:   result.rowsAdded,
                rowsDeleted: result.rowsDeleted,
            },
        });

        return c.json({ success: true, data: result }, 200);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw err;
    }
})
// Sprint 2 S2-8 — Per-import history list. Tenant-scoped, optional template
// or library filter. Used by the version-history drawer on /templates and /comments.
    .openapi(createRoute(withMcpMetadata({
    method: 'get', path: '/imports/history',
    tags: ["marketplace"],
    summary: 'List per-import history events',
    description: "Auto-generated placeholder for listMarketplaceImportsHistory (GET /imports/history, marketplace domain). TODO: replace with a real description sourced from the handler.",
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { query: ImportHistoryQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
                data: z.object({
                    items:    z.array(z.unknown()).describe('TODO describe items field for the OpenInspection MCP integration'),
                    page:     z.number().int().describe('TODO describe page field for the OpenInspection MCP integration'),
                    pageSize: z.number().int().describe('TODO describe pageSize field for the OpenInspection MCP integration'),
                    hasMore:  z.boolean().describe('TODO describe hasMore field for the OpenInspection MCP integration'),
                }).describe('TODO describe data field for the OpenInspection MCP integration'),
            }) } },
            description: 'OK',
        },
    },
    operationId: "listMarketplaceImportsHistory"
}, { scopes: ['read'], tier: 'extended' })), async (c) => {
    const q = c.req.valid('query');
    const result = await c.var.services.importHistory.list({
        ...(q.templateId !== undefined ? { templateId: q.templateId } : {}),
        ...(q.libraryId  !== undefined ? { libraryId:  q.libraryId  } : {}),
        ...(q.page       !== undefined ? { page:       q.page       } : {}),
        ...(q.pageSize   !== undefined ? { pageSize:   q.pageSize   } : {}),
    });
    return c.json({ success: true, data: result }, 200);
});

export type MarketplaceApi = typeof marketplaceRoutes;
export default marketplaceRoutes;
