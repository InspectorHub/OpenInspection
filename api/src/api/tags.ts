/**
 * Sprint 3 S3-3 — Tag API.
 *
 * Tenant-scoped CRUD over the `tags` table plus link/unlink endpoints
 * for inspection items. Inspectors can create + link tags; only owners
 * and admins can rename / delete them.
 *
 * Routes mounted at `/api/tags` (library) and a small parallel set under
 * `/api/inspections/:id/items/:itemId/tags` (item links).
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { Errors } from '../lib/errors';
import {
    CreateTagSchema,
    UpdateTagSchema,
    TagListResponseSchema,
    TagSingleResponseSchema,
    TagDeleteResponseSchema,
    TagLinkResponseSchema,
    TagUnlinkResponseSchema,
} from '../lib/validations/tag.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const IdParamSchema = z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') });

const InspectionItemTagParamsSchema = z.object({
    id:     z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    itemId: z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
});

const InspectionItemTagWithTagParamsSchema = z.object({
    id:     z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration'),
    itemId: z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
    tagId:  z.string().min(1).describe('TODO describe tagId field for the OpenInspection MCP integration'),
});

const LinkBodySchema = z.object({ tagId: z.string().min(1).describe('TODO describe tagId field for the OpenInspection MCP integration') }).strict();

const InspectionIdParamSchema = z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') });

/* ── GET /api/tags ────────────────────────────────────────────────────── */
const listTagsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["tags"],
    summary: 'List tags for the current tenant (seed + custom)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: { content: { 'application/json': { schema: TagListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'List' },
    },
    operationId: "listTags",
    description: "Auto-generated placeholder for listTags (GET /, tags domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/* ── POST /api/tags ───────────────────────────────────────────────────── */
const createTagRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["tags"],
    summary: 'Create a custom tag',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { body: { content: { 'application/json': { schema: CreateTagSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: TagSingleResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Created' },
    },
    operationId: "createTag",
    description: "Auto-generated placeholder for createTag (POST /, tags domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/* ── PUT /api/tags/:id ────────────────────────────────────────────────── */
const replaceTagRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/{id}',
    tags: ["tags"],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: {
        params: IdParamSchema.describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateTagSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: TagSingleResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Updated' },
    },
    operationId: "replaceTag",
    summary: "Replace tag for current tenant",
    description: "Auto-generated placeholder for replaceTag (PUT /{id}, tags domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/* ── GET /api/tags/:id/inspections ─────────────────────────────────────
 *  Sprint 3 S3-3 — list filter. Returns the distinct inspection ids in the
 *  tenant that have at least one item linked to this tag. The dashboard
 *  uses this to scope its flat list view to "by tag".
 */
const listTagInspectionsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/inspections',
    tags: ["tags"],
    summary: 'List inspections that have any item tagged with this tag',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: IdParamSchema.describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data:    z.object({ inspectionIds: z.array(z.string()).describe('TODO describe inspectionIds field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Inspection ids',
        },
    },
    operationId: "listTagInspections",
    description: "Auto-generated placeholder for listTagInspections (GET /{id}/inspections, tags domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/* ── DELETE /api/tags/:id ─────────────────────────────────────────────── */
const deleteTagRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}',
    tags: ["tags"],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: IdParamSchema.describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: TagDeleteResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Deleted' },
    },
    operationId: "deleteTag",
    summary: "Delete tag for current tenant",
    description: "Auto-generated placeholder for deleteTag (DELETE /{id}, tags domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const tagsRoutes = createApiRouter()
    .openapi(listTagsRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        // Lazy-seed canonical tags so first-time tenants always see the five.
        await c.var.services.tag.seedDefaults(tenantId);
        const data = await c.var.services.tag.list(tenantId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(createTagRoute, async (c) => {
        const input = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        const tag = await c.var.services.tag.create(tenantId, input);
        auditFromContext(c, 'tag.created', 'tag', { entityId: tag.id, metadata: { name: tag.name } });
        return c.json({ success: true as const, data: tag }, 200);
    })
    .openapi(replaceTagRoute, async (c) => {
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        const tag = await c.var.services.tag.update(id, tenantId, patch);
        auditFromContext(c, 'tag.updated', 'tag', { entityId: tag.id });
        return c.json({ success: true as const, data: tag }, 200);
    })
    .openapi(listTagInspectionsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        // Tenant-scope guard via lookup — refuses cross-tenant ids.
        const tag = await c.var.services.tag.get(id, tenantId);
        if (!tag) throw Errors.NotFound('Tag not found');
        const inspectionIds = await c.var.services.tag.listInspectionsByTag(tenantId, id);
        return c.json({ success: true as const, data: { inspectionIds } }, 200);
    })
    .openapi(deleteTagRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        const result = await c.var.services.tag.delete(id, tenantId);
        auditFromContext(c, 'tag.deleted', 'tag', { entityId: id });
        return c.json({ success: true as const, data: result }, 200);
    });

export type TagsApi = typeof tagsRoutes;

/* ─── Item-link sub-routes ────────────────────────────────────────────── */
//
// Mounted separately under /api/inspections so the path can carry the
// inspection id + item id directly. We keep them in this file so all
// tag endpoints live together.

/* ── GET /api/inspections/:id/items/:itemId/tags ──────────────────────── */
const listInspectionItemTagsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/items/{itemId}/tags',
    tags: ["tags"],
    summary: 'List tags linked to an inspection item',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: InspectionItemTagParamsSchema.describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: TagListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Item tags' },
    },
    operationId: "listTagItemsTags",
    description: "Auto-generated placeholder for listTagItemsTags (GET /{id}/items/{itemId}/tags, tags domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/* ── POST /api/inspections/:id/items/:itemId/tags ─────────────────────── */
const linkInspectionItemTagRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/items/{itemId}/tags',
    tags: ["tags"],
    summary: 'Link a tag to an inspection item',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: InspectionItemTagParamsSchema.describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: LinkBodySchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: TagLinkResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Linked' },
    },
    operationId: "createTagItemsTags",
    description: "Auto-generated placeholder for createTagItemsTags (POST /{id}/items/{itemId}/tags, tags domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/* ── DELETE /api/inspections/:id/items/:itemId/tags/:tagId ────────────── */
const unlinkInspectionItemTagRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}/items/{itemId}/tags/{tagId}',
    tags: ["tags"],
    summary: 'Unlink a tag from an inspection item',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: InspectionItemTagWithTagParamsSchema.describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: TagUnlinkResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Unlinked' },
    },
    operationId: "deleteTagItemsTag",
    description: "Auto-generated placeholder for deleteTagItemsTag (DELETE /{id}/items/{itemId}/tags/{tagId}, tags domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/* ── GET /api/inspections/:id/tags ─────────────────────────────────────
 *  Bulk fetch — returns a map of itemId → Tag[] for the entire inspection.
 *  Used by inspection-edit to hydrate all chips on initial load.
 */
const listInspectionTagMapRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/tags',
    tags: ["tags"],
    summary: 'Map of itemId → tags for an inspection',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: InspectionIdParamSchema.describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data:    z.record(z.string(), z.array(z.object({
                            id:        z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
                            name:      z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
                            color:     z.string().nullable().optional().describe('TODO describe color field for the OpenInspection MCP integration'),
                            isSeed:    z.boolean().describe('TODO describe isSeed field for the OpenInspection MCP integration'),
                            createdAt: z.number().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
                        }))).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Item tag map',
        },
    },
    operationId: "listTagTags",
    description: "Auto-generated placeholder for listTagTags (GET /{id}/tags, tags domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

export const inspectionTagRoutes = createApiRouter()
    .openapi(listInspectionItemTagsRoute, async (c) => {
        const { id, itemId } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        const data = await c.var.services.tag.getItemTags(tenantId, id, itemId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(linkInspectionItemTagRoute, async (c) => {
        const { id, itemId } = c.req.valid('param');
        const { tagId } = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;

        // Verify the inspection belongs to this tenant before linking.
        await c.var.services.inspection.getInspection(id, tenantId);
        await c.var.services.tag.linkToItem(tenantId, id, itemId, tagId);
        auditFromContext(c, 'tag.linked', 'inspection_item', {
            entityId: id,
            metadata: { itemId, tagId },
        });
        return c.json({ success: true as const, data: { linked: true as const } }, 200);
    })
    .openapi(unlinkInspectionItemTagRoute, async (c) => {
        const { id, itemId, tagId } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;

        // Tenant ownership guard via inspection lookup.
        await c.var.services.inspection.getInspection(id, tenantId);
        await c.var.services.tag.unlinkFromItem(tenantId, id, itemId, tagId);
        auditFromContext(c, 'tag.unlinked', 'inspection_item', {
            entityId: id,
            metadata: { itemId, tagId },
        });
        return c.json({ success: true as const, data: { unlinked: true as const } }, 200);
    })
    .openapi(listInspectionTagMapRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        await c.var.services.inspection.getInspection(id, tenantId);
        const data = await c.var.services.tag.getInspectionTagMap(tenantId, id);
        if (!data) throw Errors.Internal('Tag map unavailable');
        return c.json({ success: true as const, data }, 200);
    });

export type InspectionTagApi = typeof inspectionTagRoutes;

export default tagsRoutes;
