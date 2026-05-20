import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { renderProfessionalReport } from '../templates/pages/report.template';
import { ReportGatePage } from '../templates/pages/report-gate';
import { auditFromContext } from '../lib/audit';
import { getBaseUrl, getBookingHost } from '../lib/url';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { generatePdfFromUrl } from '../lib/pdf';
import {
    InspectionListQuerySchema,
    CreateInspectionSchema,
    UpdateInspectionSchema,
    PatchResultsSchema,
    BulkInspectionSchema,
    InspectionSchema,
    InspectionListResponseSchema,
    InspectionCountsSchema,
    PublishInspectionSchema,
    InspectionRecipientsResponseSchema,
    InspectionPeopleResponseSchema,
    ReportDataResponseSchema,
    CancelInspectionSchema,
    DashboardResponseSchema,
    PropertyFactsSchema,
    PropertyFactsResponseSchema,
    PropertyFactsAutofillRequestSchema,
    PropertyFactsAutofillResponseSchema,
    MediaCenterResponseSchema,
    MediaPoolUploadResponseSchema,
    MediaAttachRequestSchema,
    MediaAttachResponseSchema,
} from '../lib/validations/inspection.schema';
import { CreateTemplateSchema, UpdateTemplateSchema } from '../lib/validations/template.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';
import { AggregatedRecommendationsResponseSchema } from '../lib/validations/recommendation.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections as inspectionTable, inspectionResults, agreements, inspectionAgreements, agreementRequests, users, contacts } from '../lib/db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import type { Context } from 'hono';
import type { SignatureUser } from '../lib/inspector-signature';

const inspectionsRoutes = new OpenAPIHono<HonoConfig>();

/**
 * Sprint B-4a — resolves the inspector record for an inspection so outbound
 * report / agreement / share emails can append the inspector's rebooking
 * signature footer. Returns undefined when the inspection has no assigned
 * inspector or the lookup fails — callers should pass undefined through to
 * EmailService methods, which will skip the footer in that case.
 */
async function resolveSignatureInspector(
    c: Context<HonoConfig>,
    inspectorId: string | null | undefined,
    tenantId: string,
): Promise<SignatureUser | undefined> {
    if (!inspectorId) return undefined;
    try {
        const db = drizzle(c.env.DB);
        const row = await db.select({
            name:          users.name,
            email:         users.email,
            phone:         users.phone,
            licenseNumber: users.licenseNumber,
            slug:          users.slug,
        }).from(users).where(and(eq(users.id, inspectorId), eq(users.tenantId, tenantId))).get();
        return row ?? undefined;
    } catch (err) {
        logger.error('[email-signature] inspector lookup failed', { inspectorId }, err instanceof Error ? err : undefined);
        return undefined;
    }
}

// --- GET /api/inspections/dashboard — Spec 3A ---
const dashboardRoute = createRoute({
    method: 'get',
    path:   '/dashboard',
    tags:   ['Inspections'],
    summary: 'Bucketed inspections for dashboard',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(DashboardResponseSchema) } },
            description: 'Dashboard buckets',
        },
    },
});
inspectionsRoutes.openapi(dashboardRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const buckets  = await c.var.services.inspection.getDashboardBuckets(tenantId);
    // Agent Accounts A3 — count concierge bookings awaiting this inspector's
    // approval so the dashboard's UPCOMING card can render the substate line.
    let conciergePending = 0;
    try {
        const result = await c.var.services.concierge.listAwaitingInspector(tenantId);
        conciergePending = result.count;
    } catch (err) {
        logger.warn('inspections.dashboard.concierge.failed', {
            tenantId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    return c.json({ success: true, data: { ...buckets, conciergePending } });
});

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
                                itemCount: z.number().optional(),
                                source: z.enum(['marketplace', 'custom']).optional(),
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
 * GET /api/inspections/templates/duplicates
 *
 * Sprint 1 B-8 — returns marketplace import groups that have more than one
 * local copy in this tenant. The Marketplace duplicate banner consumes this
 * to suggest compare/use-new/keep-both actions on /templates.
 */
const listTemplateDuplicatesRoute = createRoute({
    method: 'get',
    path: '/templates/duplicates',
    tags: ['Templates'],
    summary: 'List duplicate marketplace imports',
    description: 'Returns one entry per marketplace template ID that has more than one local copy.',
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().openapi({ example: true }),
                        data: z.array(z.object({
                            marketplaceId: z.string(),
                            copies: z.array(z.object({
                                id:        z.string(),
                                name:      z.string(),
                                version:   z.string(),
                                createdAt: z.string(),
                            })),
                        })),
                    }),
                },
            },
            description: 'Duplicate import groups',
        },
    },
});

inspectionsRoutes.openapi(listTemplateDuplicatesRoute, async (c) => {
    const service = c.var.services.template;
    const dups = await service.findDuplicates(c.get('tenantId'));
    return c.json({ success: true, data: dups }, 200);
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
 * POST /api/inspections/templates/import-spectora
 * Thin wrapper over `convertSpectoraTemplate` + the existing createTemplate
 * path. Accepts a raw Spectora export payload and returns both the freshly
 * created template row and the conversion stats (for the diff display in
 * the upcoming import-from-Spectora UI).
 */
const importSpectoraRoute = createRoute({
    method: 'post',
    path: '/templates/import-spectora',
    tags: ['Templates'],
    summary: 'Import Spectora template',
    description: 'Convert a Spectora export to v2 and create a new template from it.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        name: z.string().min(1).max(100),
                        // Spectora exports vary; keep the inner shape permissive
                        // and let `convertSpectoraTemplate` do the structural work.
                        spectora: z.object({
                            id: z.string().optional(),
                            name: z.string().optional(),
                            sections: z.array(z.unknown()).optional(),
                        }).passthrough(),
                    }),
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
                        template: z.unknown(),
                        stats:    z.unknown(),
                    })),
                },
            },
            description: 'Imported',
        },
    },
});

