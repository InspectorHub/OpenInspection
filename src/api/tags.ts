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
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { HonoConfig } from '../types/hono';
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

const tagsRoutes = new OpenAPIHono<HonoConfig>();

const IdParamSchema = z.object({ id: z.string().min(1) });

/* ── GET /api/tags ────────────────────────────────────────────────────── */
tagsRoutes.openapi(createRoute({
    method: 'get', path: '/',
    tags: ['Tags'],
    summary: 'List tags for the current tenant (seed + custom)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: { content: { 'application/json': { schema: TagListResponseSchema } }, description: 'List' },
    },
}), async (c) => {
    const tenantId = c.get('tenantId') as string;
    // Lazy-seed canonical tags so first-time tenants always see the five.
    await c.var.services.tag.seedDefaults(tenantId);
    const data = await c.var.services.tag.list(tenantId);
    return c.json({ success: true as const, data }, 200);
});

/* ── POST /api/tags ───────────────────────────────────────────────────── */
tagsRoutes.openapi(createRoute({
    method: 'post', path: '/',
    tags: ['Tags'],
    summary: 'Create a custom tag',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { body: { content: { 'application/json': { schema: CreateTagSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: TagSingleResponseSchema } }, description: 'Created' },
    },
}), async (c) => {
    const input = c.req.valid('json');
    const tenantId = c.get('tenantId') as string;
    const tag = await c.var.services.tag.create(tenantId, input);
    auditFromContext(c, 'tag.created', 'tag', { entityId: tag.id, metadata: { name: tag.name } });
    return c.json({ success: true as const, data: tag }, 200);
});

/* ── PUT /api/tags/:id ────────────────────────────────────────────────── */
tagsRoutes.openapi(createRoute({
    method: 'put', path: '/{id}',
    tags: ['Tags'],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: {
        params: IdParamSchema,
        body: { content: { 'application/json': { schema: UpdateTagSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: TagSingleResponseSchema } }, description: 'Updated' },
    },
}), async (c) => {
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    const tenantId = c.get('tenantId') as string;
    const tag = await c.var.services.tag.update(id, tenantId, patch);
    auditFromContext(c, 'tag.updated', 'tag', { entityId: tag.id });
    return c.json({ success: true as const, data: tag }, 200);
});

/* ── GET /api/tags/:id/inspections ─────────────────────────────────────
 *  Sprint 3 S3-3 — list filter. Returns the distinct inspection ids in the
 *  tenant that have at least one item linked to this tag. The dashboard
 *  uses this to scope its flat list view to "by tag".
 */
tagsRoutes.openapi(createRoute({
    method: 'get', path: '/{id}/inspections',
    tags: ['Tags'],
    summary: 'List inspections that have any item tagged with this tag',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: IdParamSchema },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data:    z.object({ inspectionIds: z.array(z.string()) }),
                    }),
                },
            },
            description: 'Inspection ids',
        },
    },
}), async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    // Tenant-scope guard via lookup — refuses cross-tenant ids.
    const tag = await c.var.services.tag.get(id, tenantId);
    if (!tag) throw Errors.NotFound('Tag not found');
    const inspectionIds = await c.var.services.tag.listInspectionsByTag(tenantId, id);
    return c.json({ success: true as const, data: { inspectionIds } }, 200);
});

/* ── DELETE /api/tags/:id ─────────────────────────────────────────────── */
tagsRoutes.openapi(createRoute({
    method: 'delete', path: '/{id}',
    tags: ['Tags'],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: IdParamSchema },
    responses: {
        200: { content: { 'application/json': { schema: TagDeleteResponseSchema } }, description: 'Deleted' },
    },
}), async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    const result = await c.var.services.tag.delete(id, tenantId);
    auditFromContext(c, 'tag.deleted', 'tag', { entityId: id });
    return c.json({ success: true as const, data: result }, 200);
});

export default tagsRoutes;

/* ─── Item-link sub-routes ────────────────────────────────────────────── */
//
// Mounted separately under /api/inspections so the path can carry the
// inspection id + item id directly. We keep them in this file so all
// tag endpoints live together.

export const inspectionTagRoutes = new OpenAPIHono<HonoConfig>();

const InspectionItemTagParamsSchema = z.object({
    id:     z.string().min(1),
    itemId: z.string().min(1),
});

const InspectionItemTagWithTagParamsSchema = z.object({
    id:     z.string().min(1),
    itemId: z.string().min(1),
    tagId:  z.string().min(1),
});

const LinkBodySchema = z.object({ tagId: z.string().min(1) }).strict();

/* ── GET /api/inspections/:id/items/:itemId/tags ──────────────────────── */
inspectionTagRoutes.openapi(createRoute({
    method: 'get', path: '/{id}/items/{itemId}/tags',
    tags: ['Tags'],
    summary: 'List tags linked to an inspection item',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: InspectionItemTagParamsSchema },
    responses: {
        200: { content: { 'application/json': { schema: TagListResponseSchema } }, description: 'Item tags' },
    },
}), async (c) => {
    const { id, itemId } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    const data = await c.var.services.tag.getItemTags(tenantId, id, itemId);
    return c.json({ success: true as const, data }, 200);
});

/* ── POST /api/inspections/:id/items/:itemId/tags ─────────────────────── */
inspectionTagRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/items/{itemId}/tags',
    tags: ['Tags'],
    summary: 'Link a tag to an inspection item',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: InspectionItemTagParamsSchema,
        body: { content: { 'application/json': { schema: LinkBodySchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: TagLinkResponseSchema } }, description: 'Linked' },
    },
}), async (c) => {
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
});

/* ── DELETE /api/inspections/:id/items/:itemId/tags/:tagId ────────────── */
inspectionTagRoutes.openapi(createRoute({
    method: 'delete', path: '/{id}/items/{itemId}/tags/{tagId}',
    tags: ['Tags'],
    summary: 'Unlink a tag from an inspection item',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: InspectionItemTagWithTagParamsSchema },
    responses: {
        200: { content: { 'application/json': { schema: TagUnlinkResponseSchema } }, description: 'Unlinked' },
    },
}), async (c) => {
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
});

/* ── GET /api/inspections/:id/tags ─────────────────────────────────────
 *  Bulk fetch — returns a map of itemId → Tag[] for the entire inspection.
 *  Used by inspection-edit to hydrate all chips on initial load.
 */
const InspectionIdParamSchema = z.object({ id: z.string().min(1) });

inspectionTagRoutes.openapi(createRoute({
    method: 'get', path: '/{id}/tags',
    tags: ['Tags'],
    summary: 'Map of itemId → tags for an inspection',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: InspectionIdParamSchema },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data:    z.record(z.string(), z.array(z.object({
                            id:        z.string(),
                            name:      z.string(),
                            color:     z.string().nullable().optional(),
                            isSeed:    z.boolean(),
                            createdAt: z.number(),
                        }))),
                    }),
                },
            },
            description: 'Item tag map',
        },
    },
}), async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    await c.var.services.inspection.getInspection(id, tenantId);
    const data = await c.var.services.tag.getInspectionTagMap(tenantId, id);
    if (!data) throw Errors.Internal('Tag map unavailable');
    return c.json({ success: true as const, data }, 200);
});
