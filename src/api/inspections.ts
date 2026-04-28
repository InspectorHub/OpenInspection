import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { renderProfessionalReport } from '../templates/pages/report.template';
import { writeAuditLog } from '../lib/audit';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import {
    InspectionListQuerySchema,
    CreateInspectionSchema,
    UpdateInspectionSchema,
    PatchResultsSchema,
    BulkInspectionSchema,
    InspectionSchema,
    InspectionListResponseSchema,
    PublishInspectionSchema,
    ReportDataResponseSchema
} from '../lib/validations/inspection.schema';
import { CreateTemplateSchema, UpdateTemplateSchema } from '../lib/validations/template.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections as inspectionTable, inspectionResults, agreements, inspectionAgreements } from '../lib/db/schema';
import { eq, inArray, and } from 'drizzle-orm';

const inspectionsRoutes = new OpenAPIHono<HonoConfig>();

/**
 * GET /api/inspections
 * List inspections with pagination and stats.
 */
const listInspectionsRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Inspections'],
    summary: 'List inspections',
    description: 'Retrieve a paginated list of inspections with optional filtering.',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        query: InspectionListQuerySchema,
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: InspectionListResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(listInspectionsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const params = c.req.valid('query');
    const service = c.var.services.inspection;
    
    // Filter undefined values for exactOptionalPropertyTypes compliance
    const serviceParams = Object.fromEntries(
        Object.entries(params).filter(([_, v]) => v !== undefined)
    ) as typeof params;

    const result = await service.listInspections(tenantId, serviceParams);
    
    // Add stats on the first page
    let counts;
    if (!params.cursor) {
        counts = await service.getStats(tenantId);
    }

    return c.json({
        success: true,
        data: result.inspections,
        meta: {
            nextCursor: result.nextCursor,
            counts
        }
    }, 200);
});

/**
 * GET /api/inspections/templates
 */
const listTemplatesRoute = createRoute({
    method: 'get',
    path: '/templates',
    tags: ['Templates'],
    summary: 'List templates',
    description: 'Retrieve all inspection templates for the tenant.',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().openapi({ example: true }),
                        data: z.object({
                            templates: z.array(z.object({
                                id: z.string(),
                                name: z.string(),
                                version: z.number(),
                            })),
                        }),
                    }),
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(listTemplatesRoute, async (c) => {
    const service = c.var.services.template;
    const templates = await service.listTemplates(c.get('tenantId'));
    return c.json({ success: true, data: { templates } }, 200);
});

/**
 * GET /api/inspections/templates/:id
 */
const getTemplateRoute = createRoute({
    method: 'get',
    path: '/templates/{id}',
    tags: ['Templates'],
    summary: 'Get template',
    description: 'Retrieve a single template with full schema.',
    request: {
        params: z.object({ id: z.string() }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ template: z.unknown() })),
                },
            },
            description: 'Template details',
        },
    },
});

inspectionsRoutes.openapi(getTemplateRoute, async (c) => {
    const { id } = c.req.valid('param');
    const service = c.var.services.template;
    const template = await service.getTemplate(id, c.get('tenantId'));
    return c.json({ success: true, data: { template } }, 200);
});

/**
 * POST /api/inspections/templates
 */
const createTemplateRoute = createRoute({
    method: 'post',
    path: '/templates',
    tags: ['Templates'],
    summary: 'Create template',
    description: 'Create a new inspection template.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: CreateTemplateSchema,
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ template: z.unknown() })),
                },
            },
            description: 'Created',
        },
    },
});

inspectionsRoutes.openapi(createTemplateRoute, async (c) => {
    const body = c.req.valid('json');
    const service = c.var.services.template;
    const template = await service.createTemplate(c.get('tenantId'), body.name, body.schema);
    return c.json({ success: true, data: { template } }, 201);
});

/**
 * PUT /api/inspections/templates/:id
 */