inspectionsRoutes.openapi(importSpectoraRoute, async (c) => {
    const body = c.req.valid('json');
    const { convertSpectoraTemplate } = await import('../lib/spectora-import');
    const { template: schema, stats } = convertSpectoraTemplate(body.spectora as Parameters<typeof convertSpectoraTemplate>[0]);
    // createTemplate accepts a plain Record<string, unknown> schema; the
    // converter's TemplateSchemaV2 interface is structurally compatible,
    // so cast it through unknown to placate the strict index signature
    // requirement on the service entry-point.
    const template = await c.var.services.template.createTemplate(
        c.get('tenantId'),
        body.name,
        schema as unknown as Record<string, unknown>,
    );
    return c.json({ success: true, data: { template, stats } }, 201);
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
    const body = c.req.valid('json');
    const db = drizzle(c.env.DB);

    if (body.action === 'assignInspector') {
        if (!body.inspectorId) throw Errors.BadRequest('inspectorId is required for assignInspector.');
        await db.update(inspectionTable).set({ inspectorId: body.inspectorId })
            .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)));

        auditFromContext(c, 'inspection.bulk_assign', 'inspection', {
            metadata: { ids: body.ids, inspectorId: body.inspectorId },
        });
    } else {
        if (!body.status) throw Errors.BadRequest('status is required for updateStatus.');
        await db.update(inspectionTable).set({ status: body.status })
            .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)));

        auditFromContext(c, 'inspection.bulk_status', 'inspection', {
            metadata: { ids: body.ids, status: body.status },
        });
    }

    return c.json({ success: true, data: { count: body.ids.length } }, 200);
});

/**
 * GET /api/inspections/counts
 */
const getCountsRoute = createRoute({
    method: 'get',
    path: '/counts',
    tags: ['Inspections'],
    summary: 'Get inspection tab counts',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(InspectionCountsSchema) } },
            description: 'Tab counts',
        },
    },
});

inspectionsRoutes.openapi(getCountsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const counts = await c.var.services.inspection.getCounts(tenantId);
    return c.json({ success: true, data: counts });
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

    auditFromContext(c, 'inspection.delete', 'inspection', {
        entityId: id,
        metadata: { propertyAddress: inspection.propertyAddress },
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
        auditFromContext(c, 'inspection.status_change', 'inspection', {
            entityId: id,
            metadata: { from: inspection.status, to: body.status },
        });
    }
    return c.json({ success: true, data: { success: true } }, 200);
});

/**
 * Round-2 backlog G1 (Spectora §E.2) — GET /api/inspections/:id/property-facts
 * Returns the six Property Facts columns for the strip + report banner.
 */
const getPropertyFactsRoute = createRoute({
    method: 'get',
    path: '/{id}/property-facts',
    tags: ['Inspections'],
    summary: 'Get property facts',
    description: 'Returns the Property Facts strip payload (year built, sqft, foundation, lot, beds, baths).',
    request: {
        params: z.object({ id: z.string().uuid() }),
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: { 'application/json': { schema: PropertyFactsResponseSchema } },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(getPropertyFactsRoute, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const facts = await c.var.services.inspection.getPropertyFacts(id, tenantId);
    return c.json({ success: true, data: facts }, 200);
});

/**
 * Round-2 backlog G1 (Spectora §E.2) — PATCH /api/inspections/:id/property-facts
 * Inline-edit handler for the Property Facts card. Accepts a partial payload
 * so a single-field save round-trips without touching the other columns.
 */
const updatePropertyFactsRoute = createRoute({
    method: 'patch',
    path: '/{id}/property-facts',
    tags: ['Inspections'],
    summary: 'Update property facts',
    description: 'Patches the Property Facts strip. Omitted keys are unchanged; null clears a field.',
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { 'application/json': { schema: PropertyFactsSchema } } },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: { 'application/json': { schema: PropertyFactsResponseSchema } },
            description: 'Success',
        },
    },
});

inspectionsRoutes.openapi(updatePropertyFactsRoute, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');
    const facts = await c.var.services.inspection.updatePropertyFacts(id, tenantId, body);
    auditFromContext(c, 'inspection.property_facts.update', 'inspection', {
        entityId: id,
        metadata: { fields: Object.keys(body) },
    });
    return c.json({ success: true, data: facts }, 200);
});

/**
 * Sprint 3 S3-1 — POST /api/inspections/:id/property-facts/autofill
 *
 * Resolve property facts from an external public-records provider
 * (Estated.io). Body: { addressString }. Response: { facts, source }.
 * When no provider key is configured, returns
 * `{ facts: null, source: 'manual_required', reason: 'NO_API_KEY' }`
 * so the UI can show a polite "couldn't auto-fill" hint.
 *
 * Tenant ownership is verified via the inspection lookup. The endpoint
 * does NOT persist the facts — the inline-save flow already in
 * inspection-settings.js patches each field via the existing PATCH
 * /property-facts endpoint, preserving the inspector's manual overrides.
 */
