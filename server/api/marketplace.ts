import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { requireCapability } from '../lib/middleware/require-capability';
import { Errors, AppError } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import { LibraryReplaceParamsSchema, LibraryReplaceBodySchema, LibraryReplacePreviewSchema } from '../lib/validations/library-replace.schema';
import { ImportHistoryQuerySchema } from '../lib/validations/import-history.schema';
import { MarketplaceBrowseQuerySchema } from '../lib/validations/marketplace-browse.schema';
import {
    paginationQuerySchema,
    PaginatedMetaSchema,
    buildMeta,
} from '../lib/validations/pagination.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import statutoryUpdateRoutes from './marketplace/statutory-update';

const marketplaceRoutes = createApiRouter()
// GET /api/templates/marketplace
    .openapi(createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["marketplace"],
    summary: "List marketplaces for current tenant",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        query: paginationQuerySchema.merge(MarketplaceBrowseQuerySchema),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean(),
                data:    z.array(z.any()),
                meta:    PaginatedMetaSchema,
            }) } },
            description: 'Paginated list of marketplace catalogue entries for the current tenant.',
        },
    },
    operationId: "listMarketplaces",
    description: "Paginated list of marketplace catalogue entries for the current tenant.",
}, { scopes: ['read'], tier: 'primary' })), async (c) => {
    const q = c.req.valid('query');
    const { rows, total } = await c.var.services.marketplace.list({
        ...(q.search         !== undefined ? { search:         q.search }         : {}),
        ...(q.kind           !== undefined ? { kind:           q.kind }           : {}),
        ...(q.propertyType   !== undefined ? { propertyType:   q.propertyType }   : {}),
        ...(q.jurisdiction   !== undefined ? { jurisdiction:   q.jurisdiction }   : {}),
        ...(q.inspectionKind !== undefined ? { inspectionKind: q.inspectionKind } : {}),
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
    // `importCatalogEntry` MINTS A LOCAL TEMPLATE for a kind='templates' entry,
    // so this is a template-import path and wears templateImport (#307).
    //
    // The gate is an over-approximation for the OTHER kind this same handler
    // serves: a comments pack import is not a template import, but a route gate
    // takes exactly one capability and the handler does not know the kind until
    // it has read the row. Erring toward the template verb is the conservative
    // half -- owner/manager hold templateImport by default, so the practical
    // effect is confined to a workspace that has deliberately revoked it.
    middleware: [requireRole('owner', 'manager'), requireCapability('templateImport')] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ localTemplateId: z.string().nullable().describe('Local template id for a 1:1 kind; null for a 1:N kind, which produces row_count rows rather than one') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Imported',
        },
        403: { description: "Missing the 'templateImport' capability" },
        404: { description: 'Not found' },
    },
    operationId: "importMarketplace",
    description: "Auto-generated placeholder for importMarketplace (POST /{id}/import, marketplace domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended', capability: 'templateImport' })), async (c) => {
    const { id } = c.req.valid('param');
    try {
        const result = await c.var.services.marketplace.importCatalogEntry(id);
        return c.json({ success: true, data: { localTemplateId: result.localEntityId } }, 201);
    } catch (err) {
        if (err instanceof Error && err.message === 'Marketplace entry not found') {
            throw Errors.NotFound('Marketplace template not found');
        }
        throw err;
    }
})
// The unified catalogue, filtered by kind.
    .openapi(createRoute(withMcpMetadata({
    method: 'get', path: '/libraries',
    tags: ["marketplace"],
    summary: 'List marketplace catalogue entries (comment packs, templates)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        query: z.object({ kind: z.enum(['comments', 'templates']).optional().describe('TODO describe kind field for the OpenInspection MCP integration') }).describe('TODO describe query field for the OpenInspection MCP integration'),
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
    // Scheme 2 mints a SECOND local template row, so "update to latest" is a
    // template import by any measure that matters here (#307).
    middleware: [requireRole('owner', 'manager'), requireCapability('templateImport')] as const,
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
        403: { description: "Missing the 'templateImport' capability" },
        404: { description: 'Not found' },
    },
    operationId: "createMarketplaceUpdate",
    description: "Auto-generated placeholder for createMarketplaceUpdate (POST /{id}/update, marketplace domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended', capability: 'templateImport' })), async (c) => {
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
    // The SAME handler as POST /{id}/import above -- one `importCatalogEntry`
    // call, so this route mints a local template for a kind='templates' entry
    // exactly as that one does. It is not in the #307 plan's table; the plan's
    // enumerating grep was `insert(templates)` and this path writes
    // `insert(templates as any)`, which that pattern does not match.
    middleware: [requireRole('owner', 'manager'), requireCapability('templateImport')] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        201: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ kind: z.enum(['comments', 'templates', 'statutory']).describe('Which shape the import produced'), rowCount: z.number().describe('Rows created for a 1:N kind; 0 for a 1:1 kind'), localEntityId: z.string().nullable().describe('Local row id for a 1:1 kind; null for a 1:N kind') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } }, description: 'Imported' },
        403: { description: "Missing the 'templateImport' capability" },
        404: { description: 'Not found' },
    },
    operationId: "importMarketplace",
    description: "Auto-generated placeholder for importMarketplace (POST /libraries/{id}/import, marketplace domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended', capability: 'templateImport' })), async (c) => {
    const { id } = c.req.valid('param');
    try {
        const result = await c.var.services.marketplace.importCatalogEntry(id);
        return c.json({ success: true, data: result }, 201);
    } catch (err) {
        if (err instanceof Error && err.message === 'Marketplace entry not found') {
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
    // Deliberately NO template capability: `updateLibraryImport` refuses any
    // kind other than 'comments' outright, so this path cannot reach the
    // `templates` table. Said here so the next auditor does not re-derive it.
    middleware: [requireRole('owner', 'manager')] as const,
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
// #348 — what a replace would cost, before anything is deleted. Read by the
// import-conflict page so the choice is offered against the sentences at stake
// rather than against a count. Inspectors can read it (their rewrites are the
// thing at stake) even though only owner/manager can act on it.
    .openapi(createRoute(withMcpMetadata({
    method: 'get', path: '/libraries/{libraryId}/imports/replace/preview',
    tags: ["marketplace"],
    summary: 'Preview which imported comments a replace would overwrite',
    description: "Lists the comments this tenant rewrote since importing the library, each beside the publisher's version in the pending release, so a destructive replace can be decided against the actual text rather than a count.",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: LibraryReplaceParamsSchema },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: LibraryReplacePreviewSchema }) } },
            description: 'Conflict preview',
        },
        400: { description: 'No update available, library not imported, or not a comment library' },
        404: { description: 'Library not found' },
    },
    operationId: "getMarketplaceLibraryReplacePreview",
}, { scopes: ['read'], tier: 'extended' })), async (c) => {
    const { libraryId } = c.req.valid('param');
    const data = await c.var.services.marketplace.previewLibraryReplace(libraryId);
    return c.json({ success: true, data }, 200);
})
// Sprint 2 S2-7 — Library "replace" mode update. Swaps prior-import rows for
// the new pack. Owner/admin only. #348 — rows the tenant rewrote survive unless
// confirmLossOfEdits says otherwise; the flag is enforced, not just recorded.
    .openapi(createRoute(withMcpMetadata({
    method: 'post', path: '/libraries/{libraryId}/imports/replace',
    tags: ["marketplace"],
    summary: 'Replace tenant library import (swaps prior rows for the new pack)',
    description: "Replaces the rows a previous import of this library created with the current release's. Comments the tenant rewrote since importing are kept unless confirmLossOfEdits is true; tenant-authored comments are never touched.",
    // Same reason as /libraries/{id}/update above: 'replace' mode deletes and
    // re-inserts `comments` rows only, and the kind guard rejects everything
    // else before that. No template is minted, so no template capability.
    middleware: [requireRole('owner', 'manager')] as const,
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
                    rowsAdded:     z.number().int().describe('Rows the new pack inserted'),
                    rowsDeleted:   z.number().int().describe('Prior-import rows removed'),
                    rowsPreserved: z.number().int().describe('Rows the tenant had rewritten and that were kept'),
                    fromSemver:    z.string().describe('Version imported before this call'),
                    toSemver:      z.string().describe('Version now imported'),
                    libraryName:   z.string().describe('Display name of the library'),
                    mode:          z.literal('replace').describe('Always "replace" on this route'),
                }).describe('Outcome of the replace'),
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
                mode:          'replace',
                fromSemver:    result.fromSemver,
                toSemver:      result.toSemver,
                rowsAdded:     result.rowsAdded,
                rowsDeleted:   result.rowsDeleted,
                rowsPreserved: result.rowsPreserved,
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
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
})
    .route('/', statutoryUpdateRoutes);

export type MarketplaceApi = typeof marketplaceRoutes;
export default marketplaceRoutes;
