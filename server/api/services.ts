import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from 'zod';
import { requireRole } from '../lib/middleware/rbac';
import {
    CreateServiceSchema, UpdateServiceSchema, ServiceResponseSchema,
    ServiceListResponseSchema, CreateDiscountCodeSchema, UpdateDiscountCodeSchema,
    ValidateDiscountSchema, ValidateDiscountResponseSchema,
    ServiceInspectorListResponseSchema, SetServiceInspectorsSchema, SetServiceInspectorsResponseSchema,
} from '../lib/validations/service.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

export const servicesRoutes = createApiRouter()
    // GET /api/services
    .openapi(createRoute(withMcpMetadata({
        method: 'get', path: '/',
        tags: ["services"], summary: "List services for current tenant",
        middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
        responses: { 200: { content: { 'application/json': { schema: ServiceListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'OK' } },
        operationId: "listServices",
        description: "Auto-generated placeholder for listServices (GET /, services domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['read'], tier: 'primary' })), async (c) => {
        const tenantId = c.get('tenantId');
        const rows = await c.var.services.service.listServices(tenantId);
        return c.json({ success: true, data: rows });
    })
    // POST /api/services/discount/validate — MUST be before /:id routes
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/discount/validate',
        tags: ["services"], summary: "Validate service for current tenant",
        middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
        request: { body: { content: { 'application/json': { schema: ValidateDiscountSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
        responses: { 200: { content: { 'application/json': { schema: createApiResponseSchema(ValidateDiscountResponseSchema) } }, description: 'Validation result' } },
        operationId: "validateService",
        description: "Auto-generated placeholder for validateService (POST /discount/validate, services domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { code, subtotal } = c.req.valid('json');
        const result = await c.var.services.service.validateDiscountCode(tenantId, code, subtotal);
        return c.json({ success: true, data: result });
    })
    // POST /api/services/discount-codes
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/discount-codes',
        tags: ["services"], summary: "Create service discount codes",
        middleware: [requireRole(['owner', 'admin'])] as const,
        request: { body: { content: { 'application/json': { schema: CreateDiscountCodeSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
        responses: { 201: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Created' } },
        operationId: "createServiceDiscountCodes",
        description: "Auto-generated placeholder for createServiceDiscountCodes (POST /discount-codes, services domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const data = c.req.valid('json');
        await c.var.services.service.createDiscountCode(tenantId, data);
        return c.json({ success: true }, 201);
    })
    // GET /api/services/discount-codes — MUST be before /:id routes
    .openapi(createRoute(withMcpMetadata({
        method: 'get', path: '/discount-codes',
        tags: ["services"], summary: "List service discount codes",
        middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
        responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'OK' } },
        operationId: "listServiceDiscountCodes",
        description: "Auto-generated placeholder for listServiceDiscountCodes (GET /discount-codes, services domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['read'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const rows = await c.var.services.service.listDiscountCodes(tenantId);
        return c.json({ success: true, data: rows });
    })
    // PUT /api/services/discount-codes/:id — MUST be before /:id routes
    .openapi(createRoute(withMcpMetadata({
        method: 'put', path: '/discount-codes/{id}',
        tags: ["services"], summary: "Update service discount code",
        middleware: [requireRole(['owner', 'admin'])] as const,
        request: {
            params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
            body: { content: { 'application/json': { schema: UpdateDiscountCodeSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
        },
        responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Updated' } },
        operationId: "updateServiceDiscountCode",
        description: "Auto-generated placeholder for updateServiceDiscountCode (PUT /discount-codes/{id}, services domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const data = c.req.valid('json');
        const row = await c.var.services.service.updateDiscountCode(tenantId, id, data);
        return c.json({ success: true, data: row });
    })
    // DELETE /api/services/discount-codes/:id — MUST be before /:id routes
    .openapi(createRoute(withMcpMetadata({
        method: 'delete', path: '/discount-codes/{id}',
        tags: ["services"], summary: "Delete service discount code",
        middleware: [requireRole(['owner', 'admin'])] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Deleted' } },
        operationId: "deleteServiceDiscountCode",
        description: "Auto-generated placeholder for deleteServiceDiscountCode (DELETE /discount-codes/{id}, services domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        await c.var.services.service.deleteDiscountCode(tenantId, id);
        return c.json({ success: true });
    })
    // POST /api/services
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/',
        tags: ["services"], summary: "Create service for current tenant",
        middleware: [requireRole(['owner', 'admin'])] as const,
        request: { body: { content: { 'application/json': { schema: CreateServiceSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
        responses: { 201: { content: { 'application/json': { schema: ServiceResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Created' } },
        operationId: "createService",
        description: "Auto-generated placeholder for createService (POST /, services domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'primary' })), async (c) => {
        const tenantId = c.get('tenantId');
        const data = c.req.valid('json');
        const row = await c.var.services.service.createService(tenantId, data);
        return c.json({ success: true, data: row }, 201);
    })
    // GET /api/services/:id/inspectors — registered before the /{id} param routes for clarity; different path arity, no shadowing risk
    .openapi(createRoute(withMcpMetadata({
        method: 'get', path: '/{id}/inspectors',
        tags: ["services"], summary: "Get qualified inspector restriction list for a service",
        middleware: [requireRole(['owner', 'admin'])] as const,
        request: {
            params: z.object({ id: z.string().describe('Service ID') }),
        },
        responses: {
            200: { content: { 'application/json': { schema: ServiceInspectorListResponseSchema } }, description: 'OK — empty userIds means all staff are qualified' },
        },
        operationId: "getServiceInspectors",
        description: "Returns the inspector restriction list for a service. An empty userIds array means all non-agent staff are qualified (no restriction rows). Admin or owner only.",
    }, { scopes: ['read'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const userIds = await c.var.services.service.getServiceInspectors(tenantId, id);
        return c.json({ success: true, data: { userIds } });
    })
    // PUT /api/services/:id/inspectors — registered before the /{id} param routes for clarity; different path arity, no shadowing risk
    .openapi(createRoute(withMcpMetadata({
        method: 'put', path: '/{id}/inspectors',
        tags: ["services"], summary: "Replace inspector restriction list for a service",
        middleware: [requireRole(['owner', 'admin'])] as const,
        request: {
            params: z.object({ id: z.string().describe('Service ID') }),
            body: { content: { 'application/json': { schema: SetServiceInspectorsSchema } } },
        },
        responses: {
            200: { content: { 'application/json': { schema: SetServiceInspectorsResponseSchema } }, description: 'OK — count of restriction rows now in effect' },
        },
        operationId: "setServiceInspectors",
        description: "Full-replace the qualified inspector list for a service. An empty userIds array clears all restrictions (back to all-qualified). Every userId must be a non-deleted, non-agent member of the caller's tenant. Admin or owner only.",
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const { userIds } = c.req.valid('json');
        const count = await c.var.services.service.setServiceInspectors(tenantId, id, userIds);
        return c.json({ success: true, data: { count } });
    })
    // PUT /api/services/:id
    .openapi(createRoute(withMcpMetadata({
        method: 'put', path: '/{id}',
        tags: ["services"], summary: "Replace service for current tenant",
        middleware: [requireRole(['owner', 'admin'])] as const,
        request: {
            params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
            body: { content: { 'application/json': { schema: UpdateServiceSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
        },
        responses: { 200: { content: { 'application/json': { schema: ServiceResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'OK' } },
        operationId: "replaceService",
        description: "Auto-generated placeholder for replaceService (PUT /{id}, services domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const data = c.req.valid('json');
        const row = await c.var.services.service.updateService(tenantId, id, data);
        return c.json({ success: true, data: row });
    })
    // DELETE /api/services/:id
    .openapi(createRoute(withMcpMetadata({
        method: 'delete', path: '/{id}',
        tags: ["services"], summary: "Delete service for current tenant",
        middleware: [requireRole(['owner', 'admin'])] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Deleted' } },
        operationId: "deleteService",
        description: "Auto-generated placeholder for deleteService (DELETE /{id}, services domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'primary' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        await c.var.services.service.deleteService(tenantId, id);
        return c.json({ success: true });
    });

export type ServicesApi = typeof servicesRoutes;

export default servicesRoutes;