const updateTemplateRoute = createRoute({
    method: 'put',
    path: '/templates/{id}',
    tags: ['Templates'],
    summary: 'Update template',
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
            content: {
                'application/json': {
                    schema: UpdateTemplateSchema,
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ template: z.unknown() })),
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(updateTemplateRoute, async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const service = c.var.services.template;
    const template = await service.updateTemplate(id, c.get('tenantId'), body.name, body.schema);
    return c.json({ success: true, data: { template } }, 200);
});

/**
 * DELETE /api/inspections/templates/:id
 */
const deleteTemplateRoute = createRoute({
    method: 'delete',
    path: '/templates/{id}',
    tags: ['Templates'],
    summary: 'Delete template',
    request: {
        params: z.object({ id: z.string().uuid() }),
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(deleteTemplateRoute, async (c) => {
    const { id } = c.req.valid('param');
    const service = c.var.services.template;
    await service.deleteTemplate(id, c.get('tenantId'));
    return c.json({ success: true, data: { success: true } }, 200);
});

/**
 * GET /api/inspections/inspectors
 */
const listInspectorsRoute = createRoute({
    method: 'get',
    path: '/inspectors',
    tags: ['Inspectors'],
    summary: 'List inspectors',
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().openapi({ example: true }),
                        data: z.object({
                            inspectors: z.array(z.object({
                                id: z.string(),
                                email: z.string(),
                                role: z.string(),
                            })),
                        }),
                    }),
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(listInspectorsRoute, async (c) => {
    const service = c.var.services.admin;
    const { members } = await service.getMembers(c.get('tenantId'));
    return c.json({ success: true, data: { inspectors: members } }, 200);
});

/**
 * PATCH /api/inspections/bulk
 */
const bulkUpdateRoute = createRoute({
    method: 'patch',
    path: '/bulk',
    tags: ['Inspections'],
    summary: 'Bulk update inspections',
    description: 'Perform mass operations on multiple inspections.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: BulkInspectionSchema,
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ count: z.number() })),
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(bulkUpdateRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const user = c.get('user');
    const body = c.req.valid('json');
    const db = drizzle(c.env.DB);

    if (body.action === 'assignInspector') {
        if (!body.inspectorId) throw Errors.BadRequest('inspectorId is required for assignInspector.');
        await db.update(inspectionTable).set({ inspectorId: body.inspectorId })
            .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)));

        writeAuditLog({
            db: c.env.DB, tenantId, userId: user.sub,
            action: 'inspection.bulk_assign', entityType: 'inspection',
            metadata: { ids: body.ids, inspectorId: body.inspectorId },
            ipAddress: c.req.header('CF-Connecting-IP'),
            executionCtx: c.executionCtx,
        });
    } else {
        if (!body.status) throw Errors.BadRequest('status is required for updateStatus.');
        await db.update(inspectionTable).set({ status: body.status })
            .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)));

        writeAuditLog({
            db: c.env.DB, tenantId, userId: user.sub,
            action: 'inspection.bulk_status', entityType: 'inspection',
            metadata: { ids: body.ids, status: body.status },
            ipAddress: c.req.header('CF-Connecting-IP'),
            executionCtx: c.executionCtx,
        });
    }

    return c.json({ success: true, data: { count: body.ids.length } }, 200);
});

/**
 * GET /api/inspections/:id
 */
const getInspectionRoute = createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Inspections'],
    summary: 'Get inspection',
    description: 'Retrieve detailed information about a single inspection.',
    request: {
        params: z.object({
            id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        inspection: InspectionSchema,
                        template: z.unknown().openapi({ description: 'The associated template schema' }),
                    })),
                },
            },
            description: 'Success',
        },
        404: {
            description: 'Inspection not found',
        },
    },
});

inspectionsRoutes.openapi(getInspectionRoute, async (c) => {
    const { id } = c.req.valid('param');
    const service = c.var.services.inspection;
    const result = await service.getInspection(id, c.get('tenantId'));
    return c.json({
        success: true,
        data: result
    }, 200);
});

/**
 * DELETE /api/inspections/:id
 */
