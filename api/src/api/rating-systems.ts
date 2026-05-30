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

const IdParamSchema = z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') });

/* ── GET /api/rating-systems ──────────────────────────────────────────── */
const listRatingSystemsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["ratings"],
    summary: 'List rating systems for the current tenant (seed + custom)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'List' },
    },
    operationId: "listRatingSystems",
    description: "Auto-generated placeholder for listRatingSystems (GET /, ratings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/* ── GET /api/rating-systems/:id ──────────────────────────────────────── */
const getRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}',
    tags: ["ratings"],
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: IdParamSchema.describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'One system' },
    },
    operationId: "getRatingSystem",
    summary: "Get rating system for current tenant",
    description: "Auto-generated placeholder for getRatingSystem (GET /{id}, ratings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/* ── POST /api/rating-systems ─────────────────────────────────────────── */
const createRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["ratings"],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { body: { content: { 'application/json': { schema: CreateRatingSystemSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Created' },
    },
    operationId: "createRatingSystem",
    summary: "Create rating system for current tenant",
    description: "Auto-generated placeholder for createRatingSystem (POST /, ratings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/* ── POST /api/rating-systems/:id/clone ───────────────────────────────── */
const cloneRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/clone',
    tags: ["ratings"],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: {
        params: IdParamSchema.describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: CloneRatingSystemSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Cloned' },
    },
    operationId: "cloneRatingSystem",
    summary: "Clone rating system for current tenant",
    description: "Auto-generated placeholder for cloneRatingSystem (POST /{id}/clone, ratings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/* ── PUT /api/rating-systems/:id ──────────────────────────────────────── */
const replaceRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/{id}',
    tags: ["ratings"],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: {
        params: IdParamSchema.describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateRatingSystemSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Updated' },
    },
    operationId: "replaceRatingSystem",
    summary: "Replace rating system for current tenant",
    description: "Auto-generated placeholder for replaceRatingSystem (PUT /{id}, ratings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/* ── DELETE /api/rating-systems/:id ───────────────────────────────────── */
const deleteRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}',
    tags: ["ratings"],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: IdParamSchema.describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ deleted: z.literal(true).describe('TODO describe deleted field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Deleted',
        },
    },
    operationId: "deleteRatingSystem",
    summary: "Delete rating system for current tenant",
    description: "Auto-generated placeholder for deleteRatingSystem (DELETE /{id}, ratings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const ratingSystemsRoutes = createApiRouter()
    .openapi(listRatingSystemsRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        // Lazy-seed defaults so first-time tenants always see the four canonical
        // systems even if the seed:rating-systems script wasn't run for them.
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