const autofillPropertyFactsRoute = createRoute({
    method: 'post',
    path: '/{id}/property-facts/autofill',
    tags: ['Inspections'],
    summary: 'Auto-fill property facts from public records (Estated.io)',
    description: 'Returns mapped Property Facts payload or null + reason code. Inspector remains free to override fields manually after auto-fill.',
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { 'application/json': { schema: PropertyFactsAutofillRequestSchema } } },
    },
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: PropertyFactsAutofillResponseSchema } },
            description: 'Auto-fill result',
        },
    },
});

inspectionsRoutes.openapi(autofillPropertyFactsRoute, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const { addressString } = c.req.valid('json');

    // Tenant ownership guard — refuses cross-tenant lookups.
    await c.var.services.inspection.getInspection(id, tenantId);

    const result = await c.var.services.propertyLookup.lookup(addressString);
    auditFromContext(c, 'inspection.property_facts.autofill', 'inspection', {
        entityId: id,
        metadata: { source: result.source ?? 'manual_required', reason: result.reason },
    });

    return c.json({
        success: true as const,
        data: {
            facts:  result.data,
            source: result.source ?? ('manual_required' as const),
            ...(result.reason ? { reason: result.reason } : {}),
        },
    }, 200);
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
 * GET /api/inspections/:id/recommendations
 * Flattens all attached recommendations across all items + computes totals.
 * Spec 3 report renderer will consume this to build the consolidated repair list.
 */
const aggregateRecommendationsRoute = createRoute({
    method: 'get',
    path: '/{id}/recommendations',
    tags: ['Inspections'],
    summary: 'Aggregate all attached recommendations + totals for repair list',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
        200: { content: { 'application/json': { schema: AggregatedRecommendationsResponseSchema } }, description: 'Aggregated recommendations' },
    },
});

inspectionsRoutes.openapi(aggregateRecommendationsRoute, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = drizzle(c.env.DB);
    const row = await db.select().from(inspectionResults)
        .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();
    const data = (row?.data as Record<string, { recommendations?: Array<Record<string, unknown>> }>) ?? {};

    const items: Array<{ recommendationId: string; estimateSnapshotMin: number | null; estimateSnapshotMax: number | null; summarySnapshot: string; attachedAt: number; itemId: string }> = [];
    let estimateMinSum = 0;
    let estimateMaxSum = 0;
    for (const [itemId, item] of Object.entries(data)) {
        const recs = item?.recommendations ?? [];
        for (const rec of recs) {
            const r = rec as { recommendationId?: string; estimateSnapshotMin?: number | null; estimateSnapshotMax?: number | null; summarySnapshot?: string; attachedAt?: number };
            items.push({
                recommendationId:    r.recommendationId ?? '',
                estimateSnapshotMin: r.estimateSnapshotMin ?? null,
                estimateSnapshotMax: r.estimateSnapshotMax ?? null,
                summarySnapshot:     r.summarySnapshot ?? '',
                attachedAt:          r.attachedAt ?? 0,
                itemId,
            });
            estimateMinSum += r.estimateSnapshotMin ?? 0;
            estimateMaxSum += r.estimateSnapshotMax ?? 0;
        }
    }

    return c.json({
        success: true as const,
        data: {
            items,
            totals: { count: items.length, estimateMinSum, estimateMaxSum },
        },
    }, 200);
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

    auditFromContext(c, 'inspection.create', 'inspection', {
        entityId: inspection.id,
        metadata: { propertyAddress: inspection.propertyAddress },
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

    auditFromContext(c, 'inspection.create', 'inspection', {
        entityId: clone.id,
        metadata: { clonedFrom: id, propertyAddress: clone.propertyAddress },
    });
    return c.json({ success: true, data: { inspection: clone } }, 201);
});

/**
 * Photo Upload
 *
 * Sprint 1 A-7: accepts optional `targetType` ('item' | 'defect') and
 * `customId` so a photo can be bound to a specific custom defect row
 * instead of the item as a whole. R2 upload + storage logic is unchanged;
 * the response echoes the target so the client can attach the key to the
 * right custom row.
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
                        targetType: z.enum(['item', 'defect']).optional(),
                        customId: z.string().optional(),
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
                    schema: createApiResponseSchema(z.object({
                        key: z.string(),
                        success: z.boolean(),
                        targetType: z.enum(['item', 'defect']).optional(),
                        itemId: z.string().optional(),
                        customId: z.string().nullable().optional(),
                    })),
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
    const targetTypeRaw = formData['targetType'];
    const customIdRaw = formData['customId'];
    const targetType = (targetTypeRaw === 'defect' ? 'defect' : 'item') as 'item' | 'defect';
    const customId = typeof customIdRaw === 'string' && customIdRaw.length > 0 ? customIdRaw : null;

    if (!file || !itemId) throw Errors.BadRequest('File and Item ID are required');
    if (targetType === 'defect' && !customId) throw Errors.BadRequest('customId is required when targetType=defect');

    const service = c.var.services.inspection;
    const key = await service.uploadPhoto(id, c.get('tenantId'), itemId, file);
    return c.json({ success: true, data: { key, success: true, targetType, itemId, customId } }, 200);
});

/* ── Round-2 backlog #9 (Spectora §E.3) — Media Center ─────────────────────
 *
 * Three endpoints powering the editor's centralized photo library drawer:
 *   GET  /api/inspections/:id/media          — aggregate {attached, pool}
 *   POST /api/inspections/:id/media/upload   — bulk upload to loose pool
 *   POST /api/inspections/:id/media/attach   — attach pool photo to an item
 *   DELETE /api/inspections/:id/media/pool/:poolId — discard pool photo
 */
const mediaCenterRoute = createRoute({
    method: 'get',
    path:   '/{id}/media',
    tags:   ['Inspections'],
    summary: 'Media Center — all attached + pool photos',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(MediaCenterResponseSchema) } },
            description: 'Aggregated photos',
        },
    },
});
inspectionsRoutes.openapi(mediaCenterRoute, async (c) => {
    const { id } = c.req.valid('param');
    const data = await c.var.services.inspection.getMediaCenter(id, c.get('tenantId'));
    return c.json({ success: true, data }, 200);
});

