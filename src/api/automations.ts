import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import type { HonoConfig } from '../types/hono';
import {
    AutomationListResponseSchema, AutomationLogListResponseSchema,
    CreateAutomationSchema, UpdateAutomationSchema, AutomationSchema,
} from '../lib/validations/automation.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';

const automationsRoutes = new OpenAPIHono<HonoConfig>();

// GET /api/automations
const listRoute = createRoute({
    method: 'get', path: '/', tags: ['Automations'],
    middleware: [requireRole(['owner', 'admin'])],
    responses: { 200: { content: { 'application/json': { schema: AutomationListResponseSchema } }, description: 'List' } },
});

automationsRoutes.openapi(listRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    await c.var.services.automation.ensureSeeds(tenantId);
    const rows = await c.var.services.automation.list(tenantId);
    return c.json({ success: true, data: rows });
});

// POST /api/automations
const createAutomationRoute = createRoute({
    method: 'post', path: '/', tags: ['Automations'],
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: CreateAutomationSchema } } } },
    responses: { 201: { content: { 'application/json': { schema: createApiResponseSchema(AutomationSchema) } }, description: 'Created' } },
});

automationsRoutes.openapi(createAutomationRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const data = c.req.valid('json');
    const row = await c.var.services.automation.create(tenantId, data);
    return c.json({ success: true, data: row }, 201);
});

// GET /api/automations/logs/:inspectionId — BEFORE /:id to avoid shadowing
const getLogsRoute = createRoute({
    method: 'get', path: '/logs/{inspectionId}', tags: ['Automations'],
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: { params: z.object({ inspectionId: z.string() }) },
    responses: { 200: { content: { 'application/json': { schema: AutomationLogListResponseSchema } }, description: 'Logs' } },
});

automationsRoutes.openapi(getLogsRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { inspectionId } = c.req.valid('param');
    const rows = await c.var.services.automation.getLogs(tenantId, inspectionId);
    return c.json({ success: true, data: rows });
});

// PATCH /api/automations/:id
const updateRoute = createRoute({
    method: 'patch', path: '/{id}', tags: ['Automations'],
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: UpdateAutomationSchema } } },
    },
    responses: { 200: { content: { 'application/json': { schema: createApiResponseSchema(AutomationSchema) } }, description: 'Updated' } },
});

automationsRoutes.openapi(updateRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod partial() adds undefined to values, incompatible with exactOptionalPropertyTypes
    const row = await c.var.services.automation.update(tenantId, id, data as any);
    return c.json({ success: true, data: row });
});

// DELETE /api/automations/:id
const deleteRoute = createRoute({
    method: 'delete', path: '/{id}', tags: ['Automations'],
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Deleted' } },
});

automationsRoutes.openapi(deleteRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { id } = c.req.valid('param');
    await c.var.services.automation.delete(tenantId, id);
    return c.json({ success: true });
});

export default automationsRoutes;
