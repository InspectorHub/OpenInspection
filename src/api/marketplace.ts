import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';

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

export default marketplaceRoutes;