const mediaUploadRoute = createRoute({
    method: 'post',
    path:   '/{id}/media/upload',
    tags:   ['Inspections'],
    summary: 'Upload a photo to the inspection media pool (loose, unattached)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        file:    z.unknown().openapi({ type: 'string', format: 'binary' }),
                        // Optional EXIF take-time as epoch milliseconds — the
                        // client-side photo picker extracts this when the
                        // browser exposes File.lastModified or an EXIF parser
                        // is available.
                        takenAt: z.coerce.number().int().nonnegative().optional(),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(MediaPoolUploadResponseSchema) } },
            description: 'Pool photo created',
        },
    },
});
inspectionsRoutes.openapi(mediaUploadRoute, async (c) => {
    const { id } = c.req.valid('param');
    const formData = await c.req.parseBody();
    const file = formData['file'] as File;
    const takenAtRaw = formData['takenAt'];
    if (!file) throw Errors.BadRequest('File is required');

    let takenAt: number | null = null;
    if (typeof takenAtRaw === 'string' && takenAtRaw.length > 0) {
        const n = Number(takenAtRaw);
        if (Number.isFinite(n) && n > 0) takenAt = Math.round(n);
    }

    const result = await c.var.services.inspection.uploadPoolPhoto(id, c.get('tenantId'), file, { takenAt });
    return c.json({ success: true, data: result }, 200);
});

const mediaAttachRoute = createRoute({
    method: 'post',
    path:   '/{id}/media/attach',
    tags:   ['Inspections'],
    summary: 'Attach a pool photo to an inspection item',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: { content: { 'application/json': { schema: MediaAttachRequestSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(MediaAttachResponseSchema) } },
            description: 'Photo attached',
        },
    },
});
inspectionsRoutes.openapi(mediaAttachRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { poolId, itemId } = c.req.valid('json');
    const result = await c.var.services.inspection.attachPoolPhoto(id, c.get('tenantId'), poolId, itemId);
    auditFromContext(c, 'inspection.media.attach', 'inspection', {
        entityId: id,
        metadata: { poolId, itemId },
    });
    return c.json({ success: true, data: result }, 200);
});

const mediaPoolDeleteRoute = createRoute({
    method: 'delete',
    path:   '/{id}/media/pool/{poolId}',
    tags:   ['Inspections'],
    summary: 'Delete a pool photo (cancel an upload)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid(), poolId: z.string().min(1) }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Pool photo deleted',
        },
    },
});
inspectionsRoutes.openapi(mediaPoolDeleteRoute, async (c) => {
    const { id, poolId } = c.req.valid('param');
    await c.var.services.inspection.deletePoolPhoto(id, c.get('tenantId'), poolId);
    return c.json({ success: true as const }, 200);
});

/**
 * Report View (HTML)
 */
inspectionsRoutes.get('/:id/report', async (c) => {
    const id = c.req.param('id');
    const service = c.var.services.inspection;

    // Agent view: token-based access that bypasses login and report gates
    const viewParam  = c.req.query('view');
    const tokenParam = c.req.query('token');
    if (viewParam === 'agent' && tokenParam) {
        const resolved = await service.resolveAgentViewToken(tokenParam);
        if (!resolved || resolved.inspectionId !== id) {
            return c.html('<html><body><p style="font-family:sans-serif;padding:2rem">Invalid or expired agent view link.</p></body></html>', 403);
        }
        const { inspection, template } = await service.getInspection(id!, resolved.tenantId);
        const db = drizzle(c.env.DB);
        const results = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, resolved.tenantId))).get();
        const resolvedTheme = c.var.services.branding.resolveReportTheme(inspection, c.get('branding'));
        return c.html(renderProfessionalReport({
            inspection: { ...inspection, internalNotes: null, paymentStatus: null, paymentRequired: false } as never,
            template: template as never,
            results: (results || { data: {} }) as never,
            branding: c.get('branding'),
            isAuthenticated: false,
            resolvedTheme,
        }));
    }

    const { inspection, template } = await service.getInspection(id!, c.get('tenantId'));

    // Report gates: payment or agreement required before viewing
    const baseUrl = getBaseUrl(c);
    const branding = c.get('branding');
    const companyName = branding?.siteName || c.env.APP_NAME || 'InspectorHub';
    const primaryColor = branding?.primaryColor || c.env.PRIMARY_COLOR || '#6366f1';

    let inspectorName: string | null = null;
    if (inspection.inspectorId) {
        const dbForName = drizzle(c.env.DB);
        const inspectorRow = await dbForName.select({ name: users.name })
            .from(users)
            .where(and(eq(users.id, inspection.inspectorId), eq(users.tenantId, c.get('tenantId'))))
            .get();
        inspectorName = inspectorRow?.name ?? null;
    }

    // iter-1 bug #3 — truthy coercion (see /report/:id gate in index.ts).
    if (inspection.paymentRequired && inspection.paymentStatus !== 'paid') {
        return c.html(ReportGatePage({
            reason: 'payment',
            companyName, primaryColor,
            actionUrl: `${baseUrl}/invoices?inspection=${id}`,
            actionLabel: 'View Invoice & Pay',
            propertyAddress: inspection.propertyAddress ?? null,
            inspectorName,
            scheduledDate:   inspection.date ?? null,
        }) as string);
    }

    if (inspection.agreementRequired) {
        const db2 = drizzle(c.env.DB);
        const signed = await db2.select({ id: agreementRequests.id })
            .from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, id as string),
                eq(agreementRequests.status, 'signed')
            ))
            .limit(1);
        if (signed.length === 0) {
            return c.html(ReportGatePage({
                reason: 'agreement',
                companyName, primaryColor,
                actionUrl: `${baseUrl}/sign/${id}`,
                actionLabel: 'Sign Agreement',
                propertyAddress: inspection.propertyAddress ?? null,
                inspectorName,
                scheduledDate:   inspection.date ?? null,
            }) as string);
        }
    }

    const db = drizzle(c.env.DB);
    const results = await db.select().from(inspectionResults).where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, c.get('tenantId')))).get();

    const resolvedTheme = c.var.services.branding.resolveReportTheme(inspection, c.get('branding'));
    return c.html(renderProfessionalReport({
        inspection: inspection as never,
        template: template as never,
        results: (results || { data: {} }) as never,
        branding: c.get('branding'),
        isAuthenticated: true,
        resolvedTheme,
    }));
});

