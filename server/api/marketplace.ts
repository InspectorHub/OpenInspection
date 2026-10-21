import { createApiRouter } from '../lib/openapi-router';
import { mounted, type ApiOf } from '../lib/api-schema';
import { Errors, AppError } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import { buildMeta } from '../lib/validations/pagination.schema';
import {
    listMarketplacesRoute, importMarketplaceRoute, listMarketplaceLibrariesRoute, createMarketplaceUpdateRoute,
    importMarketplaceLibraryRoute, createMarketplaceLibrariesUpdateRoute, getMarketplaceLibraryReplacePreviewRoute,
    replaceMarketplaceRoute, listMarketplaceImportsHistoryRoute,
} from './marketplace/route-defs';
import marketplaceSubRoutes, { marketplaceSubRouteParts } from './marketplace/sub-routes';

const app = createApiRouter();
// GET /api/templates/marketplace
app.openapi(listMarketplacesRoute, async (c) => {
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
});
// POST /api/templates/marketplace/:id/import
app.openapi(importMarketplaceRoute, async (c) => {
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
});
// The unified catalogue, filtered by kind.
app.openapi(listMarketplaceLibrariesRoute, async (c) => {
    const q = c.req.valid('query');
    const data = await c.var.services.marketplace.listLibraries(q.kind ? { kind: q.kind } : {});
    return c.json({ success: true, data });
});
// Round 37 — Update an already-imported template to the latest marketplace
// semver. Scheme 2: creates a NEW local copy with a "(vX.Y.Z)" suffix and
// re-points the import marker; the old local row is preserved so existing
// inspections do not break.
app.openapi(createMarketplaceUpdateRoute, async (c) => {
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
app.openapi(importMarketplaceLibraryRoute, async (c) => {
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
});
// Round 37 — Update an already-imported library to the latest marketplace
// semver. Scheme 2: appends new rows; does NOT delete previous import.
app.openapi(createMarketplaceLibrariesUpdateRoute, async (c) => {
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
// #348 — what a replace would cost, before anything is deleted. Read by the
// import-conflict page so the choice is offered against the sentences at stake
// rather than against a count. Inspectors can read it (their rewrites are the
// thing at stake) even though only owner/manager can act on it.
app.openapi(getMarketplaceLibraryReplacePreviewRoute, async (c) => {
    const { libraryId } = c.req.valid('param');
    const data = await c.var.services.marketplace.previewLibraryReplace(libraryId);
    return c.json({ success: true, data }, 200);
});
// Sprint 2 S2-7 — Library "replace" mode update. Swaps prior-import rows for
// the new pack. Owner/admin only. #348 — rows the tenant rewrote survive unless
// confirmLossOfEdits says otherwise; the flag is enforced, not just recorded.
app.openapi(replaceMarketplaceRoute, async (c) => {
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
});
// Sprint 2 S2-8 — Per-import history list. Tenant-scoped, optional template
// or library filter. Used by the version-history drawer on /templates and /comments.
app.openapi(listMarketplaceImportsHistoryRoute, async (c) => {
    const q = c.req.valid('query');
    const result = await c.var.services.importHistory.list({
        ...(q.templateId !== undefined ? { templateId: q.templateId } : {}),
        ...(q.libraryId  !== undefined ? { libraryId:  q.libraryId  } : {}),
        ...(q.page       !== undefined ? { page:       q.page       } : {}),
        ...(q.pageSize   !== undefined ? { pageSize:   q.pageSize   } : {}),
    });
    return c.json({ success: true, data: result }, 200);
});
app.route('/', marketplaceSubRoutes);

/** Registration order, mounts included. Drives `MarketplaceApi`; a test pins it to what `app` really registered. */
export const marketplaceRouteParts = [
    listMarketplacesRoute,
    importMarketplaceRoute,
    listMarketplaceLibrariesRoute,
    createMarketplaceUpdateRoute,
    importMarketplaceLibraryRoute,
    createMarketplaceLibrariesUpdateRoute,
    getMarketplaceLibraryReplacePreviewRoute,
    replaceMarketplaceRoute,
    listMarketplaceImportsHistoryRoute,
    mounted('/', marketplaceSubRoutes, marketplaceSubRouteParts),
] as const;

export type MarketplaceApi = ApiOf<typeof marketplaceRouteParts>;
export default app;