const deleteInspectionRoute = createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Inspections'],
    summary: 'Delete inspection',
    description: 'Permanently remove an inspection record.',
    request: {
        params: z.object({
            id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
        }),
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(deleteInspectionRoute, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const service = c.var.services.inspection;
    const { inspection } = await service.getInspection(id, tenantId);

    const db = drizzle(c.env.DB);
    await db.delete(inspectionTable).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));

    writeAuditLog({
        db: c.env.DB, tenantId, userId: c.get('user')?.sub,
        action: 'inspection.delete', entityType: 'inspection', entityId: id,
        metadata: { propertyAddress: inspection.propertyAddress },
        ipAddress: c.req.header('CF-Connecting-IP'),
        executionCtx: c.executionCtx,
    });
    return c.json({ success: true, data: { success: true } }, 200);
});

/**
 * PATCH /api/inspections/:id
 */
const updateInspectionRoute = createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Inspections'],
    summary: 'Update inspection',
    description: 'Partially update an inspection record.',
    request: {
        params: z.object({
            id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
        }),
        body: {
            content: {
                'application/json': {
                    schema: UpdateInspectionSchema,
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(updateInspectionRoute, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');
    const db = drizzle(c.env.DB);

    const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);
    await db.update(inspectionTable).set(body).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));

    if (body.status && body.status !== inspection.status) {
        writeAuditLog({
            db: c.env.DB, tenantId, userId: c.get('user')?.sub,
            action: 'inspection.status_change', entityType: 'inspection', entityId: id,
            metadata: { from: inspection.status, to: body.status },
            ipAddress: c.req.header('CF-Connecting-IP'),
            executionCtx: c.executionCtx,
        });
    }
    return c.json({ success: true, data: { success: true } }, 200);
});

/**
 * GET /api/inspections/:id/results
 */
const getResultsRoute = createRoute({
    method: 'get',
    path: '/{id}/results',
    tags: ['Inspections'],
    summary: 'Get inspection results',
    request: {
        params: z.object({ id: z.string().uuid() }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ data: z.record(z.string(), z.unknown()) })),
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(getResultsRoute, async (c) => {
    const { id } = c.req.valid('param');
    const db = drizzle(c.env.DB);
    await c.var.services.inspection.getInspection(id, c.get('tenantId'));
    const results = await db.select().from(inspectionResults).where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, c.get('tenantId')))).get();
    return c.json({ success: true, data: { data: (results?.data || {}) } }, 200);
});

/**
 * PATCH /api/inspections/:id/results
 */
const updateResultsRoute = createRoute({
    method: 'patch',
    path: '/{id}/results',
    tags: ['Inspections'],
    summary: 'Update inspection results',
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
            content: {
                'application/json': {
                    schema: PatchResultsSchema,
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(updateResultsRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { data } = c.req.valid('json');
    const service = c.var.services.inspection;
    await service.updateResults(id, c.get('tenantId'), data);
    return c.json({ success: true, data: { success: true } }, 200);
});

/**
 * POST /api/inspections
 */
const createInspectionRoute = createRoute({
    method: 'post',
    path: '/',
    tags: ['Inspections'],
    summary: 'Create inspection',
    description: 'Initialize a new inspection for a property.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: CreateInspectionSchema,
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        inspection: InspectionSchema,
                    })),
                },
            },
            description: 'Created',
        },
    },
});

inspectionsRoutes.openapi(createInspectionRoute, async (c) => {
    const body = c.req.valid('json');
    const service = c.var.services.inspection;
    
    // Filter undefined values and handle inspectorId logic
    const createData = Object.fromEntries(
        Object.entries(body).filter(([_, v]) => v !== undefined)
    ) as typeof body;

    const inspection = await service.createInspection(c.get('tenantId'), {
        ...createData,
        inspectorId: body.inspectorId || c.get('user').sub
    });

    writeAuditLog({
        db: c.env.DB, tenantId: c.get('tenantId'), userId: c.get('user').sub,
        action: 'inspection.create', entityType: 'inspection', entityId: inspection.id,
        metadata: { propertyAddress: inspection.propertyAddress },
        ipAddress: c.req.header('CF-Connecting-IP'),
        executionCtx: c.executionCtx,
    });
    
    return c.json({
        success: true,
        data: { inspection }
    }, 201);
});

