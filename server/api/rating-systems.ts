/**
 * Sprint 2 S2-1 — Rating Systems API.
 *
 * CRUD over the tenant-scoped rating_systems table plus a clone helper
 * (clone is the canonical entry point for editing — seeds are read-only).
 *
 * All mutations live behind the global JWT middleware + role gate. Reads
 * are open to inspectors so the Library page is browseable.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { Errors } from '../lib/errors';
import {
    CreateRatingSystemSchema,
    UpdateRatingSystemSchema,
    CloneRatingSystemSchema,
    RatingSystemSingleResponseSchema,
    RatingSystemListResponseSchema,
} from '../lib/validations/rating-system.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const IdParamSchema = z.object({ id: z.string().min(1).describe('Rating system id.') });

/* ── GET /api/rating-systems ──────────────────────────────────────────── */
const listRatingSystemsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["ratings"],
    summary: 'List rating systems for the current tenant (seed + custom)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemListResponseSchema } }, description: 'List' },
    },
    operationId: "listRatingSystems",
    description: "Lists all of the company's rating systems, the built-in read-only ones and its own custom ones, each with its levels. Sorted with the default system first, then built-in before custom, then by name. Not paginated. Side effect: the built-in default systems are created for the company first if they do not exist yet, so the first call on a new company writes rows. Read-only otherwise. Available to owner, manager and inspector roles."
}, { scopes: ['read'], tier: 'extended' }));

/* ── GET /api/rating-systems/:id ──────────────────────────────────────── */
const getRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}',
    tags: ["ratings"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: IdParamSchema },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema } }, description: 'One system' },
    },
    operationId: "getRatingSystem",
    summary: "Get rating system for current tenant",
    description: "Returns one rating system of the company with its levels, whether built-in or custom. Returns 404 when the id is not a rating system of this company. Read-only. Available to owner, manager and inspector roles."
}, { scopes: ['read'], tier: 'extended' }));

/* ── POST /api/rating-systems ─────────────────────────────────────────── */
const createRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["ratings"],
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: CreateRatingSystemSchema.describe('The new rating system: name, slug and its ordered levels.') } } } },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema } }, description: 'Created' },
    },
    operationId: "createRatingSystem",
    summary: "Create rating system for current tenant",
    description: "Create a custom rating system, the set of levels (for example Satisfactory, Monitor, Defect) inspectors choose from when rating checklist items. The slug must be unique in the company (409 otherwise) and a system needs two to ten levels; level ids and order are assigned when left out. Setting isDefault clears the default flag on every other system. Writes a rating_system.created audit entry and answers 200 with the stored system. Each call creates another system. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

/* ── POST /api/rating-systems/:id/clone ───────────────────────────────── */
const cloneRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/clone',
    tags: ["ratings"],
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: IdParamSchema,
        body: { content: { 'application/json': { schema: CloneRatingSystemSchema.describe('Name, and optionally slug, for the copy.') } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema } }, description: 'Cloned' },
    },
    operationId: "cloneRatingSystem",
    summary: "Clone rating system for current tenant",
    description: "Copy a rating system, built-in or custom, into a new editable one; this is how a built-in system is customised, because those are read-only. The copy gets the given name, the given slug or one generated from the source slug, the source description and levels with fresh level ids, and is never the default. Returns 404 for an unknown source and 409 when the slug is taken. Writes a rating_system.cloned audit entry. Each call creates another copy. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

/* ── PUT /api/rating-systems/:id ──────────────────────────────────────── */
const replaceRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/{id}',
    tags: ["ratings"],
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: IdParamSchema,
        body: { content: { 'application/json': { schema: UpdateRatingSystemSchema.describe('The rating system fields to change; omitted fields are left as they are.') } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema } }, description: 'Updated' },
    },
    operationId: "replaceRatingSystem",
    summary: "Replace rating system for current tenant",
    description: "Update a custom rating system. Despite the PUT verb it is a partial update: only the fields sent change, and sending levels replaces the whole level list. Setting isDefault clears the default flag on every other system. Built-in systems are read-only (403; clone one first) and changing the slug to one already in use returns 409; 404 for an unknown id. Writes a rating_system.updated audit entry. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

/* ── DELETE /api/rating-systems/:id ───────────────────────────────────── */
const deleteRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}',
    tags: ["ratings"],
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: IdParamSchema },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ deleted: z.literal(true).describe('TODO describe deleted field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Deleted',
        },
    },
    operationId: "deleteRatingSystem",
    summary: "Delete rating system for current tenant",
    description: "Permanently delete a custom rating system and write a rating_system.deleted audit entry. Built-in systems cannot be deleted (403), and a system that any template still uses is refused with 409 naming how many templates bind it. Returns 404 for an unknown id. Not reversible. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

const ratingSystemsRoutes = createApiRouter()
    .openapi(listRatingSystemsRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        // Lazy-seed defaults so first-time tenants always see the four canonical
        // systems even if starter content was never seeded for them.
        await c.var.services.ratingSystem.seedDefaults(tenantId);
        const data = await c.var.services.ratingSystem.list(tenantId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(getRatingSystemRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        const sys = await c.var.services.ratingSystem.get(id, tenantId);
        if (!sys) throw Errors.NotFound('Rating system not found');
        return c.json({ success: true as const, data: sys }, 200);
    })
    .openapi(createRatingSystemRoute, async (c) => {
        const input = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        const sys = await c.var.services.ratingSystem.create(tenantId, input);
        auditFromContext(c, 'rating_system.created', 'rating_system', { entityId: sys.id, metadata: { name: sys.name, slug: sys.slug } });
        return c.json({ success: true as const, data: sys }, 200);
    })
    .openapi(cloneRatingSystemRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { name, slug } = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        const sys = await c.var.services.ratingSystem.clone(id, tenantId, name, slug);
        auditFromContext(c, 'rating_system.cloned', 'rating_system', { entityId: sys.id, metadata: { sourceId: id, name } });
        return c.json({ success: true as const, data: sys }, 200);
    })
    .openapi(replaceRatingSystemRoute, async (c) => {
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        const sys = await c.var.services.ratingSystem.update(id, tenantId, patch);
        auditFromContext(c, 'rating_system.updated', 'rating_system', { entityId: sys.id });
        return c.json({ success: true as const, data: sys }, 200);
    })
    .openapi(deleteRatingSystemRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        const result = await c.var.services.ratingSystem.delete(id, tenantId);
        auditFromContext(c, 'rating_system.deleted', 'rating_system', { entityId: id });
        return c.json({ success: true as const, data: result }, 200);
    });

export type RatingSystemsApi = typeof ratingSystemsRoutes;

export default ratingSystemsRoutes;
