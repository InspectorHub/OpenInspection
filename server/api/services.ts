import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from 'zod';
import { requireRole } from '../lib/middleware/rbac';
import { capabilitiesFor } from '../lib/middleware/require-capability';
import { redactMoney } from '../lib/auth/money-redaction';
import {
    CreateServiceSchema, UpdateServiceSchema, ServiceResponseSchema,
    ServiceListResponseSchema, CreateDiscountCodeSchema, UpdateDiscountCodeSchema,
    ValidateDiscountSchema, ValidateDiscountResponseSchema,
    ServiceInspectorListResponseSchema, SetServiceInspectorsSchema, SetServiceInspectorsResponseSchema,
    CreatePayRuleSchema, UpdatePayRuleSchema, PayRuleResponseSchema, PayRuleListResponseSchema,
} from '../lib/validations/service.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

export const servicesRoutes = createApiRouter()
    // GET /api/services
    .openapi(createRoute(withMcpMetadata({
        method: 'get', path: '/',
        tags: ["services"], summary: "List services for current tenant",
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
        responses: { 200: { content: { 'application/json': { schema: ServiceListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'OK' } },
        operationId: "listServices",
        description: "Auto-generated placeholder for listServices (GET /, services domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['read'], tier: 'primary' })), async (c) => {
        const tenantId = c.get('tenantId');
        const rows = await c.var.services.service.listServices(tenantId);
        // IA-95 — the catalog carries `price`, and this route admits inspectors,
        // whose `financial` default is false. Second of the three money surfaces
        // the capability was not worn by.
        return c.json({ success: true, data: redactMoney(rows, await capabilitiesFor(c)) });
    })
    // POST /api/services/discount/validate — MUST be before /:id routes
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/discount/validate',
        tags: ["services"], summary: "Validate service for current tenant",
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
        middleware: [requireRole('owner', 'manager')] as const,
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
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
        middleware: [requireRole('owner', 'manager')] as const,
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
        middleware: [requireRole('owner', 'manager')] as const,
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
        middleware: [requireRole('owner', 'manager')] as const,
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
        middleware: [requireRole('owner', 'manager')] as const,
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
        middleware: [requireRole('owner', 'manager')] as const,
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
    // --- Pay rules (#278) --------------------------------------------------
    // Mounted here rather than under a pay-splits router because a rule is
    // CATALOGUE configuration — it belongs to a service, not to an inspection —
    // and this is where the service's other per-service settings already live.
    // `/{id}/pay-rules` mirrors the `/{id}/inspectors` pair exactly: same
    // arity, same `{id}` param name, registered before the bare `/{id}` routes.
    // Write access is owner/manager, matching every other write on this router:
    // deciding what a person is paid is company configuration, not field work.
    // No new capability — `financial` remains the only line.
    // GET /api/services/:id/pay-rules
    .openapi(createRoute(withMcpMetadata({
        method: 'get', path: '/{id}/pay-rules',
        tags: ["services"], summary: "List pay rules for a service",
        middleware: [requireRole('owner', 'manager')] as const,
        request: { params: z.object({ id: z.string().describe('Service ID') }) },
        responses: {
            200: { content: { 'application/json': { schema: PayRuleListResponseSchema } }, description: 'OK — the service default first, then per-inspector rules' },
        },
        operationId: "listServicePayRules",
        description: "Returns what inspectors earn on this catalogue service. A rule with a null userId is the service default, applied to any inspector without one of their own. An empty list means pay splits are OFF for this service: nothing is populated when an inspection is assigned.",
    }, { scopes: ['read'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const rows = await c.var.services.service.listPayRules(tenantId, id);
        return c.json({ success: true, data: rows });
    })
    // POST /api/services/:id/pay-rules
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/pay-rules',
        tags: ["services"], summary: "Add a pay rule to a service",
        middleware: [requireRole('owner', 'manager')] as const,
        request: {
            params: z.object({ id: z.string().describe('Service ID') }),
            body: { content: { 'application/json': { schema: CreatePayRuleSchema } } },
        },
        responses: {
            201: { content: { 'application/json': { schema: PayRuleResponseSchema } }, description: 'Created' },
            409: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'A default rule, or a rule for that inspector, already exists on this service' },
        },
        operationId: "createServicePayRule",
        description: "Writes what an inspector earns on this service. Percentages are BASIS POINTS (percentBps: 6000 = 60%) and fixed amounts are integer cents (amountCents) — the field name carries the unit, and the payload is strict, so a rule written in the wrong unit is refused rather than stored a hundred times too small. Omit userId for the service default. At most one default and one rule per inspector exist per service; a duplicate is 409.",
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const input = c.req.valid('json');
        const row = await c.var.services.service.createPayRule(tenantId, id, input);
        return c.json({ success: true, data: row }, 201);
    })
    // PUT /api/services/:id/pay-rules/:ruleId
    .openapi(createRoute(withMcpMetadata({
        method: 'put', path: '/{id}/pay-rules/{ruleId}',
        tags: ["services"], summary: "Replace the rate of a pay rule",
        middleware: [requireRole('owner', 'manager')] as const,
        request: {
            params: z.object({
                id: z.string().describe('Service ID'),
                ruleId: z.string().describe('Pay rule ID'),
            }),
            body: { content: { 'application/json': { schema: UpdatePayRuleSchema } } },
        },
        responses: {
            200: { content: { 'application/json': { schema: PayRuleResponseSchema } }, description: 'OK' },
        },
        operationId: "updateServicePayRule",
        description: "Changes the rate of an existing pay rule, including switching between the three types. The inspector the rule applies to is not editable here — that would move the rule into a different uniqueness slot, so it is a delete plus a create. Editing a rule never restates pay that was already recorded: splits are a frozen record, and an explicit refresh is what re-derives them.",
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id, ruleId } = c.req.valid('param');
        const input = c.req.valid('json');
        const row = await c.var.services.service.updatePayRule(tenantId, id, ruleId, input);
        return c.json({ success: true, data: row });
    })
    // DELETE /api/services/:id/pay-rules/:ruleId
    .openapi(createRoute(withMcpMetadata({
        method: 'delete', path: '/{id}/pay-rules/{ruleId}',
        tags: ["services"], summary: "Delete a pay rule",
        middleware: [requireRole('owner', 'manager')] as const,
        request: {
            params: z.object({
                id: z.string().describe('Service ID'),
                ruleId: z.string().describe('Pay rule ID'),
            }),
        },
        responses: {
            200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Deleted' },
        },
        operationId: "deleteServicePayRule",
        description: "Removes a pay rule. Deleting the last rule on a service turns pay splits off for it — future inspections populate nothing. Splits already recorded are left alone.",
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id, ruleId } = c.req.valid('param');
        await c.var.services.service.deletePayRule(tenantId, id, ruleId);
        return c.json({ success: true });
    })
    // PUT /api/services/:id
    .openapi(createRoute(withMcpMetadata({
        method: 'put', path: '/{id}',
        tags: ["services"], summary: "Replace service for current tenant",
        middleware: [requireRole('owner', 'manager')] as const,
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
        middleware: [requireRole('owner', 'manager')] as const,
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
