// Template CRUD, duplicates, and Spectora import sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { paginationQuerySchema, PaginatedMetaSchema, buildMeta } from '../../lib/validations/pagination.schema';
import { CreateTemplateSchema, UpdateTemplateSchema } from '../../lib/validations/template.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

/**
 * GET /api/inspections/templates
 */
const listTemplatesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/templates',
    tags: ["inspections", "templates"],
    summary: "List inspection templates (paginated)",
    description: "Paginated list of inspection templates for the tenant.",
    request: { query: paginationQuerySchema.extend({ q: z.string().optional().describe('Filter templates by name (case-insensitive substring match)') }) },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean(),
                        data: z.array(z.object({
                            id: z.string(),
                            name: z.string(),
                            version: z.number(),
                            itemCount: z.number(),
                            source: z.enum(['marketplace', 'custom']),
                        })),
                        meta: PaginatedMetaSchema,
                    }),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listInspectionTemplates",
}, { scopes: ['read'], tier: 'extended' }));


/**
 * GET /api/inspections/templates/duplicates
 *
 * Sprint 1 B-8 — returns marketplace import groups that have more than one
 * local copy in this tenant. The Marketplace duplicate banner consumes this
 * to suggest compare/use-new/keep-both actions on /templates.
 */
const listTemplateDuplicatesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/templates/duplicates',
    tags: ["inspections", "templates"],
    summary: 'List duplicate marketplace imports',
    description: 'Returns one entry per marketplace template ID that has more than one local copy.',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().openapi({ example: true }).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.array(z.object({
                            marketplaceId: z.string().describe('TODO describe marketplaceId field for the OpenInspection MCP integration'),
                            copies: z.array(z.object({
                                id:        z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
                                name:      z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
                                version:   z.string().describe('TODO describe version field for the OpenInspection MCP integration'),
                                createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
                            })).describe('TODO describe copies field for the OpenInspection MCP integration'),
                        })),
                    }),
                },
            },
            description: 'Duplicate import groups',
        },
    },
    operationId: "listInspectionTemplatesDuplicates"
}, { scopes: ['read'], tier: 'extended' }));


/**
 * GET /api/inspections/templates/:id
 */
const getTemplateRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/templates/{id}',
    tags: ["inspections", "templates"],
    summary: "Get inspection template for current tenant",
    description: "Retrieve a single template with full schema. (GET /templates/{id}, inspections domain).",
    request: {
        params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ template: z.unknown().describe('TODO describe template field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Template details',
        },
    },
    operationId: "getInspectionTemplate"
}, { scopes: ['read'], tier: 'extended' }));


/**
 * POST /api/inspections/templates
 */
const createTemplateRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/templates',
    tags: ["inspections", "templates"],
    summary: "Create inspection templates for current tenant",
    description: "Create a new inspection template. (POST /templates, inspections domain).",
    request: {
        body: {
            content: {
                'application/json': {
                    schema: CreateTemplateSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ template: z.unknown().describe('TODO describe template field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Created',
        },
    },
    operationId: "createInspectionTemplates"
}, { scopes: ['write'], tier: 'extended' }));


/**
 * POST /api/inspections/templates/import-spectora
 * Thin wrapper over `convertSpectoraTemplate` + the existing createTemplate
 * path. Accepts a raw Spectora export payload and returns both the freshly
 * created template row and the conversion stats (for the diff display in
 * the upcoming import-from-Spectora UI).
 */
const importSpectoraRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/templates/import-spectora',
    tags: ["inspections", "templates"],
    summary: "Create inspection templates import spectora",
    description: 'Convert a Spectora export to v2 and create a new template from it.',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        name: z.string().min(1).max(100).describe('TODO describe name field for the OpenInspection MCP integration'),
                        // Spectora exports vary; keep the inner shape permissive
                        // and let `convertSpectoraTemplate` do the structural work.
                        spectora: z.object({
                            id: z.string().optional().describe('TODO describe id field for the OpenInspection MCP integration'),
                            name: z.string().optional().describe('TODO describe name field for the OpenInspection MCP integration'),
                            sections: z.array(z.unknown()).optional().describe('TODO describe sections field for the OpenInspection MCP integration'),
                        }).passthrough().describe('TODO describe spectora field for the OpenInspection MCP integration'),
                    }),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        template: z.unknown().describe('TODO describe template field for the OpenInspection MCP integration'),
                        stats:    z.unknown().describe('TODO describe stats field for the OpenInspection MCP integration'),
                    })),
                },
            },
            description: 'Imported',
        },
    },
    operationId: "createInspectionTemplatesImportSpectora"
}, { scopes: ['write'], tier: 'extended' }));


/**
 * PUT /api/inspections/templates/:id
 */
const updateTemplateRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/templates/{id}',
    tags: ["inspections", "templates"],
    summary: "Update inspection template for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: UpdateTemplateSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ template: z.unknown().describe('TODO describe template field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Success',
        },
    },
    operationId: "updateInspectionTemplate",
    description: "Auto-generated placeholder for updateInspectionTemplate (PUT /templates/{id}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


/**
 * DELETE /api/inspections/templates/:id
 */
const deleteTemplateRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/templates/{id}',
    tags: ["inspections", "templates"],
    summary: "Delete inspection template for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "deleteInspectionTemplate",
    description: "Auto-generated placeholder for deleteInspectionTemplate (DELETE /templates/{id}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


const templatesRoutes = createApiRouter()
    .openapi(listTemplatesRoute, async (c) => {
        const queryParams = c.req.valid('query');
        const service = c.var.services.template;
        const { page, pageSize, q } = queryParams;
        const { rows, total } = await service.listTemplates(c.get('tenantId'), {
            ...(page !== undefined ? { page } : {}),
            ...(pageSize !== undefined ? { pageSize } : {}),
            ...(q !== undefined ? { q } : {}),
        });
        return c.json({
            success: true,
            data: rows,
            meta: buildMeta({ total, page: queryParams.page, pageSize: queryParams.pageSize }),
        }, 200);
    })
    .openapi(listTemplateDuplicatesRoute, async (c) => {
        const service = c.var.services.template;
        const dups = await service.findDuplicates(c.get('tenantId'));
        return c.json({ success: true, data: dups }, 200);
    })
    .openapi(getTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.template;
        const template = await service.getTemplate(id, c.get('tenantId'));
        return c.json({ success: true, data: { template } }, 200);
    })
    .openapi(createTemplateRoute, async (c) => {
        const body = c.req.valid('json');
        const service = c.var.services.template;
        const template = await service.createTemplate(c.get('tenantId'), body.name, body.schema);
        auditFromContext(c, 'template.create', 'template', {
            entityId: template.id,
            metadata: { name: template.name },
        });
        return c.json({ success: true, data: { template } }, 201);
    })
    .openapi(importSpectoraRoute, async (c) => {
        const body = c.req.valid('json');
        const { convertSpectoraTemplate } = await import('../../lib/spectora-import');
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
        auditFromContext(c, 'template.create', 'template', {
            entityId: template.id,
            metadata: { name: template.name, source: 'spectora-import' },
        });
        return c.json({ success: true, data: { template, stats } }, 201);
    })
    .openapi(updateTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const service = c.var.services.template;
        const template = await service.updateTemplate(id, c.get('tenantId'), body.name, body.schema);
        auditFromContext(c, 'template.update', 'template', {
            entityId: id,
            metadata: { name: template.name },
        });
        return c.json({ success: true, data: { template } }, 200);
    })
    .openapi(deleteTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.template;
        await service.deleteTemplate(id, c.get('tenantId'));
        auditFromContext(c, 'template.delete', 'template', { entityId: id });
        return c.json({ success: true }, 200);
    });

export default templatesRoutes;
