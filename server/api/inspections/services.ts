// IA-87 — /api/inspections/:id/services: the write face for the service lines
// on an existing inspection.
//
// `inspection_services` rows used to be written exactly once, at creation time
// (booking, the new-inspection wizard, the concierge hold). After that the set
// was frozen: the hub's Services card could show what was sold but offered no
// way to add, reprice, or drop a line, and the only lever left on the money was
// `inspections.price` — a denormalized cache, edited from a panel inside the
// REPORT editor. Price is order information, not report content.
//
// Auth is `requireRole('owner', 'manager')`, deliberately narrower than the
// sibling people routes (which include 'inspector'): every verb here changes
// what the client is billed. The hub gates the same UI on the same role read,
// so the page can never offer a button the API refuses.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { getTenantId } from '../../lib/route-helpers';
import {
    AddInspectionServiceSchema,
    UpdateInspectionServiceSchema,
    InspectionServiceResponseSchema,
} from '../../lib/validations/service.schema';
import { SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const IdParam = z.object({
    id: z.string().describe('Inspection id the service line belongs to.'),
});

const LineParam = IdParam.extend({
    lineId: z.string().describe('inspection_services row id.'),
});

const inspectionServiceRoutes = createApiRouter()
    // POST /api/inspections/:id/services
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/services',
        tags: ['inspections'],
        summary: 'Add a catalog service to an inspection',
        middleware: [requireRole('owner', 'manager')] as const,
        request: {
            params: IdParam,
            body: { content: { 'application/json': { schema: AddInspectionServiceSchema } } },
        },
        responses: {
            201: { content: { 'application/json': { schema: InspectionServiceResponseSchema } }, description: 'Line added (or the existing line, when it was already booked)' },
        },
        operationId: 'addInspectionService',
        description: 'Adds a service from the tenant catalog to an existing inspection, snapshotting its name and price. Optionally charges a per-inspection override price. Adding a service the inspection already has returns the existing line unchanged.',
    }, { scopes: ['write'], tier: 'primary' })), async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const { serviceId, priceOverrideCents } = c.req.valid('json');
        const row = await c.var.services.service.addInspectionService(tenantId, id, serviceId, priceOverrideCents);
        return c.json({ success: true, data: row }, 201);
    })
    // PATCH /api/inspections/:id/services/:lineId
    .openapi(createRoute(withMcpMetadata({
        method: 'patch', path: '/{id}/services/{lineId}',
        tags: ['inspections'],
        summary: 'Reprice one service line on an inspection',
        middleware: [requireRole('owner', 'manager')] as const,
        request: {
            params: LineParam,
            body: { content: { 'application/json': { schema: UpdateInspectionServiceSchema } } },
        },
        responses: {
            200: { content: { 'application/json': { schema: InspectionServiceResponseSchema } }, description: 'Line repriced' },
        },
        operationId: 'updateInspectionService',
        description: 'Sets the per-inspection price override on one service line. Passing null clears the override so the line reverts to the catalog price snapshotted when it was added.',
    }, { scopes: ['write'], tier: 'primary' })), async (c) => {
        const tenantId = getTenantId(c);
        const { id, lineId } = c.req.valid('param');
        const { priceOverrideCents } = c.req.valid('json');
        const row = await c.var.services.service.setInspectionServicePrice(tenantId, id, lineId, priceOverrideCents);
        return c.json({ success: true, data: row });
    })
    // DELETE /api/inspections/:id/services/:lineId
    .openapi(createRoute(withMcpMetadata({
        method: 'delete', path: '/{id}/services/{lineId}',
        tags: ['inspections'],
        summary: 'Remove a service line from an inspection',
        middleware: [requireRole('owner', 'manager')] as const,
        request: { params: LineParam },
        responses: {
            200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Line removed' },
            409: { description: 'Refused: a report delivers this line, and removing it would strand that report' },
        },
        operationId: 'removeInspectionService',
        description: 'Removes one booked service line from an inspection. Does not touch the tenant service catalog. Refuses with 409 when a report (in progress or published) delivers this line.',
    }, { scopes: ['write'], tier: 'primary' })), async (c) => {
        const tenantId = getTenantId(c);
        const { id, lineId } = c.req.valid('param');
        await c.var.services.service.removeInspectionService(tenantId, id, lineId);
        return c.json({ success: true });
    });

export default inspectionServiceRoutes;
