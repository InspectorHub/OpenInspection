import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import {
    CreateInspectionTypeSchema,
    UpdateInspectionTypeSchema,
} from '../lib/validations/inspection-type.schema';

// Settings + Library IA — tenant-defined inspection subtypes CRUD. Mirrors the
// event-types router shape (server/api/events.ts). Mounted at /api/admin so the
// client URL is /api/admin/inspection-types, matching /api/admin/event-types.
const inspectionTypesRoutes = createApiRouter()
    .get('/inspection-types', requireRole('owner', 'manager', 'inspector'), async (c) => {
        const data = await c.var.services.inspectionType.listInspectionTypes(c.get('tenantId'));
        return c.json({ success: true, data });
    })
    .post('/inspection-types', requireRole('owner', 'manager'), async (c) => {
        const parsed = CreateInspectionTypeSchema.safeParse(await c.req.json());
        if (!parsed.success) throw Errors.BadRequest('Invalid inspection type', parsed.error.flatten().fieldErrors);
        const row = await c.var.services.inspectionType.createInspectionType(c.get('tenantId'), parsed.data);
        return c.json({ success: true, data: row }, 201);
    })
    .put('/inspection-types/:id', requireRole('owner', 'manager'), async (c) => {
        const id = c.req.param('id') as string;
        const parsed = UpdateInspectionTypeSchema.safeParse(await c.req.json());
        if (!parsed.success) throw Errors.BadRequest('Invalid inspection type', parsed.error.flatten().fieldErrors);
        await c.var.services.inspectionType.updateInspectionType(c.get('tenantId'), id, parsed.data);
        return c.json({ success: true });
    })
    .delete('/inspection-types/:id', requireRole('owner', 'manager'), async (c) => {
        const id = c.req.param('id') as string;
        await c.var.services.inspectionType.deleteInspectionType(c.get('tenantId'), id);
        return c.json({ success: true });
    });

export type InspectionTypesApi = typeof inspectionTypesRoutes;

export default inspectionTypesRoutes;
