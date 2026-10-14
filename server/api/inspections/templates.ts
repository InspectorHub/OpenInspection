// Template CRUD and duplication sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import { auditFromContext } from '../../lib/audit';
import { paginationQuerySchema, PaginatedMetaSchema, buildMeta } from '../../lib/validations/pagination.schema';
import { CreateTemplateSchema, UpdateTemplateSchema } from '../../lib/validations/template.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { refuseStatutoryTemplateEdit } from '../../lib/middleware/refuse-statutory-template-edit';

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
                            // Retired rows are LISTED, not filtered out. A
                            // template that simply vanishes reads as a broken
                            // product or a lost permission; one that stays,
                            // disabled, with a reason, reads as what happened.
                            retiredAt: z.number().nullable()
                                .describe('When this template stopped being offered for new inspections, epoch ms, or null'),
                            retiredReason: z.enum(['superseded', 'uninstalled']).nullable()
                                .describe('Why it stopped being offered. The two differ in what anybody can do about it'),
                            // Ordering data, not a filter: the New Inspection
                            // picker leads with a general template unless the
                            // workspace's own state is known and a template is
                            // written to it. See app/lib/template-order.ts.
                            jurisdiction: z.string().nullable()
                                .describe('The state or country whose rules this template is written to, or null when it is written to none'),
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
        params: z.object({ id: z.string().describe('Id of the inspection template to retrieve.') }),
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
                    schema: CreateTemplateSchema.describe('The new template: its name and checklist schema.'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('templateCreate')],
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ template: z.unknown() })),
                },
            },
            description: 'Created',
        },
        403: { description: "Missing the 'templateCreate' capability" },
    },
    operationId: "createInspectionTemplates"
}, { scopes: ['write'], tier: 'extended', capability: 'templateCreate' }));


/**
 * PUT /api/inspections/templates/:id
 */
const updateTemplateRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/templates/{id}',
    tags: ["inspections", "templates"],
    summary: "Update inspection template for current tenant",
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Template to update.') }),
        body: {
            content: {
                'application/json': {
                    schema: UpdateTemplateSchema.describe('The template fields to change; omitted fields are left as they are.'),
                },
            },
        },
    },
    // Ahead of the body validator on purpose: a client that round-trips the
    // whole document would otherwise be answered by `.strict()` with
    // `unrecognized_keys`. See the middleware's own header.
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('templateEdit'), refuseStatutoryTemplateEdit()],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ template: z.unknown() })),
                },
            },
            description: 'Success',
        },
        403: { description: "Missing the 'templateEdit' capability, or the template produces an official form and is structurally read-only" },
    },
    operationId: "updateInspectionTemplate",
    description: "Update a template's name, checklist schema or default report profile. Despite the PUT verb it is a partial update: only the fields sent change. The schema is validated, the property type columns are re-derived from it, the template version number goes up by one on every call even if nothing changed, and a template.update audit entry is written. Returns 404 for an unknown template and 403 when the template produces an official form supplied with the software (its structure is read-only; duplicate it instead) or the user lacks the template edit capability. Restricted to owners, managers and inspectors."
}, { scopes: ['write'], tier: 'extended', capability: 'templateEdit' }));


/**
 * DELETE /api/inspections/templates/:id
 */
const deleteTemplateRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/templates/{id}',
    tags: ["inspections", "templates"],
    summary: "Delete inspection template for current tenant",
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Template to delete.') }),
    },
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('templateDelete')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema,
                },
            },
            description: 'Success',
        },
        403: { description: "Missing the 'templateDelete' capability" },
        409: { description: 'Another row still references this template' },
    },
    operationId: "deleteInspectionTemplate",
    description: "Permanently delete a template and write a template.delete audit entry. Refused with 409 while anything still references it: an inspection created from it, a service that uses it as its default, a report generated from it, or a marketplace import whose local copy it is (remove the import first). Returns 404 for an unknown template and 403 without the template delete capability. Not reversible. Restricted to owners, managers and inspectors."
}, { scopes: ['write'], tier: 'extended', capability: 'templateDelete' }));


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
    .openapi(updateTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const service = c.var.services.template;
        const template = await service.updateTemplate(id, c.get('tenantId'), body.name, body.schema, body.defaultProfileId);
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