/**
 * POST /api/inspections/:id/clone
 */
const cloneInspectionRoute = createRoute({
    method: 'post',
    path: '/{id}/clone',
    tags: ['Inspections'],
    summary: 'Clone inspection',
    request: {
        params: z.object({ id: z.string().uuid() }),
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ inspection: InspectionSchema })),
                },
            },
            description: 'Created',
        },
    },
});

inspectionsRoutes.openapi(cloneInspectionRoute, async (c) => {
    const { id } = c.req.valid('param');
    const service = c.var.services.inspection;
    const clone = await service.cloneInspection(id, c.get('tenantId'));

    writeAuditLog({
        db: c.env.DB, tenantId: c.get('tenantId'), userId: c.get('user').sub,
        action: 'inspection.create', entityType: 'inspection', entityId: clone.id,
        metadata: { clonedFrom: id, propertyAddress: clone.propertyAddress },
        ipAddress: c.req.header('CF-Connecting-IP'),
        executionCtx: c.executionCtx,
    });
    return c.json({ success: true, data: { inspection: clone } }, 201);
});

/**
 * Photo Upload
 */
const uploadPhotoRoute = createRoute({
    method: 'post',
    path: '/{id}/upload',
    tags: ['Inspections'],
    summary: 'Upload inspection photo',
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        file: z.unknown().openapi({ type: 'string', format: 'binary' }),
                        itemId: z.string(),
                    }),
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ key: z.string(), success: z.boolean() })),
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(uploadPhotoRoute, async (c) => {
    const { id } = c.req.valid('param');
    const formData = await c.req.parseBody();
    const file = formData['file'] as File;
    const itemId = formData['itemId'] as string;
    
    if (!file || !itemId) throw Errors.BadRequest('File and Item ID are required');

    const service = c.var.services.inspection;
    const key = await service.uploadPhoto(id, c.get('tenantId'), itemId, file);
    return c.json({ success: true, data: { key, success: true } }, 200);
});

/**
 * Report View (HTML)
 */
inspectionsRoutes.get('/:id/report', async (c) => {
    const id = c.req.param('id');
    const service = c.var.services.inspection;
    const { inspection, template } = await service.getInspection(id!, c.get('tenantId'));
    
    const db = drizzle(c.env.DB);
    const results = await db.select().from(inspectionResults).where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, c.get('tenantId')))).get();

    return c.html(renderProfessionalReport({
        inspection: inspection as never,
        template: template as never,
        results: (results || { data: {} }) as never,
        branding: c.get('branding'),
        isAuthenticated: true
    }));
});

/**
 * GET /api/inspections/:id/sign-status (public — check if client already signed)
 */
inspectionsRoutes.get('/:id/sign-status', async (c) => {
    const id = c.req.param('id') as string;
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);

    const existing = await db.select().from(inspectionAgreements)
        .where(and(eq(inspectionAgreements.inspectionId, id), eq(inspectionAgreements.tenantId, tenantId))).get();

    return c.json({ success: true, data: { signed: !!existing } }, 200);
});

/**
 * GET /api/inspections/:id/agreement (public — for report gatekeeper)
 * Returns the first active agreement for this tenant.
 */
inspectionsRoutes.get('/:id/agreement', async (c) => {
    const id = c.req.param('id') as string;
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);

    // Verify inspection exists
    const inspection = await db.select().from(inspectionTable)
        .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
    if (!inspection) throw Errors.NotFound('Inspection not found');

    // Get the first agreement for this tenant
    const agreement = await db.select().from(agreements)
        .where(eq(agreements.tenantId, tenantId)).get();
    if (!agreement) {
        return c.json({ success: true, data: { agreement: null } }, 200);
    }

    return c.json({ success: true, data: { agreement: { id: agreement.id, name: agreement.name, content: agreement.content } } }, 200);
});

