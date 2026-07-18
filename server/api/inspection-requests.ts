/**
 * Sprint 2 S2-2 — Inspection request API.
 *
 * Routes:
 *   GET    /api/inspection-requests           — list parent requests with subs
 *   GET    /api/inspection-requests/:id       — fetch one request with subs
 *   POST   /api/inspection-requests           — create request + N sub-inspections
 *   PUT    /api/inspection-requests/:id       — update top-level fields
 *   POST   /api/inspection-requests/:id/inspections — append a sub-inspection
 */

import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import {
    CreateInspectionRequestSchema,
    UpdateInspectionRequestSchema,
    InspectionRequestListQuerySchema,
    InspectionRequestListResponseSchema,
    InspectionRequestDetailResponseSchema,
    InspectionRequestResponseSchema,
} from '../lib/validations/inspection-request.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const listRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["inspections"],
    summary: "List inspection requests for current tenant",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { query: InspectionRequestListQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRequestListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'List of requests with sub-inspections',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listInspectionRequests",
    description: "Auto-generated placeholder for listInspectionRequests (GET /, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const detailRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}',
    tags: ["inspections"],
    summary: "Get inspection request for current tenant",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRequestDetailResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Request detail',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "getInspectionRequest",
    description: "Auto-generated placeholder for getInspectionRequest (GET /{id}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// Sprint 2 S2-2 — resolve the parent request for an inspection.
// Used by the inspection-edit "Part X of Y" badge + sibling switcher.
// Returns 200 with `{ request: null }` when the inspection has no parent
// (single-service legacy bookings) so the caller can branch without 404
// noise in the console.
const byInspectionRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/by-inspection/{inspectionId}',
    tags: ["inspections"],
    summary: 'Get parent request by inspection id',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ inspectionId: z.string().min(1).describe('TODO describe inspectionId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({ request: InspectionRequestResponseSchema.nullable().describe('TODO describe request field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Parent request (or null when none)',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "getInspectionRequestByInspection",
    description: "Auto-generated placeholder for getInspectionRequestByInspection (GET /by-inspection/{inspectionId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const createReqRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["inspections"],
    summary: 'Create inspection request with N sub-inspections',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        body: { content: { 'application/json': { schema: CreateInspectionRequestSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        201: {
            content: { 'application/json': { schema: InspectionRequestDetailResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Created',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createInspectionRequest",
    description: "Auto-generated placeholder for createInspectionRequest (POST /, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const updateReqRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/{id}',
    tags: ["inspections"],
    summary: "Replace inspection request for current tenant",
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateInspectionRequestSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRequestDetailResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Updated',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "replaceInspectionRequest",
    description: "Auto-generated placeholder for replaceInspectionRequest (PUT /{id}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const addSubRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/inspections',
    tags: ["inspections"],
    summary: 'Add a sub-inspection to an existing request',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        templateId: z.string().min(1).describe('TODO describe templateId field for the OpenInspection MCP integration'),
                        price:      z.number().int().min(0).optional().describe('TODO describe price field for the OpenInspection MCP integration'),
                        notes:      z.string().max(500).optional().nullable().describe('TODO describe notes field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRequestDetailResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Sub-inspection added',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createInspectionRequestInspections",
    description: "Auto-generated placeholder for createInspectionRequestInspections (POST /{id}/inspections, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const inspectionRequestsRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const q = c.req.valid('query');
        const filter: { status?: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'; from?: string; to?: string; limit?: number; offset?: number } = {
            limit: q.limit, offset: q.offset,
        };
        if (q.status) filter.status = q.status;
        if (q.from)   filter.from   = q.from;
        if (q.to)     filter.to     = q.to;
        const rows = await c.var.services.inspectionRequest.list(tenantId, filter);
        return c.json({ success: true, data: rows, meta: { total: rows.length } }, 200);
    })
    .openapi(detailRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const request = await c.var.services.inspectionRequest.get(tenantId, id);
        if (!request) throw Errors.NotFound('Inspection request not found');
        return c.json({ success: true, data: { request } }, 200);
    })
    .openapi(byInspectionRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { inspectionId } = c.req.valid('param');
        const request = await c.var.services.inspectionRequest.getByInspectionId(tenantId, inspectionId);
        return c.json({ success: true as const, data: { request: request ?? null } }, 200);
    })
    .openapi(createReqRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');

        const reqInput: {
            clientName: string; clientEmail?: string | null; clientPhone?: string | null;
            propertyAddress: string; propertyCity?: string | null; propertyState?: string | null;
            propertyZip?: string | null; scheduledAt: string; notes?: string | null; inspectorId?: string | null;
        } = {
            clientName:      body.clientName,
            propertyAddress: body.propertyAddress,
            scheduledAt:     body.scheduledAt,
        };
        if ('clientEmail'  in body) reqInput.clientEmail  = body.clientEmail  ?? null;
        if ('clientPhone'  in body) reqInput.clientPhone  = body.clientPhone  ?? null;
        if ('propertyCity' in body) reqInput.propertyCity = body.propertyCity ?? null;
        if ('propertyState' in body) reqInput.propertyState = body.propertyState ?? null;
        if ('propertyZip'  in body) reqInput.propertyZip  = body.propertyZip  ?? null;
        if ('notes'        in body) reqInput.notes        = body.notes        ?? null;
        if (body.inspectorId)       reqInput.inspectorId  = body.inspectorId;

        const subs = body.subInspections.map(s => {
            const out: { templateId: string; price?: number; notes?: string | null } = { templateId: s.templateId };
            if (s.price !== undefined) out.price = s.price;
            if (s.notes !== undefined) out.notes = s.notes ?? null;
            return out;
        });

        const created = await c.var.services.inspectionRequest.create(tenantId, reqInput, subs);
        return c.json({ success: true, data: { request: created } }, 201);
    })
    .openapi(updateReqRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const raw = c.req.valid('json');
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(raw)) {
            if (v !== undefined) patch[k] = v;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updated = await c.var.services.inspectionRequest.update(tenantId, id, patch as any);
        return c.json({ success: true, data: { request: updated } }, 200);
    })
    .openapi(addSubRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const sub: { templateId: string; price?: number; notes?: string | null } = { templateId: body.templateId };
        if (body.price !== undefined) sub.price = body.price;
        if (body.notes !== undefined) sub.notes = body.notes ?? null;
        const updated = await c.var.services.inspectionRequest.addSubInspection(tenantId, id, sub);
        return c.json({ success: true, data: { request: updated } }, 200);
    });

export type InspectionRequestsApi = typeof inspectionRequestsRoutes;

export default inspectionRequestsRoutes;
