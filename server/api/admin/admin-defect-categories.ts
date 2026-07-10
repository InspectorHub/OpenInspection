// Admin → Defect Categories sub-router (Authoring unification Plan-4, module K).
//
// Tenant-scoped, account-editable defect-category CRUD. GET seeds the
// canonical 3 rows (maintenance/recommendation/safety) on first read via
// `ensureSeed` so the list is never truly empty for an active tenant.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import {
    CreateDefectCategorySchema,
    UpdateDefectCategorySchema,
    DefectCategoryResponseSchema,
} from '../../lib/validations/defect-category.schema';
import { DefectCategoryService } from '../../services/inspection/defect-category.service';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const DefectCategoryResponse = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: DefectCategoryResponseSchema.describe('The defect category.'),
});
const DefectCategoryListResponse = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.array(DefectCategoryResponseSchema).describe('Tenant defect categories, sorted by sortOrder.'),
});

/* ── GET /api/admin/defect-categories ─────────────────────────────────────── */
const listDefectCategoriesRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/defect-categories',
    tags: ['admin'],
    summary: 'List defect categories for current tenant, seeding defaults on first read',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {},
    responses: {
        200: { content: { 'application/json': { schema: DefectCategoryListResponse } }, description: 'List' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'listDefectCategories',
    description: 'List the tenant defect categories, seeding maintenance/recommendation/safety on first read.',
}, { scopes: ['admin'], tier: 'extended' }));

/* ── POST /api/admin/defect-categories ────────────────────────────────────── */
const createDefectCategoryRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/defect-categories',
    tags: ['admin'],
    summary: 'Create a defect category for current tenant',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: CreateDefectCategorySchema } } } },
    responses: {
        201: { content: { 'application/json': { schema: DefectCategoryResponse } }, description: 'Created' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'createDefectCategory',
    description: 'Create a custom defect category (name/color/drivesSummary/sortOrder).',
}, { scopes: ['admin'], tier: 'extended' }));

/* ── PUT /api/admin/defect-categories/:id ─────────────────────────────────── */
const updateDefectCategoryRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/defect-categories/{id}',
    tags: ['admin'],
    summary: 'Update a defect category for current tenant',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Defect category id.') }),
        body: { content: { 'application/json': { schema: UpdateDefectCategorySchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: DefectCategoryResponse } }, description: 'Updated' },
        404: { description: 'Not found' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'updateDefectCategory',
    description: 'Patch name/color/drivesSummary/sortOrder on an existing defect category (seed rows may be edited, not deleted).',
}, { scopes: ['admin'], tier: 'extended' }));

/* ── DELETE /api/admin/defect-categories/:id ──────────────────────────────── */
const deleteDefectCategoryRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/defect-categories/{id}',
    tags: ['admin'],
    summary: 'Delete a non-seed defect category for current tenant',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('Defect category id.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ deleted: z.literal(true) }) }) } },
            description: 'Deleted',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'deleteDefectCategory',
    description: 'Delete a custom (non-seed) defect category. Seed rows (maintenance/recommendation/safety) are protected and silently no-op.',
}, { scopes: ['admin'], tier: 'extended' }));

export const adminDefectCategoriesRoutes = createApiRouter()
    .openapi(listDefectCategoriesRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const svc = new DefectCategoryService(c.env.DB);
        const data = await svc.ensureSeed(tenantId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(createDefectCategoryRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const input = c.req.valid('json');
        const svc = new DefectCategoryService(c.env.DB);
        const row = await svc.create(tenantId, input);
        auditFromContext(c, 'defect_category.created', 'defect_category', { entityId: row.id, metadata: { name: row.name } });
        return c.json({ success: true as const, data: row }, 201);
    })
    .openapi(updateDefectCategoryRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const svc = new DefectCategoryService(c.env.DB);
        await svc.update(tenantId, id, patch);
        const updated = (await svc.list(tenantId)).find((r) => r.id === id);
        if (!updated) throw Errors.NotFound('Defect category not found');
        auditFromContext(c, 'defect_category.updated', 'defect_category', { entityId: id });
        return c.json({ success: true as const, data: updated }, 200);
    })
    .openapi(deleteDefectCategoryRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const svc = new DefectCategoryService(c.env.DB);
        await svc.remove(tenantId, id);
        auditFromContext(c, 'defect_category.deleted', 'defect_category', { entityId: id });
        return c.json({ success: true as const, data: { deleted: true as const } }, 200);
    });

export type AdminDefectCategoriesApi = typeof adminDefectCategoriesRoutes;
export default adminDefectCategoriesRoutes;
