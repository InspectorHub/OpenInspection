import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { requireRole } from '../lib/middleware/rbac';
import type { HonoConfig } from '../types/hono';
import {
    CreateServiceSchema, UpdateServiceSchema, ServiceResponseSchema,
    ServiceListResponseSchema, CreateDiscountCodeSchema,
    ValidateDiscountSchema, ValidateDiscountResponseSchema,
} from '../lib/validations/service.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';

const servicesRoutes = new OpenAPIHono<HonoConfig>();

// GET /api/services
servicesRoutes.openapi(createRoute({
    method: 'get', path: '/',
    tags: ['Services'], summary: 'List services',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: { 200: { content: { 'application/json': { schema: ServiceListResponseSchema } }, description: 'OK' } },
}), async (c) => {
    const tenantId = c.get('tenantId');
    const rows = await c.var.services.service.listServices(tenantId);
    return c.json({ success: true, data: rows });
});

// POST /api/services/discount/validate — MUST be before /:id routes
servicesRoutes.openapi(createRoute({
    method: 'post', path: '/discount/validate',
    tags: ['Services'], summary: 'Validate discount code',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { body: { content: { 'application/json': { schema: ValidateDiscountSchema } } } },
    responses: { 200: { content: { 'application/json': { schema: createApiResponseSchema(ValidateDiscountResponseSchema) } }, description: 'Validation result' } },
}), async (c) => {
    const tenantId = c.get('tenantId');
    const { code, subtotal } = c.req.valid('json');
    const result = await c.var.services.service.validateDiscountCode(tenantId, code, subtotal);
    return c.json({ success: true, data: result });
});

// POST /api/services/discount-codes
servicesRoutes.openapi(createRoute({
    method: 'post', path: '/discount-codes',
    tags: ['Services'], summary: 'Create discount code',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { body: { content: { 'application/json': { schema: CreateDiscountCodeSchema } } } },
    responses: { 201: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Created' } },
}), async (c) => {
    const tenantId = c.get('tenantId');
    const data = c.req.valid('json');
    await c.var.services.service.createDiscountCode(tenantId, data);
    return c.json({ success: true }, 201);
});

// POST /api/services
servicesRoutes.openapi(createRoute({
    method: 'post', path: '/',
    tags: ['Services'], summary: 'Create service',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { body: { content: { 'application/json': { schema: CreateServiceSchema } } } },
    responses: { 201: { content: { 'application/json': { schema: ServiceResponseSchema } }, description: 'Created' } },
}), async (c) => {
    const tenantId = c.get('tenantId');
    const data = c.req.valid('json');
    const row = await c.var.services.service.createService(tenantId, data);
    return c.json({ success: true, data: row }, 201);
});

// PUT /api/services/:id
servicesRoutes.openapi(createRoute({
    method: 'put', path: '/{id}',
    tags: ['Services'], summary: 'Update service',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: UpdateServiceSchema } } },
    },
    responses: { 200: { content: { 'application/json': { schema: ServiceResponseSchema } }, description: 'OK' } },
}), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const row = await c.var.services.service.updateService(tenantId, id, data);
    return c.json({ success: true, data: row });
});

// DELETE /api/services/:id
servicesRoutes.openapi(createRoute({
    method: 'delete', path: '/{id}',
    tags: ['Services'], summary: 'Delete service',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Deleted' } },
}), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    await c.var.services.service.deleteService(tenantId, id);
    return c.json({ success: true });
});

export default servicesRoutes;
