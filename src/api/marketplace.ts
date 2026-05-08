import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { HonoConfig } from '../types/hono';
import { Errors, AppError } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import {
    LibraryReplaceParamsSchema,
    LibraryReplaceBodySchema,
} from '../lib/validations/library-replace.schema';
import {
    ImportHistoryQuerySchema,
} from '../lib/validations/import-history.schema';

const marketplaceRoutes = new OpenAPIHono<HonoConfig>();

// GET /api/templates/marketplace
marketplaceRoutes.openapi(createRoute({
    method: 'get', path: '/',
    tags: ['Marketplace'],
    summary: 'List marketplace templates',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        query: z.object({
            search:   z.string().optional(),
            category: z.enum(['residential', 'commercial', 'trec', 'condo', 'new_construction']).optional(),
            page:     z.coerce.number().int().min(1).optional(),
            pageSize: z.coerce.number().int().min(1).max(100).optional(),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.array(z.any()) }) } },
            description: 'OK',
        },
    },
}), async (c) => {
    const q = c.req.valid('query');
    const data = await c.var.services.marketplace.list({
        ...(q.search   !== undefined ? { search:   q.search }   : {}),
        ...(q.category !== undefined ? { category: q.category } : {}),
        ...(q.page     !== undefined ? { page:     q.page }     : {}),
        ...(q.pageSize !== undefined ? { pageSize: q.pageSize } : {}),
    });
    return c.json({ success: true, data });
});

// POST /api/templates/marketplace/:id/import
marketplaceRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/import',
    tags: ['Marketplace'],
    summary: 'Import marketplace template as tenant copy',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ localTemplateId: z.string() }) }) } },
            description: 'Imported',
        },
        404: { description: 'Not found' },
    },
}), async (c) => {
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
});

// Spec 5G M2 — Library marketplace (comments, snippets)
marketplaceRoutes.openapi(createRoute({
    method: 'get', path: '/libraries',
    tags: ['Marketplace'],
    summary: 'List marketplace libraries (comment packs, snippet packs)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        query: z.object({ kind: z.enum(['comments', 'snippets']).optional() }),
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.array(z.any()) }) } }, description: 'OK' },
    },
}), async (c) => {
    const q = c.req.valid('query');
    const data = await c.var.services.marketplace.listLibraries(q.kind ? { kind: q.kind } : {});
    return c.json({ success: true, data });
});

// Round 37 — Update an already-imported template to the latest marketplace
// semver. Scheme 2: creates a NEW local copy with a "(vX.Y.Z)" suffix and
// re-points the import marker; the old local row is preserved so existing
// inspections do not break.
marketplaceRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/update',
    tags: ['Marketplace'],
    summary: 'Update tenant copy to latest marketplace version (creates new local copy)',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean(),
                data: z.object({
                    newLocalId: z.string(),
                    newName: z.string(),
                    fromSemver: z.string(),
                    toSemver: z.string(),
                }),
            }) } },
            description: 'Updated',
        },
        400: { description: 'No update available' },
        404: { description: 'Not found' },
    },
}), async (c) => {
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
});

marketplaceRoutes.openapi(createRoute({
    method: 'post', path: '/libraries/{id}/import',
    tags: ['Marketplace'],
    summary: 'Import marketplace library into tenant',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        201: { content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ rowCount: z.number(), localFirstId: z.string() }) }) } }, description: 'Imported' },
        404: { description: 'Not found' },
    },
}), async (c) => {
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
});

// Round 37 — Update an already-imported library to the latest marketplace
// semver. Scheme 2: appends new rows; does NOT delete previous import.
marketplaceRoutes.openapi(createRoute({
    method: 'post', path: '/libraries/{id}/update',
    tags: ['Marketplace'],
    summary: 'Update tenant library import to latest marketplace version (adds new rows)',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean(),
                data: z.object({
                    rowsAdded:  z.number(),
                    newSemver:  z.string(),
                    fromSemver: z.string(),
                }),
            }) } },
            description: 'Updated',
        },
        400: { description: 'No update available' },
        404: { description: 'Not found' },
    },
}), async (c) => {
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
});

// Sprint 2 S2-7 — Library "replace" mode update. Deletes prior-import rows
// before inserting the new pack. Owner/admin only; user must acknowledge the
// edit-loss when prior rows have been modified.
marketplaceRoutes.openapi(createRoute({
    method: 'post', path: '/libraries/{libraryId}/imports/replace',
    tags: ['Marketplace'],
    summary: 'Replace tenant library import (deletes prior rows + inserts new pack)',
    description:
        'Owner/admin only. Deletes all comments rows whose library_id matches ' +
        'the prior import for this tenant, then inserts the new pack. ' +
        'Tenant-authored comments (library_id IS NULL) are never touched.',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: {
        params: LibraryReplaceParamsSchema,
        body: {
            content: {
                'application/json': {
                    schema: LibraryReplaceBodySchema,
                },
            },
            required: false,
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean(),
                data: z.object({
                    rowsAdded:   z.number().int(),
                    rowsDeleted: z.number().int(),
                    fromSemver:  z.string(),
                    toSemver:    z.string(),
                    libraryName: z.string(),
                    mode:        z.literal('replace'),
                }),
            }) } },
            description: 'Replaced',
        },
        400: { description: 'No update available or library not imported' },
        404: { description: 'Library not found' },
    },
}), async (c) => {
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
});

// Sprint 2 S2-8 — Per-import history list. Tenant-scoped, optional template
// or library filter. Used by the version-history drawer on /templates and /comments.
marketplaceRoutes.openapi(createRoute({
    method: 'get', path: '/imports/history',
    tags: ['Marketplace'],
    summary: 'List per-import history events',
    description:
        'Returns install / update / replace / migrate events for the tenant. ' +
        'Filter by templateId or libraryId; paginated.',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { query: ImportHistoryQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean(),
                data: z.object({
                    items:    z.array(z.unknown()),
                    page:     z.number().int(),
                    pageSize: z.number().int(),
                    hasMore:  z.boolean(),
                }),
            }) } },
            description: 'OK',
        },
    },
}), async (c) => {
    const q = c.req.valid('query');
    const result = await c.var.services.importHistory.list({
        ...(q.templateId !== undefined ? { templateId: q.templateId } : {}),
        ...(q.libraryId  !== undefined ? { libraryId:  q.libraryId  } : {}),
        ...(q.page       !== undefined ? { page:       q.page       } : {}),
        ...(q.pageSize   !== undefined ? { pageSize:   q.pageSize   } : {}),
    });
    return c.json({ success: true, data: result }, 200);
});

export default marketplaceRoutes;
