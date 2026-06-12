import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import {
    CreateContractorTypeSchema,
    UpdateContractorTypeSchema,
    ReorderContractorTypesSchema,
    ContractorTypeSchema,
} from '../lib/validations/contractor-type.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const ContractorTypeResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: ContractorTypeSchema.describe('TODO describe data field for the OpenInspection MCP integration'),
});
const ContractorTypeListResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.array(ContractorTypeSchema).describe('TODO describe data field for the OpenInspection MCP integration'),
});

/* ── GET /api/contractor-types ────────────────────────────────────────────── */
const listContractorTypesRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["contractor-types"],
    summary: 'List contractor types for current tenant',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {},
    responses: {
        200: { content: { 'application/json': { schema: ContractorTypeListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'List' },
    },
    operationId: "listContractorTypes",
    description: "Auto-generated placeholder for listContractorTypes (GET /, contractor-types domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'primary' }));

/* ── POST /api/contractor-types ───────────────────────────────────────────── */
const createContractorTypeRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["contractor-types"],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { body: { content: { 'application/json': { schema: CreateContractorTypeSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: ContractorTypeResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Created' },
    },
    operationId: "createContractorType",
    summary: "Create contractor type for current tenant",
    description: "Auto-generated placeholder for createContractorType (POST /, contractor-types domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary' }));

/* ── PATCH /api/contractor-types/:id ──────────────────────────────────────── */
const updateContractorTypeRoute = createRoute(withMcpMetadata({
    method: 'patch', path: '/{id}',
    tags: ["contractor-types"],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateContractorTypeSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: ContractorTypeResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Updated' },
    },
    operationId: "updateContractorType",
    summary: "Update contractor type for current tenant",
    description: "Auto-generated placeholder for updateContractorType (PATCH /{id}, contractor-types domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary' }));

/* ── DELETE /api/contractor-types/:id ─────────────────────────────────────── */
const deleteContractorTypeRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}',
    tags: ["contractor-types"],
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ deleted: z.literal(true).describe('TODO describe deleted field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } }, description: 'Deleted' },
    },
    operationId: "deleteContractorType",
    summary: "Delete contractor type for current tenant",
    description: "Auto-generated placeholder for deleteContractorType (DELETE /{id}, contractor-types domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary' }));

/* ── POST /api/contractor-types/reorder ───────────────────────────────────── */
const reorderContractorTypesRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/reorder',
    tags: ["contractor-types"],
    summary: 'Reorder contractor types (persist the supplied id order as sortOrder)',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { body: { content: { 'application/json': { schema: ReorderContractorTypesSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ reordered: z.literal(true).describe('TODO describe reordered field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } }, description: 'Reordered' },
    },
    operationId: "reorderContractorTypes",
    description: "Auto-generated placeholder for reorderContractorTypes (POST /reorder, contractor-types domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const contractorTypesRoutes = createApiRouter()
    .openapi(listContractorTypesRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const data = await c.var.services.contractorType.listByTenant(tenantId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(createContractorTypeRoute, async (c) => {
        const input = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        const r = await c.var.services.contractorType.create(tenantId, input);
        auditFromContext(c, 'contractor_type.created', 'contractor_type', { entityId: r.id, metadata: { name: r.name } });
        return c.json({ success: true as const, data: r }, 200);
    })
    .openapi(updateContractorTypeRoute, async (c) => {
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        const r = await c.var.services.contractorType.update(id, tenantId, patch);
        auditFromContext(c, 'contractor_type.updated', 'contractor_type', { entityId: r.id });
        return c.json({ success: true as const, data: r }, 200);
    })
    .openapi(deleteContractorTypeRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        await c.var.services.contractorType.delete(id, tenantId);
        auditFromContext(c, 'contractor_type.deleted', 'contractor_type', { entityId: id });
        return c.json({ success: true as const, data: { deleted: true as const } }, 200);
    })
    .openapi(reorderContractorTypesRoute, async (c) => {
        const { ids } = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        await c.var.services.contractorType.reorder(tenantId, ids);
        return c.json({ success: true as const, data: { reordered: true as const } }, 200);
    });

export type ContractorTypesApi = typeof contractorTypesRoutes;

export default contractorTypesRoutes;
