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
    request: { query: InspectionRequestListQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRequestListResponseSchema } },
            description: 'List of requests with sub-inspections',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listInspectionRequests",
    description: "Lists the company's inspection requests (a client, property and schedule with the inspections grouped under it), each with its inspections and their template names. Newest scheduled date first, paged with limit and offset. Filter by status and by a scheduled-date range (from and to, both inclusive). Note that total in the response is the number of requests on this page, not the count across all pages. Read-only. Available to owner, manager and inspector roles."
}, { scopes: ['read'], tier: 'extended' }));

const detailRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}',
    tags: ["inspections"],
    summary: "Get inspection request for current tenant",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('Id of the inspection request to fetch; must belong to this company.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRequestDetailResponseSchema } },
            description: 'Request detail',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "getInspectionRequest",
    description: "Returns one inspection request with its inspections, each with the inspection's template name. Returns 404 when the id is not a request of this company. Read-only. Available to owner, manager and inspector roles."
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
    request: { params: z.object({ inspectionId: z.string().min(1).describe('Id of an inspection in this company whose parent request to look up.') }) },
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
    description: "Finds the parent request of an inspection, with all of its inspections, so a caller can show sibling inspections from the same booking. Returns 200 with request null (not 404) when the inspection has no parent request, which is the case for inspections created singly, or when the inspection id does not exist in this company. Read-only. Available to owner, manager and inspector roles."
}, { scopes: ['read'], tier: 'extended' }));

const createReqRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["inspections"],
    summary: 'Create inspection request with N sub-inspections',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        body: { content: { 'application/json': { schema: CreateInspectionRequestSchema.describe('The client, property, schedule and the inspections to create') } } },
    },
    responses: {
        201: {
            content: { 'application/json': { schema: InspectionRequestDetailResponseSchema } },
            description: 'Created',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createInspectionRequest",
    description: "Create an inspection request: one client, property and schedule, with 1-10 inspections under it, each "
        + "from its own template. Every referenced template must belong to this company (400 otherwise). Each "
        + "inspection is created in the requested state, unpaid, at the sent price (default 0), with a copy of its "
        + "template, and all take the request's address, date and optional inspector. The client is matched or "
        + "created as a contact and recorded against each inspection. Any new-inspection quota is consumed once for "
        + "the whole batch before anything is written. The request starts as pending. Sends no email. Not "
        + "idempotent: each call creates a new request. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

const updateReqRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/{id}',
    tags: ["inspections"],
    summary: "Replace inspection request for current tenant",
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Id of the inspection request to update; must belong to this company') }),
        body: { content: { 'application/json': { schema: UpdateInspectionRequestSchema.describe('The request fields to change; omitted fields are left as they are') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRequestDetailResponseSchema } },
            description: 'Updated',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "replaceInspectionRequest",
    description: "Update the top-level fields of an inspection request: client details, property address, schedule, "
        + "notes and status. Despite the PUT verb this is a partial update, and sending a nullable field as null "
        + "clears it. It edits the request record only: the inspections under it are not changed, so edit those "
        + "through the inspection routes. Sends no email. Returns the request with its inspections, or 404 when the "
        + "id is not in this company. Idempotent. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

const addSubRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/inspections',
    tags: ["inspections"],
    summary: 'Add a sub-inspection to an existing request',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Id of the inspection request to add an inspection to; must belong to this company') }),
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        templateId: z.string().min(1).describe('Id of the inspection template the new inspection uses; must belong to this company. The template is copied onto the inspection'),
                        price:      z.number().int().min(0).optional().describe('Price for the new inspection in integer cents (for example 45000 is 450.00 in the company currency); defaults to 0'),
                        notes:      z.string().max(500).optional().nullable().describe('Notes for the new inspection, up to 500 characters'),
                    }).describe('The template, price and notes of the inspection to add'),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRequestDetailResponseSchema } },
            description: 'Sub-inspection added',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createInspectionRequestInspections",
    description: "Add one more inspection to an existing inspection request. The new inspection copies its template, takes "
        + "the request's address and date, starts in the requested state, unpaid, at the sent price (default 0), "
        + "and the request's client is recorded against it. It has no inspector assigned. Consumes any "
        + "new-inspection quota. 404 when the request is not in this company, and 400 when the template is not. "
        + "The route does not enforce the 10-inspection limit that applies at creation. Not idempotent: each call "
        + "adds another inspection. Restricted to owners and managers."
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
        // `InspectionRequestListResponseSchema` puts `{ requests, total }` INSIDE
        // `data` — that is what the OpenAPI document publishes and what
        // `packages/api-types` exports. The handler had drifted to the bare
        // `data: rows` + `meta.total` envelope used by /api/inspections, so a
        // generated client following the contract read `data.requests` and got
        // undefined. Nothing under `app/` calls this endpoint (the hono client is
        // wired in api-client.server.ts but never used), so the contract is the
        // only consumer and the handler is the side that was wrong.
        return c.json({ success: true, data: { requests: rows, total: rows.length } }, 200);
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
