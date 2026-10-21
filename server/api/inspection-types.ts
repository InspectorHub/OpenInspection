import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import type { ApiOf } from '../lib/api-schema';
import { requireRole } from '../lib/middleware/rbac';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import {
    CreateInspectionTypeSchema,
    CreatedInspectionTypeSchema,
    InspectionTypeSchema,
    UpdateInspectionTypeSchema,
} from '../lib/validations/inspection-type.schema';

// Settings + Library IA — tenant-defined inspection subtypes CRUD. Mirrors the
// event-types router shape (server/api/events.ts). Mounted at /api/admin so the
// client URL is /api/admin/inspection-types, matching /api/admin/event-types.
const idParam = z.object({ id: z.string().describe('Id of the inspection subtype to act on.') });
const ack = z.object({ success: z.literal(true).describe('Always true on success.') });

const listRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/inspection-types', tags: ['admin'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('Always true on success.'), data: z.array(InspectionTypeSchema).describe('The company inspection subtypes, lowest sort order first.') }) } }, description: 'Inspection subtypes' } },
    operationId: 'listInspectionTypes', summary: 'List the company inspection subtypes',
    description: 'Lists the inspection subtypes the company defined (for example Medical Office), ordered by their sort order. Open to owners, managers and inspectors.',
}, { scopes: ['read'], tier: 'extended' }));

const createTypeRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/inspection-types', tags: ['admin'],
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: CreateInspectionTypeSchema } }, required: true } },
    responses: { 201: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('Always true on success.'), data: CreatedInspectionTypeSchema.describe('The created subtype.') }) } }, description: 'Created' } },
    operationId: 'createInspectionType', summary: 'Create an inspection subtype',
    description: 'Creates a company-defined inspection subtype such as Medical Office, optionally based on a platform property subtype. Owner or manager only.',
}, { scopes: ['admin'], tier: 'extended' }));

const updateTypeRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/inspection-types/{id}', tags: ['admin'],
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: idParam, body: { content: { 'application/json': { schema: UpdateInspectionTypeSchema } }, required: true } },
    responses: { 200: { content: { 'application/json': { schema: ack } }, description: 'Updated' } },
    operationId: 'updateInspectionType', summary: 'Update an inspection subtype',
    description: 'Changes the fields given for one company inspection subtype; fields left out keep their value. Owner or manager only.',
}, { scopes: ['admin'], tier: 'extended' }));

const deleteTypeRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/inspection-types/{id}', tags: ['admin'],
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: idParam },
    responses: { 200: { content: { 'application/json': { schema: ack } }, description: 'Deleted' } },
    operationId: 'deleteInspectionType', summary: 'Delete an inspection subtype',
    description: 'Deletes one company inspection subtype. Owner or manager only.',
}, { scopes: ['admin'], tier: 'extended' }));

const inspectionTypesRoutes = createApiRouter();
inspectionTypesRoutes.openapi(listRoute, async (c) => {
    const data = await c.var.services.inspectionType.listInspectionTypes(c.get('tenantId'));
    return c.json({ success: true as const, data }, 200);
});
inspectionTypesRoutes.openapi(createTypeRoute, async (c) => {
    const row = await c.var.services.inspectionType.createInspectionType(c.get('tenantId'), c.req.valid('json'));
    return c.json({ success: true as const, data: row }, 201);
});
inspectionTypesRoutes.openapi(updateTypeRoute, async (c) => {
    const { id } = c.req.valid('param');
    await c.var.services.inspectionType.updateInspectionType(c.get('tenantId'), id, c.req.valid('json'));
    return c.json({ success: true as const }, 200);
});
inspectionTypesRoutes.openapi(deleteTypeRoute, async (c) => {
    const { id } = c.req.valid('param');
    await c.var.services.inspectionType.deleteInspectionType(c.get('tenantId'), id);
    return c.json({ success: true as const }, 200);
});

/** Registration order; drives the typed client and is pinned to the router by a test. */
export const inspectionTypesRouteConfigs = [listRoute, createTypeRoute, updateTypeRoute, deleteTypeRoute] as const;

export type InspectionTypesApi = ApiOf<typeof inspectionTypesRouteConfigs>;

export default inspectionTypesRoutes;
