/**
 * Route definitions of the marketplace router in ../marketplace.ts. Moved out of that file unchanged so it stays
 * under its size cap; the handlers and the registration order are in marketplace.ts.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import { LibraryReplaceParamsSchema, LibraryReplaceBodySchema, LibraryReplacePreviewSchema } from '../../lib/validations/library-replace.schema';
import { ImportHistoryQuerySchema } from '../../lib/validations/import-history.schema';
import { MarketplaceBrowseQuerySchema } from '../../lib/validations/marketplace-browse.schema';
import { MARKETPLACE_KINDS } from '../../lib/marketplace-kinds';
import { paginationQuerySchema, PaginatedMetaSchema } from '../../lib/validations/pagination.schema';
import { withMcpMetadata } from "../../lib/route-metadata-standards";

export const listMarketplacesRoute = createRoute(withMcpMetadata({
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
}, { scopes: ['read'], tier: 'primary' }));

export const importMarketplaceRoute = createRoute(withMcpMetadata({
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
    request: { params: z.object({ id: z.string().describe('Marketplace catalogue entry to import.') }) },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ localTemplateId: z.string().nullable().describe('Local template id for a 1:1 kind; null for a 1:N kind, which produces row_count rows rather than one') }) }) } },
            description: 'Imported',
        },
        403: { description: "Missing the 'templateImport' capability" },
        404: { description: 'Not found' },
    },
    operationId: "importMarketplace",
    description: "Install a marketplace catalogue entry into the company. A template or statutory form entry becomes one new local template (returned as localTemplateId); a comment pack becomes a set of canned comments and returns localTemplateId null. The kind is read from the entry, and a template schema that is not valid v2 is refused. Idempotent: importing something already installed returns what the first import produced and creates nothing; an entry that was uninstalled is reinstalled. Returns 404 for an unknown entry. Same handler as the libraries import route. Needs the template import capability and the owner or manager role."
}, { scopes: ['write'], tier: 'extended', capability: 'templateImport' }));

export const listMarketplaceLibrariesRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/libraries',
    tags: ["marketplace"],
    summary: 'List marketplace catalogue entries (comment packs, templates)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        query: z.object({ kind: z.enum(MARKETPLACE_KINDS).optional().describe('Return only entries of this kind. Omit to list every kind.') }),
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.array(z.any()) }) } }, description: 'OK' },
    },
    operationId: "listMarketplaceLibraries",
    description: "Lists the marketplace catalogue (comment packs, templates and statutory forms) as one unpaginated array, up to 1000 entries, optionally narrowed to one kind. Delisted entries are not shown. Featured entries come first, then by download count. Each entry carries the company's own install state: importedSemver is the installed version (null if not installed or uninstalled) and hasUpdate says a newer version exists. The pack content itself is not returned, only itemCount and the description. The paginated catalogue route offers search and further filters. Read-only. Available to owner, manager and inspector roles."
}, { scopes: ['read'], tier: 'extended' }));

export const createMarketplaceUpdateRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/update',
    tags: ["marketplace"],
    summary: 'Update tenant copy to latest marketplace version (creates new local copy)',
    // Scheme 2 mints a SECOND local template row, so "update to latest" is a
    // template import by any measure that matters here (#307).
    middleware: [requireRole('owner', 'manager'), requireCapability('templateImport')] as const,
    request: { params: z.object({ id: z.string().describe('Marketplace template entry that is already imported and has a newer version.') }) },
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
        403: { description: "Missing the 'templateImport' capability" },
        404: { description: 'Not found' },
    },
    operationId: "createMarketplaceUpdate",
    description: "Update an installed marketplace template to its latest version. Does not edit the existing template: it creates a new local template named with a (vX.Y.Z) suffix, points the import record at it, and leaves the old template in place so existing inspections keep working (a statutory form's superseded copy is retired from the pickers, never deleted). Records a template.marketplace.updated audit entry. Returns 400 when the entry is not a template or statutory form, was never imported, was uninstalled, or is already on the latest version, and 404 for an unknown entry. Comment packs use the libraries update route instead. Needs the template import capability and the owner or manager role."
}, { scopes: ['write'], tier: 'extended', capability: 'templateImport' }));

export const importMarketplaceLibraryRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/libraries/{id}/import',
    tags: ["marketplace"],
    summary: 'Import marketplace library into tenant',
    // The SAME handler as POST /{id}/import above -- one `importCatalogEntry`
    // call, so this route mints a local template for a kind='templates' entry
    // exactly as that one does. It is not in the #307 plan's table; the plan's
    // enumerating grep was `insert(templates)` and this path writes
    // `insert(templates as any)`, which that pattern does not match.
    middleware: [requireRole('owner', 'manager'), requireCapability('templateImport')] as const,
    request: { params: z.object({ id: z.string().describe('Marketplace library to install.') }) },
    responses: {
        201: { content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ kind: z.enum(['comments', 'templates', 'statutory']).describe('Which shape the import produced'), rowCount: z.number().describe('Rows created for a 1:N kind; 0 for a 1:1 kind'), localEntityId: z.string().nullable().describe('Local row id for a 1:1 kind; null for a 1:N kind') }) }) } }, description: 'Imported' },
        403: { description: "Missing the 'templateImport' capability" },
        404: { description: 'Not found' },
    },
    operationId: "importMarketplaceLibrary",
    description: "Install a marketplace library into the company, whatever its kind: a comment pack creates canned comments (rowCount rows), a template or statutory form creates one local template. Runs the same import as the catalogue import route, so it is idempotent (a library already installed returns its earlier result and creates nothing) and reinstalls one that was uninstalled. Returns 404 for an unknown library; any other failure is returned as a 500 with code import_failed and the error detail. Needs the template import capability and the owner or manager role."
}, { scopes: ['write'], tier: 'extended', capability: 'templateImport' }));

export const createMarketplaceLibrariesUpdateRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/libraries/{id}/update',
    tags: ["marketplace"],
    summary: 'Update tenant library import to latest marketplace version (adds new rows)',
    // Deliberately NO template capability: `updateLibraryImport` refuses any
    // kind other than 'comments' outright, so this path cannot reach the
    // `templates` table. Said here so the next auditor does not re-derive it.
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: z.object({ id: z.string().describe('Comment pack library that is already imported and has a newer version.') }) },
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
    operationId: "createMarketplaceLibrariesUpdate",
    description: "Update an installed comment pack to its latest version in append mode: inserts the new release's comments as additional rows and does not delete or change the rows the earlier import created (use the replace route to swap them). Only comment packs are supported; template libraries are refused here. Records a library.marketplace.updated audit entry. Returns 400 when the library was never imported, was uninstalled, or is already on the latest version, and 404 for an unknown library. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

export const getMarketplaceLibraryReplacePreviewRoute = createRoute(withMcpMetadata({
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
}, { scopes: ['read'], tier: 'extended' }));

export const replaceMarketplaceRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/libraries/{libraryId}/imports/replace',
    tags: ["marketplace"],
    summary: 'Replace tenant library import (swaps prior rows for the new pack)',
    description: "Replaces the rows a previous import of this library created with the current release's. Comments the tenant rewrote since importing are kept unless confirmLossOfEdits is true; tenant-authored comments are never touched.",
    // Same reason as /libraries/{id}/update above: 'replace' mode deletes and
    // re-inserts `comments` rows only, and the kind guard rejects everything
    // else before that. No template is minted, so no template capability.
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: LibraryReplaceParamsSchema,
        body: {
            content: {
                'application/json': {
                    schema: LibraryReplaceBodySchema.describe('Replace options; the body may be omitted to keep rows the company rewrote.'),
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
}, { scopes: ['write'], tier: 'extended' }));

export const listMarketplaceImportsHistoryRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/imports/history',
    tags: ["marketplace"],
    summary: 'List per-import history events',
    description: "Lists the company's marketplace import history events, newest first, paged with page and pageSize (default page 1, 20 per page; the response carries hasMore rather than a total). Each event records the action (such as install, update, replace or uninstall), source and target versions, the number of rows affected, extra metadata, creation time and the user who did it. Filter by templateId or libraryId to see one item's history. Read-only. Available to owner, manager and inspector roles.",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
    operationId: "listMarketplaceImportsHistory"
}, { scopes: ['read'], tier: 'extended' }));