/**
 * GET /api/inspections/:id/full — Spec 4E
 * Returns combined { inspection, template, results } for offline prefetch.
 * Avoids 3 separate fetches per inspection (saves ~150 round-trips for 50 inspections).
 */
inspectionsRoutes.get('/:id/full', requireRole(['owner', 'admin', 'inspector']), async (c) => {
    const id       = c.req.param('id') as string;
    const tenantId = c.get('tenantId');
    const svc      = c.var.services.inspection;
    try {
        const { inspection, template } = await svc.getInspection(id, tenantId);
        const db = drizzle(c.env.DB);
        const results = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();
        return c.json({ success: true, data: { inspection, template: template || null, results: results || null, base: null } });
    } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
            return c.json({ success: false, error: 'Inspection not found' }, 404);
        }
        throw err;
    }
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

    const raw = await c.req.json();
    const parsed = z.object({ signatureBase64: z.string().min(1) }).safeParse(raw);
    if (!parsed.success) return c.json({ success: false, error: { message: 'Invalid signature data', code: 'validation_error' } }, 400);
    const body = parsed.data;

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

    // Idempotency: if already completed, short-circuit to prevent accidental
    // email storms when the client retries on network errors or double-clicks.
    if (inspection.status === 'completed' || inspection.status === 'delivered') {
        return c.json({ success: true, data: { success: true } }, 200);
    }

    const db = drizzle(c.env.DB);
    await db.update(inspectionTable).set({ status: 'completed' }).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));

    if (inspection.clientEmail) {
        const baseUrl = getBaseUrl(c);
        const reportUrl = `${baseUrl}/report/${id}`;
        const clientEmail = inspection.clientEmail;
        const address = inspection.propertyAddress as string;

        // Sprint B-4a — resolve the inspector record so the report email
        // body carries the rebooking signature footer.
        const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);
        const sigHost = getBookingHost(c);

        // Best-effort PDF: if BROWSER binding is missing or rendering fails,
        // fall back to the existing text-only "Report Ready" email so we
        // never block inspection completion on an optional dependency.
        const deliver = async () => {
            try {
                const pdf = await generatePdfFromUrl(c.env.BROWSER, reportUrl);
                await c.var.services.email.sendInspectionReportPdf(clientEmail, address, reportUrl, pdf, sigInspector, sigHost);
            } catch (err) {
                logger.error('[complete] PDF generation failed, falling back to text-only email',
                    { inspectionId: id }, err instanceof Error ? err : undefined);
                await c.var.services.email.sendReportReady(clientEmail, address, reportUrl, sigInspector, sigHost);
            }
        };
        c.executionCtx.waitUntil(deliver());
    }

    // B3: in-app notification for report ready
    c.executionCtx.waitUntil(
        c.var.services.notification.createForAllAdmins(tenantId, {
            type: 'report.published',
            title: `Report ready — ${inspection.propertyAddress ?? 'inspection'}`,
            entityType: 'inspection',
            entityId: inspection.id,
            metadata: { clientEmail: inspection.clientEmail ?? null },
        })
    );

    auditFromContext(c, 'inspection.complete', 'inspection', {
        entityId: id,
        metadata: { propertyAddress: inspection.propertyAddress },
    });
    return c.json({ success: true, data: { success: true } }, 200);
});

const sendReportPdfRoute = createRoute({
    method: 'post',
    path: '/{id}/send-report-pdf',
    tags: ['Inspections'],
    summary: 'Re-send the inspection report as a PDF email attachment',
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        // Optional override; defaults to inspection.clientEmail
                        toEmail: z.string().email().optional(),
                    }).optional(),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ sentTo: z.string() }) }) } },
            description: 'PDF email queued',
        },
        400: { description: 'Recipient missing' },
        404: { description: 'Inspection not found' },
        503: { description: 'PDF rendering unavailable; text-only email sent instead' },
    },
    security: [{ bearerAuth: [] }],
});

