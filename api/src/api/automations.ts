import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import {
    AutomationListResponseSchema, AutomationLogListResponseSchema,
    CreateAutomationSchema, UpdateAutomationSchema, AutomationSchema,
} from '../lib/validations/automation.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

// GET /api/automations
const listRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/', tags: ["automations"],
    middleware: [requireRole(['owner', 'admin'])],
    responses: { 200: { content: { 'application/json': { schema: AutomationListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'List' } },
    operationId: "listAutomations",
    summary: "List automations for current tenant",
    description: "Auto-generated placeholder for listAutomations (GET /, automations domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// POST /api/automations
const createAutomationRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/', tags: ["automations"],
    middleware: [requireRole(['owner', 'admin'])],
    request: { body: { content: { 'application/json': { schema: CreateAutomationSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: { 201: { content: { 'application/json': { schema: createApiResponseSchema(AutomationSchema) } }, description: 'Created' } },
    operationId: "createAutomation",
    summary: "Create automation for current tenant",
    description: "Auto-generated placeholder for createAutomation (POST /, automations domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// GET /api/automations/logs/recent — Spec 3C, tenant-wide activity feed
// MUST be registered BEFORE /logs/{inspectionId} to avoid path-param shadowing
const getRecentLogsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/logs/recent', tags: ["automations"],
    middleware: [requireRole(['owner', 'admin'])],
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional().describe('TODO describe limit field for the OpenInspection MCP integration') }).describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: { 200: { content: { 'application/json': { schema: AutomationLogListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Recent automation logs' } },
    operationId: "listAutomationLogsRecent",
    summary: "List automation logs recent",
    description: "Auto-generated placeholder for listAutomationLogsRecent (GET /logs/recent, automations domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// GET /api/automations/logs/:inspectionId — BEFORE /:id to avoid shadowing
const getLogsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/logs/{inspectionId}', tags: ["automations"],
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: { params: z.object({ inspectionId: z.string().describe('TODO describe inspectionId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: { 200: { content: { 'application/json': { schema: AutomationLogListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Logs' } },
    operationId: "getAutomationLog",
    summary: "Get automation log for current tenant",
    description: "Auto-generated placeholder for getAutomationLog (GET /logs/{inspectionId}, automations domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// PATCH /api/automations/:id
const updateRoute = createRoute(withMcpMetadata({
    method: 'patch', path: '/{id}', tags: ["automations"],
    middleware: [requireRole(['owner', 'admin'])],
    request: {
        params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateAutomationSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: { 200: { content: { 'application/json': { schema: createApiResponseSchema(AutomationSchema) } }, description: 'Updated' } },
    operationId: "patchAutomation",
    summary: "Patch automation for current tenant",
    description: "Auto-generated placeholder for patchAutomation (PATCH /{id}, automations domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// DELETE /api/automations/:id
const deleteRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}', tags: ["automations"],
    middleware: [requireRole(['owner', 'admin'])],
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Deleted' } },
    operationId: "deleteAutomation",
    summary: "Delete automation for current tenant",
    description: "Auto-generated placeholder for deleteAutomation (DELETE /{id}, automations domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const automationsRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        await c.var.services.automation.ensureSeeds(tenantId);
        const rows = await c.var.services.automation.list(tenantId);
        return c.json({ success: true, data: rows });
    })
    .openapi(createAutomationRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const data = c.req.valid('json');
        const row = await c.var.services.automation.create(tenantId, data);
        return c.json({ success: true, data: row }, 201);
    })
    .openapi(getRecentLogsRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { limit } = c.req.valid('query');
        const rows = await c.var.services.automation.listRecentLogs(tenantId, limit ?? 50);
        return c.json({ success: true, data: rows });
    })
    .openapi(getLogsRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { inspectionId } = c.req.valid('param');
        const rows = await c.var.services.automation.getLogs(tenantId, inspectionId);
        return c.json({ success: true, data: rows });
    })
    .openapi(updateRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const data = c.req.valid('json');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod partial() adds undefined to values, incompatible with exactOptionalPropertyTypes
        const row = await c.var.services.automation.update(tenantId, id, data as any);
        return c.json({ success: true, data: row });
    })
    .openapi(deleteRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        await c.var.services.automation.delete(tenantId, id);
        return c.json({ success: true });
    });

export type AutomationsApi = typeof automationsRoutes;

export default automationsRoutes;
