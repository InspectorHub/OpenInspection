/**
 * Sprint 2 S2-1 — Rating Systems API.
 *
 * CRUD over the tenant-scoped rating_systems table plus a clone helper
 * (clone is the canonical entry point for editing — seeds are read-only).
 *
 * All mutations live behind the global JWT middleware + role gate. Reads
 * are open to inspectors so the Library page is browseable.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { HonoConfig } from '../types/hono';
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

const ratingSystemsRoutes = new OpenAPIHono<HonoConfig>();

const IdParamSchema = z.object({ id: z.string().min(1) });

/* ── GET /api/rating-systems ──────────────────────────────────────────── */
ratingSystemsRoutes.openapi(createRoute({
    method: 'get', path: '/',
    tags: ['Rating Systems'],
    summary: 'List rating systems for the current tenant (seed + custom)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemListResponseSchema } }, description: 'List' },
    },
}), async (c) => {
    const tenantId = c.get('tenantId') as string;
    // Lazy-seed defaults so first-time tenants always see the four canonical
    // systems even if the seed:rating-systems script wasn't run for them.
    await c.var.services.ratingSystem.seedDefaults(tenantId);
    const data = await c.var.services.ratingSystem.list(tenantId);
    return c.json({ success: true as const, data }, 200);
});

/* ── GET /api/rating-systems/:id ──────────────────────────────────────── */
ratingSystemsRoutes.openapi(createRoute({
    method: 'get', path: '/{id}',
    tags: ['Rating Systems'],
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: IdParamSchema },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema } }, description: 'One system' },
    },
}), async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    const sys = await c.var.services.ratingSystem.get(id, tenantId);
    if (!sys) throw Errors.NotFound('Rating system not found');
    return c.json({ success: true as const, data: sys }, 200);
});

/* ── POST /api/rating-systems ─────────────────────────────────────────── */
ratingSystemsRoutes.openapi(createRoute({
    method: 'post', path: '/',
    tags: ['Rating Systems'],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { body: { content: { 'application/json': { schema: CreateRatingSystemSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema } }, description: 'Created' },
    },
}), async (c) => {
    const input = c.req.valid('json');
    const tenantId = c.get('tenantId') as string;
    const sys = await c.var.services.ratingSystem.create(tenantId, input);
    auditFromContext(c, 'rating_system.created', 'rating_system', { entityId: sys.id, metadata: { name: sys.name, slug: sys.slug } });
    return c.json({ success: true as const, data: sys }, 200);
});

/* ── POST /api/rating-systems/:id/clone ───────────────────────────────── */
ratingSystemsRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/clone',
    tags: ['Rating Systems'],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: {
        params: IdParamSchema,
        body: { content: { 'application/json': { schema: CloneRatingSystemSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema } }, description: 'Cloned' },
    },
}), async (c) => {
    const { id } = c.req.valid('param');
    const { name, slug } = c.req.valid('json');
    const tenantId = c.get('tenantId') as string;
    const sys = await c.var.services.ratingSystem.clone(id, tenantId, name, slug);
    auditFromContext(c, 'rating_system.cloned', 'rating_system', { entityId: sys.id, metadata: { sourceId: id, name } });
    return c.json({ success: true as const, data: sys }, 200);
});

/* ── PUT /api/rating-systems/:id ──────────────────────────────────────── */
ratingSystemsRoutes.openapi(createRoute({
    method: 'put', path: '/{id}',
    tags: ['Rating Systems'],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: {
        params: IdParamSchema,
        body: { content: { 'application/json': { schema: UpdateRatingSystemSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: RatingSystemSingleResponseSchema } }, description: 'Updated' },
    },
}), async (c) => {
    const { id } = c.req.valid('param');
    const patch = c.req.valid('json');
    const tenantId = c.get('tenantId') as string;
    const sys = await c.var.services.ratingSystem.update(id, tenantId, patch);
    auditFromContext(c, 'rating_system.updated', 'rating_system', { entityId: sys.id });
    return c.json({ success: true as const, data: sys }, 200);
});

/* ── DELETE /api/rating-systems/:id ───────────────────────────────────── */
ratingSystemsRoutes.openapi(createRoute({
    method: 'delete', path: '/{id}',
    tags: ['Rating Systems'],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: IdParamSchema },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ deleted: z.literal(true) }) }) } },
            description: 'Deleted',
        },
    },
}), async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    const result = await c.var.services.ratingSystem.delete(id, tenantId);
    auditFromContext(c, 'rating_system.deleted', 'rating_system', { entityId: id });
    return c.json({ success: true as const, data: result }, 200);
});

export default ratingSystemsRoutes;