inspectionsRoutes.openapi(sendReportPdfRoute, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json') ?? {};
    const service = c.var.services.inspection;
    const { inspection } = await service.getInspection(id, tenantId);

    const recipient = body.toEmail || inspection.clientEmail;
    if (!recipient) {
        throw Errors.BadRequest('No recipient email — set inspection.clientEmail or pass toEmail.');
    }

    const baseUrl = getBaseUrl(c);
    const reportUrl = `${baseUrl}/report/${id}`;
    const address = inspection.propertyAddress as string;

    // Sprint B-4a — append rebooking signature for the assigned inspector.
    const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);
    const sigHost = getBookingHost(c);

    try {
        const pdf = await generatePdfFromUrl(c.env.BROWSER, reportUrl);
        await c.var.services.email.sendInspectionReportPdf(recipient, address, reportUrl, pdf, sigInspector, sigHost);
        auditFromContext(c, 'inspection.send_pdf', 'inspection', { entityId: id, metadata: { recipient } });
        return c.json({ success: true as const, data: { sentTo: recipient } }, 200);
    } catch (err) {
        logger.error('[send-report-pdf] PDF failed, sending text-only', { inspectionId: id }, err instanceof Error ? err : undefined);
        await c.var.services.email.sendReportReady(recipient, address, reportUrl, sigInspector, sigHost);
        auditFromContext(c, 'inspection.send_text_fallback', 'inspection', { entityId: id, metadata: { recipient } });
        // 200 because the user got AN email, just not a PDF — log + audit captures the degradation
        return c.json({ success: true as const, data: { sentTo: recipient } }, 200);
    }
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
 * GET /api/inspections/:id/repair-list
 *
 * Track E1 (ITB §11, UC-ITB-07) — flat punch-list of every defect-rated
 * item across the inspection, suitable for handing to a contractor or
 * realtor. Authenticated route; the public viewer page hits the same
 * service via a server-side render at /inspections/:id/repair-list.
 */
const RepairListEntrySchema = z.object({
    sectionId:           z.string(),
    sectionTitle:        z.string(),
    itemId:              z.string(),
    itemLabel:           z.string(),
    comment:             z.string(),
    location:            z.string().nullable(),
    category:            z.enum(['safety', 'recommendation', 'maintenance']),
    recommendationId:    z.string().nullable(),
    recommendationLabel: z.string().nullable(),
    estimateLow:         z.number().nullable(),
    estimateHigh:        z.number().nullable(),
    photos:              z.array(z.object({ key: z.string(), url: z.string() })),
    source:              z.enum(['canned', 'custom']),
});
const RepairListResponseSchema = z.object({
    inspection: z.object({
        id:              z.string(),
        propertyAddress: z.string(),
        date:            z.string().nullable(),
        inspectorName:   z.string().nullable(),
    }),
    defects: z.array(RepairListEntrySchema),
    totals: z.object({
        count:           z.number(),
        safety:          z.number(),
        recommendation:  z.number(),
        maintenance:     z.number(),
        estimateLowSum:  z.number(),
        estimateHighSum: z.number(),
    }),
    showEstimates: z.boolean(),
});

const getRepairListRoute = createRoute({
    method: 'get',
    path: '/{id}/repair-list',
    tags: ['Inspections'],
    summary: 'Get aggregated repair list (defects-only punch list)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(RepairListResponseSchema) } },
            description: 'Repair list',
        },
    },
});

inspectionsRoutes.openapi(getRepairListRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { id } = c.req.valid('param');
    const data = await c.var.services.inspection.getRepairList(id, tenantId);
    return c.json({ success: true, data }, 200);
});

/**
 * POST /api/inspections/:id/confirm
 */
inspectionsRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/confirm',
    tags: ['Inspections'], summary: 'Confirm inspection',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Confirmed' } },
}), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    await c.var.services.inspection.confirmInspection(tenantId, id);
    return c.json({ success: true });
});

/**
 * POST /api/inspections/:id/cancel
 */
inspectionsRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/cancel',
    tags: ['Inspections'], summary: 'Cancel inspection',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: CancelInspectionSchema } } },
    },
    responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Cancelled' } },
}), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    const { reason, notes } = c.req.valid('json');
    await c.var.services.inspection.cancelInspection(tenantId, id, reason, notes);
    return c.json({ success: true });
});

/**
 * POST /api/inspections/:id/uncancel
 */
inspectionsRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/uncancel',
    tags: ['Inspections'], summary: 'Uncancel inspection',
    middleware: [requireRole(['owner', 'admin'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Uncancelled' } },
}), async (c) => {
    const tenantId = c.get('tenantId');
    const { id } = c.req.valid('param');
    await c.var.services.inspection.uncancelInspection(tenantId, id);
    return c.json({ success: true });
});

/**
 * Round-2 F1 — GET /api/inspections/:id/recipients
 * Returns the multi-party list (client + buyer agent + listing agent) that
 * the Publish modal renders per-recipient Email/Text checkboxes against.
 */
const recipientsRoute = createRoute({
    method:  'get',
    path:    '/{id}/recipients',
    tags:    ['Inspections'],
    summary: 'List the recipients eligible for the Publish modal',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRecipientsResponseSchema } },
            description: 'Recipient list',
        },
    },
});

inspectionsRoutes.openapi(recipientsRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { id }   = c.req.valid('param');
    const list     = await c.var.services.inspection.getRecipientList(id, tenantId);
    return c.json({ success: true, data: list }, 200);
});

/**
 * Round-2 F3 — GET /api/inspections/:id/people
 * People-card payload (inspector + client + buyer/listing agents).
 */
const peopleRoute = createRoute({
    method:  'get',
    path:    '/{id}/people',
    tags:    ['Inspections'],
    summary: 'People card payload (inspector, client, agents)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionPeopleResponseSchema } },
            description: 'People card',
        },
    },
});

