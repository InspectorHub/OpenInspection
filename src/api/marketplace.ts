import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { drizzle } from 'drizzle-orm/d1';
import { templates } from '../lib/db/schema';

import residentialSeed from '../data/seed-templates/residential.json';
import trecSeed        from '../data/seed-templates/trec-rei-7-6.json';
import commercialSeed  from '../data/seed-templates/commercial.json';

const SEEDS = [residentialSeed, trecSeed, commercialSeed] as const;

const marketplaceRoutes = new OpenAPIHono<HonoConfig>();

// GET /api/templates/marketplace — list available seed templates
marketplaceRoutes.openapi(createRoute({
    method: 'get', path: '/',
    tags: ['Templates'],
    summary: 'List marketplace templates',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.array(z.any()) }) } },
            description: 'OK',
        },
    },
}), async (c) => {
    const list = SEEDS.map(s => ({ id: s.id, name: s.name, description: s.description }));
    return c.json({ success: true, data: list });
});

// POST /api/templates/marketplace/:id/import — import seed into tenant templates
marketplaceRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/import',
    tags: ['Templates'],
    summary: 'Import marketplace template',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.any() }) } },
            description: 'Imported',
        },
    },
}), async (c) => {
    const { id } = c.req.valid('param');
    const seed = SEEDS.find(s => s.id === id);
    if (!seed) throw Errors.NotFound('Marketplace template not found');

    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB as any);
    const newId = crypto.randomUUID();

    await db.insert(templates).values({
        id:        newId,
        tenantId,
        name:      seed.name,
        version:   seed.version,
        schema:    seed.schema as unknown as string,
        createdAt: new Date(),
    });

    return c.json({ success: true, data: { id: newId, name: seed.name } }, 201);
});

export default marketplaceRoutes;