/**
 * POST /api/inspections/:id/sign (public — client signature submission)
 */
inspectionsRoutes.post('/:id/sign', async (c) => {
    const id = c.req.param('id') as string;
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);

    // Verify inspection exists
    const inspection = await db.select().from(inspectionTable)
        .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
    if (!inspection) throw Errors.NotFound('Inspection not found');

    const body = await c.req.json<{ signatureBase64: string }>();
    if (!body.signatureBase64) throw Errors.BadRequest('Signature is required');

    // Check if already signed
    const existing = await db.select().from(inspectionAgreements)
        .where(and(eq(inspectionAgreements.inspectionId, id), eq(inspectionAgreements.tenantId, tenantId))).get();
    if (existing) {
        return c.json({ success: true, data: { alreadySigned: true } }, 200);
    }

    await db.insert(inspectionAgreements).values({
        id: crypto.randomUUID(),
        tenantId,
        inspectionId: id,
        signatureBase64: body.signatureBase64,
        signedAt: new Date(),
        ipAddress: c.req.header('CF-Connecting-IP') || null,
        userAgent: c.req.header('User-Agent') || null,
    });

    return c.json({ success: true, data: { signed: true } }, 200);
});

/**
 * POST /api/inspections/:id/complete
 */
const completeInspectionRoute = createRoute({
    method: 'post',
    path: '/{id}/complete',
    tags: ['Inspections'],
    summary: 'Complete inspection',
    request: {
        params: z.object({ id: z.string().uuid() }),
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(completeInspectionRoute, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const service = c.var.services.inspection;
    const { inspection } = await service.getInspection(id, tenantId);

    const db = drizzle(c.env.DB);
    await db.update(inspectionTable).set({ status: 'completed' }).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));

    if (inspection.clientEmail) {
        const protocol = c.req.url.startsWith('https') ? 'https' : 'http';
        const host = c.req.header('host');
        const reportUrl = `${protocol}://${host}/api/inspections/${id}/report`;

        const emailService = c.var.services.email;
        const emailPromise = emailService.sendReportReady(inspection.clientEmail, inspection.propertyAddress as string, reportUrl);
        c.executionCtx.waitUntil(emailPromise);
    }

    writeAuditLog({
        db: c.env.DB, tenantId, userId: c.get('user')?.sub,
        action: 'inspection.complete', entityType: 'inspection', entityId: id,
        metadata: { propertyAddress: inspection.propertyAddress },
        ipAddress: c.req.header('CF-Connecting-IP'),
        executionCtx: c.executionCtx,
    });
    return c.json({ success: true, data: { success: true } }, 200);
});

/**
 * GET /api/inspections/:id/report-data
 */
const getReportDataRoute = createRoute({
    method: 'get',
    path: '/{id}/report-data',
    tags: ['Inspections'],
    summary: 'Get structured report data',
    request: {
        params: z.object({ id: z.string() }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(ReportDataResponseSchema),
                },
            },
            description: 'Report data',
        },
    },
});

inspectionsRoutes.openapi(getReportDataRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { id } = c.req.valid('param');
    const service = c.var.services.inspection;
    const data = await service.getReportData(id, tenantId);
    return c.json({ success: true, data }, 200);
});

/**
 * POST /api/inspections/:id/publish
 */
const publishRoute = createRoute({
    method: 'post',
    path: '/{id}/publish',
    tags: ['Inspections'],
    summary: 'Publish inspection report',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string() }),
        body: {
            content: {
                'application/json': {
                    schema: PublishInspectionSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ reportUrl: z.string(), status: z.string() })),
                },
            },
            description: 'Published',
        },
    },
});

inspectionsRoutes.openapi(publishRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const service = c.var.services.inspection;
    const result = await service.publishInspection(id, tenantId, body);
    return c.json({ success: true, data: result }, 200);
});

export default inspectionsRoutes;