inspectionsRoutes.openapi(peopleRoute, async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { id }   = c.req.valid('param');
    const card     = await c.var.services.inspection.getPeopleCard(id, tenantId);
    return c.json({ success: true, data: card }, 200);
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

    // Spec 5A.5 — enqueue + background-render Summary + Full PDFs after
    // publish. Best-effort: failures log but never block the publish
    // response. Persistent record in report_pdfs lets the client UI poll
    // (status: queued -> rendering -> ready) and offer Refresh PDFs.
    //
    // Migration 0059 — gated by tenant_configs.enable_pdf_pipeline (default
    // OFF). Free-plan tenants and Paid tenants who don't want the spend
    // skip rendering entirely; the report viewer's window.print() button
    // remains the universal fallback.
    const reportPdf = c.var.services.reportPdf;
    if (await reportPdf.isPipelineEnabled(tenantId)) {
        const baseUrl = getBaseUrl(c);
        const reportUrl = `${baseUrl}/report/${id}`;
        const sourceVersion = Date.now();
        const renderBoth = async () => {
            try {
                await Promise.all([
                    reportPdf.markQueued(id, tenantId, 'summary'),
                    reportPdf.markQueued(id, tenantId, 'full'),
                ]);
                await Promise.allSettled([
                    reportPdf.renderAndStore(id, tenantId, 'summary', { reportUrl, sourceVersion }),
                    reportPdf.renderAndStore(id, tenantId, 'full',    { reportUrl, sourceVersion }),
                ]);
            } catch (err) {
                logger.error('[publish] PDF render enqueue failed', { inspectionId: id }, err instanceof Error ? err : undefined);
            }
        };
        c.executionCtx.waitUntil(renderBoth());
    }

    return c.json({ success: true, data: result }, 200);
});

// ── Spec 5A.6 — POST /api/inspections/:id/pdf/refresh ──────────────────────────
// Re-enqueue Summary + Full PDF rendering. Inspector / admin only.
// Returns 202 with current status so the client can poll the same row via GET.
inspectionsRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/pdf/refresh',
    tags: ['Inspections'],
    summary: 'Refresh PDF renders (Summary + Full)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        202: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({
                status: z.string(),
                summary: z.string(),
                full: z.string(),
            })) } },
            description: 'PDF renders enqueued',
        },
    },
}), async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { id } = c.req.valid('param');
    const reportPdf = c.var.services.reportPdf;
    if (!(await reportPdf.isPipelineEnabled(tenantId))) {
        throw Errors.Forbidden('PDF pipeline is disabled for this workspace. Enable it in Settings → Reports.');
    }
    const baseUrl = getBaseUrl(c);
    const reportUrl = `${baseUrl}/report/${id}`;
    const sourceVersion = Date.now();

    await Promise.all([
        reportPdf.markQueued(id, tenantId, 'summary'),
        reportPdf.markQueued(id, tenantId, 'full'),
    ]);
    c.executionCtx.waitUntil((async () => {
        try {
            await Promise.allSettled([
                reportPdf.renderAndStore(id, tenantId, 'summary', { reportUrl, sourceVersion }),
                reportPdf.renderAndStore(id, tenantId, 'full',    { reportUrl, sourceVersion }),
            ]);
        } catch (err) {
            logger.error('[pdf/refresh] background render failed', { inspectionId: id }, err instanceof Error ? err : undefined);
        }
    })());

    return c.json({ success: true, data: { status: 'queued', summary: 'queued', full: 'queued' } }, 202);
});

// ── Spec 5A.7 — GET /api/inspections/:id/pdf?type=summary|full ─────────────────
// Streams the PDF from R2. Returns 404 if record missing, 202 with status
// payload if PDF still rendering / failed (client polls). Auth: any caller
// with a tenant context (logged-in inspector or branding-resolved request);
// public-share-token support follows the existing /report/:id pattern.
inspectionsRoutes.openapi(createRoute({
    method: 'get', path: '/{id}/pdf',
    tags: ['Inspections'],
    summary: 'Download report PDF (Summary or Full)',
    request: {
        params: z.object({ id: z.string() }),
        query: z.object({ type: z.enum(['summary', 'full']).default('full') }),
    },
    responses: {
        200: {
            content: { 'application/pdf': { schema: z.any() } },
            description: 'PDF bytes',
        },
        202: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({
                status: z.string(),
                error: z.string().nullable().optional(),
            })) } },
            description: 'PDF still rendering',
        },
    },
}), async (c) => {
    const tenantId = c.get('tenantId') as string;
    if (!tenantId) return c.json({ success: false, error: { message: 'Tenant required' } }, 400);
    const { id } = c.req.valid('param');
    const { type } = c.req.valid('query');
    const reportPdf = c.var.services.reportPdf;
    if (!(await reportPdf.isPipelineEnabled(tenantId))) {
        // Pipeline opt-in (migration 0059) — return 404 instead of leaking
        // the existence of any pre-migration rendered PDFs. Clients fall
        // back to window.print() in the report viewer.
        return c.json({ success: false, error: { message: 'PDF not found' } }, 404);
    }
    const record = await reportPdf.getPdfRecord(id, tenantId, type);
    if (!record) return c.json({ success: false, error: { message: 'PDF not found' } }, 404);
    if (record.status !== 'ready') {
        return c.json({ success: true, data: { status: record.status, error: record.error ?? null } }, 202);
    }
    const obj = await reportPdf.streamPdf(record);
    if (!obj) return c.json({ success: false, error: { message: 'PDF object missing in storage' } }, 404);
    return new Response(obj.body, {
        status: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="report-${id}-${type}.pdf"`,
            'Cache-Control': 'private, max-age=300',
        },
    });
});

// POST /api/inspections/:id/agent-token — generates a shareable agent view token
inspectionsRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/agent-token',
    tags: ['Inspections'],
    summary: 'Generate shareable agent view token',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ token: z.string(), url: z.string() })) } },
            description: 'Agent view token and URL',
        },
    },
}), async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { id } = c.req.valid('param');
    const token = await c.var.services.inspection.generateAgentViewToken(tenantId, id);
    const baseUrl = getBaseUrl(c);
    return c.json({ success: true, data: { token, url: `${baseUrl}/report/${id}?view=agent&token=${token}` } });
});

// ── Sprint 1 Sub-spec D Task 3 (D-3) — POST /api/inspections/:id/share-agent ────
// Generates a fresh 30-day agent view token and emails the link to the inspection's
// referring agent. Returns 400 if no agent is linked or the agent has no email on
// file. Used by the report viewer's Share dropdown ("Share with your agent").
inspectionsRoutes.openapi(createRoute({
    method: 'post', path: '/{id}/share-agent',
    tags: ['Inspections'],
    summary: 'Email the report share link to the linked agent',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ sentTo: z.string() })) } },
            description: 'Share link emailed to agent',
        },
    },
}), async (c) => {
    const tenantId = c.get('tenantId') as string;
    const { id } = c.req.valid('param');
    const db = drizzle(c.env.DB);

    const inspectionRow = await db.select({
        id: inspectionTable.id,
        propertyAddress: inspectionTable.propertyAddress,
        referredByAgentId: inspectionTable.referredByAgentId,
        inspectorId: inspectionTable.inspectorId,
    }).from(inspectionTable)
        .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)))
        .get();
    if (!inspectionRow) throw Errors.NotFound('Inspection not found');
    if (!inspectionRow.referredByAgentId) {
        throw Errors.BadRequest('No agent linked to this inspection');
    }

    const agentRow = await db.select({ email: contacts.email })
        .from(contacts)
        .where(and(eq(contacts.id, inspectionRow.referredByAgentId), eq(contacts.tenantId, tenantId)))
        .get();
    if (!agentRow || !agentRow.email) {
        throw Errors.BadRequest('Agent has no email on file');
    }

    const token = await c.var.services.inspection.generateAgentViewToken(tenantId, id);
    const baseUrl = getBaseUrl(c);
    const url = `${baseUrl}/report/${id}?view=agent&token=${token}`;

    // Sprint B-4c — append the inspector's signature so the receiving agent
    // can rebook with the same inspector for future referrals.
    const sigInspector = await resolveSignatureInspector(c, inspectionRow.inspectorId, tenantId);
    const sigHost = getBookingHost(c);

    try {
        await c.var.services.email.sendAgentShareLink(agentRow.email, inspectionRow.propertyAddress, url, sigInspector, sigHost);
    } catch (err) {
        logger.error('[share-agent] email delivery failed', { inspectionId: id }, err instanceof Error ? err : undefined);
        throw Errors.Internal('Failed to send share link');
    }

    auditFromContext(c, 'inspection.share_agent', 'inspection', {
        entityId: id,
        metadata: { agentEmail: agentRow.email },
    });
    return c.json({ success: true, data: { sentTo: agentRow.email } });
});

// ── Phase T (T12): Photo annotation save ────────────────────────────────────────
const saveAnnotationRoute = createRoute({
    method: 'post',
    path: '/{id}/items/{itemId}/photos/{photoIndex}/annotation',
    tags: ['Inspections'],
    summary: 'Save photo annotation (composite PNG + Konva nodes JSON)',
    request: {
        params: z.object({
            id: z.string(),
            itemId: z.string(),
            photoIndex: z.coerce.number().int().min(0),
        }),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        image: z.unknown().openapi({ type: 'string', format: 'binary' }),
                        nodes: z.string(),
                    }),
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ annotatedKey: z.string() })) } },
            description: 'Annotation saved',
        },
    },
});

inspectionsRoutes.openapi(saveAnnotationRoute, async (c) => {
    const { id, itemId, photoIndex } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const formData = await c.req.parseBody();
    const file = formData['image'] as File | undefined;
    const nodesJson = String(formData['nodes'] ?? '[]');
    if (!file) throw Errors.BadRequest('image file required');
    const bytes = await file.arrayBuffer();
    const result = await c.var.services.inspection.saveAnnotation(
        id, tenantId, itemId, photoIndex, bytes, nodesJson,
    );
    return c.json({ success: true, data: result }, 200);
});

// -----------------------------------------------------------------------------
// Agent Accounts A3 — POST /api/inspections/:id/concierge/approve
// -----------------------------------------------------------------------------
// Inspector flips an awaiting_inspector concierge booking to awaiting_client.
// Service mints the magic-link + sends the client confirm email. Tenant scope
// is enforced via JWT-derived tenantId — never trust the URL for tenant.
const approveConciergeRoute = createRoute({
    method: 'post',
    path:   '/{id}/concierge/approve',
    tags:   ['Inspections'],
    summary: 'Approve a concierge booking awaiting inspector review',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid() }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Approved',
        },
        404: { description: 'Inspection not found in this tenant' },
        409: { description: 'Inspection is not in awaiting_inspector state' },
    },
});
inspectionsRoutes.openapi(approveConciergeRoute, async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    await c.var.services.concierge.approveByInspector(id, tenantId);
    return c.json({ success: true as const, data: { success: true as const } }, 200);
});

export default inspectionsRoutes;
