import { createRoute, z } from '@hono/zod-openapi';
import { HonoConfig } from '../types/hono';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { getBookingHost } from '../lib/url';
import { reportUrl as buildReportUrl } from '../lib/public-urls';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { generatePdfFromUrl } from '../lib/pdf';
import { getCookie } from 'hono/cookie';
import { verifyObserverCookie } from '../lib/observer-cookie';
import { OBSERVER_COOKIE_NAME } from '../lib/middleware/observer-cookie';
import { paginationQuerySchema, PaginatedMetaSchema, buildMeta } from '../lib/validations/pagination.schema';
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
    ResultsBatchSchema,
    ResultsBatchResponseSchema,
    ConflictListResponseSchema,
    ConflictResolveSchema,
    ConflictResolveResponseSchema,
} from '../lib/validations/inspection.schema';
import { CreateTemplateSchema, UpdateTemplateSchema, TemplateSchemaV2Schema } from '../lib/validations/template.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';
import { AggregatedRecommendationsResponseSchema } from '../lib/validations/recommendation.schema';
import { UpdateMediaAnnotationsSchema } from '../lib/validations/media.schema';
import { PatchItemFieldSchema } from '../lib/validations/inspection-patch.schema';
import { CreateInspectionFromWizardSchema } from '../lib/validations/wizard.schema';
import { CreateUnitSchema, UpdateUnitSchema, MoveUnitSchema } from '../lib/validations/unit.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections as inspectionTable, inspectionResults, agreements, inspectionAgreements, users, contacts } from '../lib/db/schema';
import { applyResultsBatch } from '../services/inspection-results.service';
import { listPendingConflicts, resolveConflicts } from '../services/conflicts.service';
import { eq, inArray, and } from 'drizzle-orm';
import type { Context } from 'hono';
import type { SignatureUser } from '../lib/inspector-signature';
import { withMcpMetadata } from "../lib/route-metadata-standards";

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
            name:            users.name,
            email:           users.email,
            phone:           users.phone,
            licenseNumber:   users.licenseNumber,
            slug:            users.slug,
        }).from(users).where(and(eq(users.id, inspectorId), eq(users.tenantId, tenantId))).get();
        if (!row) return undefined;
        const tenantSubdomain = c.get('requestedSubdomain') ?? null;
        return { ...row, tenantSubdomain };
    } catch (err) {
        logger.error('[email-signature] inspector lookup failed', { inspectorId }, err instanceof Error ? err : undefined);
        return undefined;
    }
}

// --- GET /api/inspections/dashboard — Spec 3A ---
const dashboardRoute = createRoute(withMcpMetadata({
    method: 'get',
    path:   '/dashboard',
    tags: ["inspections"],
    summary: 'Bucketed inspections for dashboard',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(DashboardResponseSchema) } },
            description: 'Dashboard buckets',
        },
    },
    operationId: "dashboardInspection",
    description: "Auto-generated placeholder for dashboardInspection (GET /dashboard, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * GET /api/inspections
 * List inspections with pagination and stats.
 */
const listInspectionsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/',
    tags: ["inspections"],
    summary: "List inspections for current tenant",
    description: 'Retrieve a paginated list of inspections with optional filtering.',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        query: InspectionListQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: InspectionListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listInspections"
}, { scopes: ['read'], tier: 'primary' }));


/**
 * GET /api/inspections/templates
 */
const listTemplatesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/templates',
    tags: ["inspections", "templates"],
    summary: "List inspection templates (paginated)",
    description: "Paginated list of inspection templates for the tenant.",
    request: { query: paginationQuerySchema },
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
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
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
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
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
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
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
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
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
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
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


/**
 * GET /api/inspections/inspectors
 */
const listInspectorsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspectors',
    tags: ["inspections"],
    summary: "List inspection inspectors for current tenant",
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().openapi({ example: true }).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.array(z.object({
                            id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
                            email: z.string().describe('TODO describe email field for the OpenInspection MCP integration'),
                            role: z.string().describe('TODO describe role field for the OpenInspection MCP integration'),
                            // Handler returns raw service rows; createdAt is a Date instance.
                            createdAt: z.date().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
                        })).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listInspectionInspectors",
    description: "Auto-generated placeholder for listInspectionInspectors (GET /inspectors, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));


/**
 * PATCH /api/inspections/bulk
 */
const bulkUpdateRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/bulk',
    tags: ["inspections"],
    summary: "Bulk inspection for current tenant",
    description: "Perform mass operations on multiple inspections. (PATCH /bulk, inspections domain).",
    request: {
        body: {
            content: {
                'application/json': {
                    schema: BulkInspectionSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ count: z.number().describe('TODO describe count field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Success',
        },
    },
    operationId: "bulkInspection"
}, { scopes: ['write'], tier: 'extended' }));


/**
 * GET /api/inspections/counts
 */
const getCountsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/counts',
    tags: ["inspections"],
    summary: 'Get inspection tab counts',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(InspectionCountsSchema) } },
            description: 'Tab counts',
        },
    },
    operationId: "countsInspection",
    description: "Auto-generated placeholder for countsInspection (GET /counts, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));


/**
 * GET /api/inspections/:id
 */
const getInspectionRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}',
    tags: ["inspections"],
    summary: "Get inspection for current tenant",
    description: 'Retrieve detailed information about a single inspection.',
    request: {
        params: z.object({
            id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        inspection: InspectionSchema.describe('TODO describe inspection field for the OpenInspection MCP integration'),
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
    operationId: "getInspection"
}, { scopes: ['read'], tier: 'primary' }));


/**
 * DELETE /api/inspections/:id
 */
const deleteInspectionRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{id}',
    tags: ["inspections"],
    summary: "Delete inspection for current tenant",
    description: "Permanently remove an inspection record. (DELETE /{id}, inspections domain).",
    request: {
        params: z.object({
            id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
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
    operationId: "deleteInspection"
}, { scopes: ['write'], tier: 'primary' }));


/**
 * PATCH /api/inspections/:id
 */
const updateInspectionRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}',
    tags: ["inspections"],
    summary: "Patch inspection for current tenant",
    description: "Partially update an inspection record. (PATCH /{id}, inspections domain).",
    request: {
        params: z.object({
            id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe id field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: UpdateInspectionSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
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
    operationId: "patchInspection"
}, { scopes: ['write'], tier: 'primary' }));


/**
 * Round-2 backlog G1 (Spectora §E.2) — GET /api/inspections/:id/property-facts
 * Returns the six Property Facts columns for the strip + report banner.
 */
const getPropertyFactsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/property-facts',
    tags: ["inspections"],
    summary: "List inspection property facts",
    description: 'Returns the Property Facts strip payload (year built, sqft, foundation, lot, beds, baths).',
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: { 'application/json': { schema: PropertyFactsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Success',
        },
    },
    operationId: "listInspectionPropertyFacts"
}, { scopes: ['read'], tier: 'extended' }));


/**
 * Round-2 backlog G1 (Spectora §E.2) — PATCH /api/inspections/:id/property-facts
 * Inline-edit handler for the Property Facts card. Accepts a partial payload
 * so a single-field save round-trips without touching the other columns.
 */
const updatePropertyFactsRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}/property-facts',
    tags: ["inspections"],
    summary: "Patch inspection property fact",
    description: 'Patches the Property Facts strip. Omitted keys are unchanged; null clears a field.',
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: PropertyFactsSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: { 'application/json': { schema: PropertyFactsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Success',
        },
    },
    operationId: "patchInspectionPropertyFact"
}, { scopes: ['write'], tier: 'extended' }));


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
const autofillPropertyFactsRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/property-facts/autofill',
    tags: ["inspections"],
    summary: 'Auto-fill property facts from public records (Estated.io)',
    description: 'Returns mapped Property Facts payload or null + reason code. Inspector remains free to override fields manually after auto-fill.',
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: PropertyFactsAutofillRequestSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    middleware: [requireRole(['owner', 'admin'])],
    responses: {
        200: {
            content: { 'application/json': { schema: PropertyFactsAutofillResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Auto-fill result',
        },
    },
    operationId: "autofillInspection"
}, { scopes: ['write'], tier: 'extended' }));


/**
 * GET /api/inspections/:id/results
 */
const getResultsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/results',
    tags: ["inspections"],
    summary: "List inspection results for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ results: z.record(z.string(), z.unknown()).describe('TODO describe results field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listInspectionResults",
    description: "Auto-generated placeholder for listInspectionResults (GET /{id}/results, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));


/**
 * PATCH /api/inspections/:id/results
 */
const updateResultsRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}/results',
    tags: ["inspections"],
    summary: "Patch inspection result for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: PatchResultsSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
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
    operationId: "patchInspectionResult",
    description: "Auto-generated placeholder for patchInspectionResult (PATCH /{id}/results, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


/**
 * PATCH /api/inspections/:id/template-snapshot
 *
 * Feature #20 phase 1 — inline edits to the inspection's frozen template
 * structure. The inspector swaps rating system / adds / removes / renames
 * sections + items in the editor; we persist the whole next-state snapshot
 * here without touching the source template row. (Save-back-to-template
 * and save-as-new-template come in later phases.)
 */
const PatchTemplateSnapshotBodySchema = z.object({
    snapshot: TemplateSchemaV2Schema.describe('Full v2 template structure to overwrite the inspection snapshot with'),
});
const updateTemplateSnapshotRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}/template-snapshot',
    tags: ["inspections"],
    summary: 'Replace the per-inspection template snapshot',
    description: 'Replaces the templateSnapshot JSON wholesale. Validated against TemplateSchemaV2. Used by the inspection editor for inline structural edits (rating system swap, add/remove section/item).',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('Inspection ID') }),
        body: { content: { 'application/json': { schema: PatchTemplateSnapshotBodySchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Snapshot replaced' },
    },
    operationId: 'patchInspectionTemplateSnapshot',
}, { scopes: ['write'], tier: 'extended' }));


/**
 * POST /api/inspections/:id/switch-rating-system
 *
 * Feature #20 phase 2 — swaps the rating system on a per-inspection snapshot
 * with controlled handling of existing item ratings (severity-bucket remap
 * or clear). Also clears inspection_results.ratingSystemSnapshot so the new
 * system re-freezes on next write. Notes / photos / canned comments are
 * always preserved.
 */
const SwitchRatingSystemSchema = z.object({
    ratingSystemId: z.string().uuid(),
    mode:           z.enum(['remap', 'clear']).default('remap'),
});
const SwitchRatingSystemResultSchema = z.object({
    remapped: z.number(),
    cleared:  z.number(),
    total:    z.number(),
});
const switchRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/switch-rating-system',
    tags: ["inspections"],
    summary: 'Switch the rating system on the per-inspection snapshot',
    description: 'Swaps the per-inspection ratingSystem to the target system. mode="remap" maps existing item ratings by severity bucket; mode="clear" wipes them. Notes/photos/canned comments preserved. Clears the inspection_results.ratingSystemSnapshot freeze so the new system applies end-to-end.',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('Inspection ID') }),
        body: { content: { 'application/json': { schema: SwitchRatingSystemSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(SwitchRatingSystemResultSchema) } }, description: 'Rating system switched' },
    },
    operationId: 'switchInspectionRatingSystem',
}, { scopes: ['write'], tier: 'extended' }));


/**
 * GET /api/inspections/:id/recommendations
 * Flattens all attached recommendations across all items + computes totals.
 * Spec 3 report renderer will consume this to build the consolidated repair list.
 */
const aggregateRecommendationsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/recommendations',
    tags: ["inspections"],
    summary: 'Aggregate all attached recommendations + totals for repair list',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: AggregatedRecommendationsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Aggregated recommendations' },
    },
    operationId: "listInspectionRecommendations",
    description: "Auto-generated placeholder for listInspectionRecommendations (GET /{id}/recommendations, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));


/**
 * POST /api/inspections
 */
const createInspectionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/',
    tags: ["inspections"],
    summary: "Create inspection for current tenant",
    description: "Initialize a new inspection for a property. (POST /, inspections domain).",
    request: {
        body: {
            content: {
                'application/json': {
                    schema: CreateInspectionSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
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
                        inspection: InspectionSchema.describe('TODO describe inspection field for the OpenInspection MCP integration'),
                    })),
                },
            },
            description: 'Created',
        },
    },
    operationId: "createInspection"
}, { scopes: ['write'], tier: 'primary' }));


/**
 * POST /api/inspections/:id/clone
 */
const cloneInspectionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/clone',
    tags: ["inspections"],
    summary: "Clone inspection for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ inspection: InspectionSchema.describe('TODO describe inspection field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Created',
        },
    },
    operationId: "cloneInspection",
    description: "Auto-generated placeholder for cloneInspection (POST /{id}/clone, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


/**
 * Photo Upload
 *
 * Sprint 1 A-7: accepts optional `targetType` ('item' | 'defect') and
 * `customId` so a photo can be bound to a specific custom defect row
 * instead of the item as a whole. R2 upload + storage logic is unchanged;
 * the response echoes the target so the client can attach the key to the
 * right custom row.
 */
const uploadPhotoRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/upload',
    tags: ["inspections"],
    summary: "Upload inspection for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        file: z.unknown().openapi({ type: 'string', format: 'binary' }).describe('TODO describe file field for the OpenInspection MCP integration'),
                        itemId: z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
                        targetType: z.enum(['item', 'defect']).optional().describe('TODO describe targetType field for the OpenInspection MCP integration'),
                        customId: z.string().optional().describe('TODO describe customId field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
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
                        key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
                        targetType: z.enum(['item', 'defect']).describe('TODO describe targetType field for the OpenInspection MCP integration'),
                        itemId: z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
                        customId: z.string().nullable().describe('TODO describe customId field for the OpenInspection MCP integration'),
                    })),
                },
            },
            description: 'Success',
        },
    },
    operationId: "uploadInspection",
    description: "Auto-generated placeholder for uploadInspection (POST /{id}/upload, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


/* ── Round-2 backlog #9 (Spectora §E.3) — Media Center ─────────────────────
 *
 * Three endpoints powering the editor's centralized photo library drawer:
 *   GET  /api/inspections/:id/media          — aggregate {attached, pool}
 *   POST /api/inspections/:id/media/upload   — bulk upload to loose pool
 *   POST /api/inspections/:id/media/attach   — attach pool photo to an item
 *   DELETE /api/inspections/:id/media/pool/:poolId — discard pool photo
 */
const mediaCenterRoute = createRoute(withMcpMetadata({
    method: 'get',
    path:   '/{id}/media',
    tags: ["inspections"],
    summary: 'Media Center — all attached + pool photos',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(MediaCenterResponseSchema) } },
            description: 'Aggregated photos',
        },
    },
    operationId: "listInspectionMedia",
    description: "Auto-generated placeholder for listInspectionMedia (GET /{id}/media, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const mediaUploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/upload',
    tags: ["inspections"],
    summary: 'Upload a photo to the inspection media pool (loose, unattached)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        file:    z.unknown().openapi({ type: 'string', format: 'binary' }).describe('TODO describe file field for the OpenInspection MCP integration'),
                        // Optional EXIF take-time as epoch milliseconds — the
                        // client-side photo picker extracts this when the
                        // browser exposes File.lastModified or an EXIF parser
                        // is available.
                        takenAt: z.coerce.number().int().nonnegative().optional().describe('TODO describe takenAt field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
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
    operationId: "uploadInspection",
    description: "Auto-generated placeholder for uploadInspection (POST /{id}/media/upload, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const mediaAttachRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/attach',
    tags: ["inspections"],
    summary: 'Attach a pool photo to an inspection item',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: MediaAttachRequestSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(MediaAttachResponseSchema) } },
            description: 'Photo attached',
        },
    },
    operationId: "attachInspection",
    description: "Auto-generated placeholder for attachInspection (POST /{id}/media/attach, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const mediaPoolDeleteRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path:   '/{id}/media/pool/{poolId}',
    tags: ["inspections"],
    summary: 'Delete a pool photo (cancel an upload)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), poolId: z.string().min(1).describe('TODO describe poolId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Pool photo deleted',
        },
    },
    operationId: "deleteInspectionMediaPool",
    description: "Auto-generated placeholder for deleteInspectionMediaPool (DELETE /{id}/media/pool/{poolId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// Design System 0520 M14 — PhotoStudio annotation save (subsystem A, phase 4).
// Opaque JSON-encoded shape array (≤8 KB) + caption (≤200 chars). Tenant-
// isolated via ScopedDB; 404 on cross-tenant access (no enumeration leak).
const updateMediaAnnotationsRoute = createRoute(withMcpMetadata({
    method:     'put',
    path:       '/{id}/media/{mediaId}/annotations',
    tags: ["inspections"],
    summary:    'Save PhotoStudio annotation overlay + caption',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), mediaId: z.string().min(1).describe('TODO describe mediaId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: UpdateMediaAnnotationsSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Annotations saved',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({
                            id:          z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
                            annotations: z.string().nullable().describe('TODO describe annotations field for the OpenInspection MCP integration'),
                            caption:     z.string().nullable().describe('TODO describe caption field for the OpenInspection MCP integration'),
                            updatedAt:   z.number().describe('TODO describe updatedAt field for the OpenInspection MCP integration'),
                        }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
        },
        404: { description: 'Media not found in this tenant' },
    },
    operationId: "updateInspectionMediaAnnotation",
    description: "Auto-generated placeholder for updateInspectionMediaAnnotation (PUT /{id}/media/{mediaId}/annotations, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


/**
 * Report View (HTML) — REMOVED.
 * The React Router v7 frontend now handles report rendering via /report/:tenant/:id.
 * Use GET /api/inspections/:id/report-data for the JSON data endpoint.
 */

/**
 * GET /api/inspections/:id/full — Spec 4E
 * Returns combined { inspection, template, results } for offline prefetch.
 * Avoids 3 separate fetches per inspection (saves ~150 round-trips for 50 inspections).
 */

/**
 * GET /api/inspections/:id/sign-status (public — check if client already signed)
 */

/**
 * GET /api/inspections/:id/agreement (public — for report gatekeeper)
 * Returns the first active agreement for this tenant.
 */

/**
 * POST /api/inspections/:id/sign (public — client signature submission)
 */

/**
 * POST /api/inspections/:id/complete
 */
const completeInspectionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/complete',
    tags: ["inspections"],
    summary: "Complete inspection for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
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
    operationId: "completeInspection",
    description: "Auto-generated placeholder for completeInspection (POST /{id}/complete, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


const sendReportPdfRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/send-report-pdf',
    tags: ["inspections"],
    summary: 'Re-send the inspection report as a PDF email attachment',
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        // Optional override; defaults to inspection.clientEmail
                        toEmail: z.string().email().optional().describe('TODO describe toEmail field for the OpenInspection MCP integration'),
                    }).optional().describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ sentTo: z.string().describe('TODO describe sentTo field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'PDF email queued',
        },
        400: { description: 'Recipient missing' },
        404: { description: 'Inspection not found' },
        503: { description: 'PDF rendering unavailable; text-only email sent instead' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createInspectionSendReportPdf",
    description: "Auto-generated placeholder for createInspectionSendReportPdf (POST /{id}/send-report-pdf, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


/**
 * GET /api/inspections/:id/report-data
 */
const getReportDataRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/report-data',
    tags: ["inspections"],
    summary: 'Get structured report data',
    request: {
        params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
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
    operationId: "listInspectionReportData",
    description: "Auto-generated placeholder for listInspectionReportData (GET /{id}/report-data, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));


/**
 * GET /api/inspections/:id/publish-readiness
 *
 * Task 12 — pre-publish gate: reports which included defects are missing
 * required fields (location + trade). The frontend pre-publish modal
 * consumes this before allowing the inspector to publish the report.
 */
const publishReadinessRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/publish-readiness',
    tags: ['inspections'],
    summary: 'Check whether an inspection is ready to publish (required defect fields filled)',
    request: {
        params: z.object({ id: z.string().min(1) }),
    },
    responses: {
        200: {
            description: 'Readiness payload',
            content: {
                'application/json': {
                    schema: z.object({
                        ready: z.boolean(),
                        blockingDefects: z.array(z.object({
                            sectionId:        z.string(),
                            sectionTitle:     z.string(),
                            itemId:           z.string(),
                            itemLabel:        z.string(),
                            cannedId:         z.string(),
                            cannedTitle:      z.string(),
                            missing:          z.array(z.enum(['location', 'trade'])),
                            unresolvedTokens: z.array(z.string()),
                        })),
                    }),
                },
            },
        },
    },
    operationId: 'getInspectionPublishReadiness',
    description: 'Returns ready=true when every included defect on the inspection has location and trade filled. Blocking defects are listed with the specific missing fields.',
}, { scopes: ['read'], tier: 'extended' }));


/**
 * GET /api/inspections/:id/repair-list
 *
 * Track E1 (ITB §11, UC-ITB-07) — flat punch-list of every defect-rated
 * item across the inspection, suitable for handing to a contractor or
 * realtor. Authenticated route; the public viewer page hits the same
 * service via a server-side render at /inspections/:id/repair-list.
 */
const RepairListEntrySchema = z.object({
    sectionId:           z.string().describe('TODO describe sectionId field for the OpenInspection MCP integration'),
    sectionTitle:        z.string().describe('TODO describe sectionTitle field for the OpenInspection MCP integration'),
    itemId:              z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
    itemLabel:           z.string().describe('TODO describe itemLabel field for the OpenInspection MCP integration'),
    comment:             z.string().describe('TODO describe comment field for the OpenInspection MCP integration'),
    location:            z.string().nullable().describe('TODO describe location field for the OpenInspection MCP integration'),
    category:            z.enum(['safety', 'recommendation', 'maintenance']).describe('TODO describe category field for the OpenInspection MCP integration'),
    recommendationId:    z.string().nullable().describe('TODO describe recommendationId field for the OpenInspection MCP integration'),
    recommendationLabel: z.string().nullable().describe('TODO describe recommendationLabel field for the OpenInspection MCP integration'),
    estimateLow:         z.number().nullable().describe('TODO describe estimateLow field for the OpenInspection MCP integration'),
    estimateHigh:        z.number().nullable().describe('TODO describe estimateHigh field for the OpenInspection MCP integration'),
    photos:              z.array(z.object({ key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'), url: z.string().describe('TODO describe url field for the OpenInspection MCP integration') })).describe('TODO describe photos field for the OpenInspection MCP integration'),
    source:              z.enum(['canned', 'custom']).describe('TODO describe source field for the OpenInspection MCP integration'),
});
const RepairListResponseSchema = z.object({
    inspection: z.object({
        id:              z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
        propertyAddress: z.string().describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
        date:            z.string().nullable().describe('TODO describe date field for the OpenInspection MCP integration'),
        inspectorName:   z.string().nullable().describe('TODO describe inspectorName field for the OpenInspection MCP integration'),
    }).describe('TODO describe inspection field for the OpenInspection MCP integration'),
    defects: z.array(RepairListEntrySchema).describe('TODO describe defects field for the OpenInspection MCP integration'),
    totals: z.object({
        count:           z.number().describe('TODO describe count field for the OpenInspection MCP integration'),
        safety:          z.number().describe('TODO describe safety field for the OpenInspection MCP integration'),
        recommendation:  z.number().describe('TODO describe recommendation field for the OpenInspection MCP integration'),
        maintenance:     z.number().describe('TODO describe maintenance field for the OpenInspection MCP integration'),
        estimateLowSum:  z.number().describe('TODO describe estimateLowSum field for the OpenInspection MCP integration'),
        estimateHighSum: z.number().describe('TODO describe estimateHighSum field for the OpenInspection MCP integration'),
    }).describe('TODO describe totals field for the OpenInspection MCP integration'),
    showEstimates: z.boolean().describe('TODO describe showEstimates field for the OpenInspection MCP integration'),
});

const getRepairListRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/repair-list',
    tags: ["inspections"],
    summary: 'Get aggregated repair list (defects-only punch list)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(RepairListResponseSchema) } },
            description: 'Repair list',
        },
    },
    operationId: "listInspectionRepairList",
    description: "Auto-generated placeholder for listInspectionRepairList (GET /{id}/repair-list, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));


/**
 * POST /api/inspections/:id/confirm
 */

/**
 * POST /api/inspections/:id/cancel
 */

/**
 * POST /api/inspections/:id/uncancel
 */

/**
 * Round-2 F1 — GET /api/inspections/:id/recipients
 * Returns the multi-party list (client + buyer agent + listing agent) that
 * the Publish modal renders per-recipient Email/Text checkboxes against.
 */
const recipientsRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{id}/recipients',
    tags: ["inspections"],
    summary: 'List the recipients eligible for the Publish modal',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionRecipientsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Recipient list',
        },
    },
    operationId: "listInspectionRecipients",
    description: "Auto-generated placeholder for listInspectionRecipients (GET /{id}/recipients, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));


/**
 * Round-2 F3 — GET /api/inspections/:id/people
 * People-card payload (inspector + client + buyer/listing agents).
 */
const peopleRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{id}/people',
    tags: ["inspections"],
    summary: 'People card payload (inspector, client, agents)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionPeopleResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'People card',
        },
    },
    operationId: "listInspectionPeople",
    description: "Auto-generated placeholder for listInspectionPeople (GET /{id}/people, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));


/**
 * POST /api/inspections/:id/publish
 */
const publishRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/publish',
    tags: ["inspections"],
    summary: "Publish inspection for current tenant",
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: PublishInspectionSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ reportUrl: z.string().describe('TODO describe reportUrl field for the OpenInspection MCP integration'), status: z.string().describe('TODO describe status field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Published',
        },
    },
    operationId: "publishInspection",
    description: "Auto-generated placeholder for publishInspection (POST /{id}/publish, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


// ── Spec 5A.6 — POST /api/inspections/:id/pdf/refresh ──────────────────────────
// Re-enqueue Summary + Full PDF rendering. Inspector / admin only.
// Returns 202 with current status so the client can poll the same row via GET.

// ── Spec 5A.7 — GET /api/inspections/:id/pdf?type=summary|full ─────────────────
// Streams the PDF from R2. Returns 404 if record missing, 202 with status
// payload if PDF still rendering / failed (client polls). Auth: any caller
// with a tenant context (logged-in inspector or branding-resolved request);
// public-share-token support follows the existing /report/:id pattern.

// POST /api/inspections/:id/agent-token — generates a shareable agent view token

// ── Sprint 1 Sub-spec D Task 3 (D-3) — POST /api/inspections/:id/share-agent ────
// Generates a fresh 30-day agent view token and emails the link to the inspection's
// referring agent. Returns 400 if no agent is linked or the agent has no email on
// file. Used by the report viewer's Share dropdown ("Share with your agent").

// ── Phase T (T12): Photo annotation save ────────────────────────────────────────
const saveAnnotationRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/items/{itemId}/photos/{photoIndex}/annotation',
    tags: ["inspections"],
    summary: 'Save photo annotation (composite PNG + Konva nodes JSON)',
    request: {
        params: z.object({
            id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId: z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
            photoIndex: z.coerce.number().int().min(0).describe('TODO describe photoIndex field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        image: z.unknown().openapi({ type: 'string', format: 'binary' }).describe('TODO describe image field for the OpenInspection MCP integration'),
                        nodes: z.string().describe('TODO describe nodes field for the OpenInspection MCP integration'),
                        sectionId: z.string().optional().describe('Section ID for composite finding key'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ annotatedKey: z.string().describe('TODO describe annotatedKey field for the OpenInspection MCP integration') })) } },
            description: 'Annotation saved',
        },
    },
    operationId: "createInspectionItemsPhotosAnnotation",
    description: "Auto-generated placeholder for createInspectionItemsPhotosAnnotation (POST /{id}/items/{itemId}/photos/{photoIndex}/annotation, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


// -----------------------------------------------------------------------------
// Agent Accounts A3 — POST /api/inspections/:id/concierge/approve
// -----------------------------------------------------------------------------
// Inspector flips an awaiting_inspector concierge booking to awaiting_client.
// Service mints the magic-link + sends the client confirm email. Tenant scope
// is enforced via JWT-derived tenantId — never trust the URL for tenant.
const approveConciergeRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/concierge/approve',
    tags: ["inspections"],
    summary: 'Approve a concierge booking awaiting inspector review',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Approved',
        },
        404: { description: 'Inspection not found in this tenant' },
        409: { description: 'Inspection is not in awaiting_inspector state' },
    },
    operationId: "approveInspection",
    description: "Auto-generated placeholder for approveInspection (POST /{id}/concierge/approve, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Design System 0520 subsystem B phase 5 task 5.3 — NewInspectionWizard create.
// -----------------------------------------------------------------------------
// Sibling endpoint to POST /api/inspections (the legacy single-step create).
// 4-step wizard payload validated by CreateInspectionFromWizardSchema.
// Returns the new inspection id so the wizard factory redirects to
// /inspections/:id/edit on success.
const createFromWizardRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/wizard',
    tags: ["inspections"],
    summary:    'Create an inspection from the 4-step NewInspectionWizard',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        body: { content: { 'application/json': { schema: CreateInspectionFromWizardSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            description: 'Created',
            content: { 'application/json': { schema: z.object({
                success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                data:    z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
            }) } },
        },
        400: { description: 'Validation error' },
    },
    operationId: "createInspectionWizard",
    description: "Auto-generated placeholder for createInspectionWizard (POST /wizard, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


// -----------------------------------------------------------------------------
// Design System 0520 subsystem B phase 3 task 3.4 — field-version PATCH item.
// -----------------------------------------------------------------------------
// Optimistic concurrency on individual item fields. Body carries the
// expectedVersion the client thinks it has; server returns 200 + newVersion
// on match, 409 + current/yours on stale write. The ConflictModal
// (phase 3 task 3.6) consumes the 409 payload.
const patchItemFieldRoute = createRoute(withMcpMetadata({
    method:     'patch',
    path:       '/{id}/items/{itemId}',
    tags: ["inspections"],
    summary:    'Patch a single item field with optimistic-concurrency version check',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), itemId: z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: PatchItemFieldSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            description: 'ok',
            content: { 'application/json': { schema: z.object({
                success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                data:    z.object({ newVersion: z.number().describe('TODO describe newVersion field for the OpenInspection MCP integration'), by: z.string().describe('TODO describe by field for the OpenInspection MCP integration'), at: z.number().describe('TODO describe at field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
            }) } },
        },
        404: { description: 'Inspection or item not found in this tenant' },
        409: { description: 'expectedVersion stale — body contains current/yours' },
    },
    operationId: "patchInspectionItem",
    description: "Auto-generated placeholder for patchInspectionItem (PATCH /{id}/items/{itemId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


// -----------------------------------------------------------------------------
// Design System 0520 subsystem B phase 2 task 2.5 — presence WebSocket upgrade.
// -----------------------------------------------------------------------------
// Verifies the caller has edit access to the inspection, then forwards the
// upgrade request to InspectionPresenceDO with user identity stamped in
// headers. The DO consumes these headers verbatim — the worker is the
// trust boundary.
//
// 404 (not 403) on tenant mismatch — no inspection-existence enumeration leak.
// 501 when the binding is absent (standalone deployments may opt out of
// presence to skip the Durable Objects line on their bill).

// Design System 0520 subsystem E P1.3 — Publish pre-flight gates.
const preflightRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{id}/preflight',
    tags: ["inspections"],
    summary: 'Compute Publish pre-flight gates (rated / facts / cover / agreement)',
    request: { params: z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { description: 'ok' },
        404: { description: 'inspection not found in this tenant' },
    },
    operationId: "listInspectionPreflight",
    description: "Auto-generated placeholder for listInspectionPreflight (GET /{id}/preflight, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Design System 0520 subsystem D phase 1 task 1.3 — UnitTree CRUD routes.
// -----------------------------------------------------------------------------
// Building / Floor / Unit hierarchy under each inspection. Backend
// validation in UnitService (depth ≤ 3, sibling-name uniqueness, cycle
// detection on move). Routes guard with the standard inspector role.

const createUnitRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/units',
    tags: ["inspections"],
    summary:    'Create a unit (Building / Floor / Unit) under an inspection',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: CreateUnitSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { description: 'created', content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } } },
        400: { description: 'validation / depth / duplicate-name' },
    },
    operationId: "createInspectionUnits",
    description: "Auto-generated placeholder for createInspectionUnits (POST /{id}/units, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const listUnitsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/units',
    tags: ["inspections"],
    summary:    'List units for an inspection (flat — client builds tree)',
    middleware: [requireRole(['owner', 'admin', 'inspector', 'agent'])] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  {
        200: { description: 'ok' },
    },
    operationId: "listInspectionUnits",
    description: "Auto-generated placeholder for listInspectionUnits (GET /{id}/units, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const updateUnitRoute = createRoute(withMcpMetadata({
    method:     'patch',
    path:       '/{id}/units/{unitId}',
    tags: ["inspections"],
    summary:    'Rename or re-sort a unit',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), unitId: z.string().min(1).describe('TODO describe unitId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateUnitSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    operationId: "patchInspectionUnit",
    description: "Auto-generated placeholder for patchInspectionUnit (PATCH /{id}/units/{unitId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const deleteUnitRoute = createRoute(withMcpMetadata({
    method:     'delete',
    path:       '/{id}/units/{unitId}',
    tags: ["inspections"],
    summary:    'Delete a unit (cascades to children)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), unitId: z.string().min(1).describe('TODO describe unitId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    operationId: "deleteInspectionUnit",
    description: "Auto-generated placeholder for deleteInspectionUnit (DELETE /{id}/units/{unitId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const moveUnitRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/units/{unitId}/move',
    tags: ["inspections"],
    summary:    'Reparent + reorder atomically (cycle-detected)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), unitId: z.string().min(1).describe('TODO describe unitId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: MoveUnitSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
        400: { description: 'cycle detected' },
    },
    operationId: "createInspectionUnitsMove",
    description: "Auto-generated placeholder for createInspectionUnitsMove (POST /{id}/units/{unitId}/move, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Design System 0520 subsystem D phase 4 task 4.3 — ObserverLink routes.
// -----------------------------------------------------------------------------
// Mint / list / revoke for the no-account read-only viewer flow. The
// anonymous /observe/:token claim handler is mounted at the top level
// in server/index.ts because it does not sit under /api/inspections/:id.

const mintObserverLinkRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/observer-links',
    tags: ["inspections"],
    summary:    'Mint a no-account read-only viewer link',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: z.object({
            durationSeconds: z.number().int().min(60).max(30 * 86400).optional().describe('TODO describe durationSeconds field for the OpenInspection MCP integration'),
        }).describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: { 200: { description: 'ok' } },
    operationId: "createInspectionObserverLinks",
    description: "Auto-generated placeholder for createInspectionObserverLinks (POST /{id}/observer-links, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const listObserverLinksRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/observer-links',
    tags: ["inspections"],
    summary:    'List active observer links for an inspection',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok' } },
    operationId: "listInspectionObserverLinks",
    description: "Auto-generated placeholder for listInspectionObserverLinks (GET /{id}/observer-links, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const revokeObserverLinkRoute = createRoute(withMcpMetadata({
    method:     'delete',
    path:       '/{id}/observer-links/{linkId}',
    tags: ["inspections"],
    summary:    'Revoke an observer link',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), linkId: z.string().min(1).describe('TODO describe linkId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    operationId: "deleteInspectionObserverLink",
    description: "Auto-generated placeholder for deleteInspectionObserverLink (DELETE /{id}/observer-links/{linkId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Design System 0520 subsystem D phase 7 task 7.3 — ReportVersions routes.
// -----------------------------------------------------------------------------
// List + get-snapshot + diff. snapshotOnPublish is invoked from the
// existing publish flow as part of subsystem D P9 (Republish UX, separate
// commit) — only the read APIs land here.

const listVersionsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions',
    tags: ["inspections"],
    summary:    'List published versions for an inspection',
    middleware: [requireRole(['owner', 'admin', 'inspector', 'agent'])] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok' } },
    operationId: "listInspectionVersions",
    description: "Auto-generated placeholder for listInspectionVersions (GET /{id}/versions, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const getVersionRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions/{n}',
    tags: ["inspections"],
    summary:    'Get full snapshot for a specific version',
    middleware: [requireRole(['owner', 'admin', 'inspector', 'agent'])] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), n: z.string().regex(/^\d+$/).describe('TODO describe n field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok' }, 404: { description: 'not found' } },
    operationId: "getInspectionVersion",
    description: "Auto-generated placeholder for getInspectionVersion (GET /{id}/versions/{n}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const diffVersionRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions/{n}/diff',
    tags: ["inspections"],
    summary:    'Diff version :n against ?from=<version>',
    middleware: [requireRole(['owner', 'admin', 'inspector', 'agent'])] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), n: z.string().regex(/^\d+$/).describe('TODO describe n field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        query:  z.object({ from: z.string().regex(/^\d+$/).describe('TODO describe from field for the OpenInspection MCP integration') }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: { 200: { description: 'ok' }, 404: { description: 'one of the versions not found' } },
    operationId: "listInspectionVersionsDiff",
    description: "Auto-generated placeholder for listInspectionVersionsDiff (GET /{id}/versions/{n}/diff, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Typed-Hono dead-routes cleanup Task 10 — vectorised result patches.
// -----------------------------------------------------------------------------
// POST /{id}/results/batch — accepts an array of `{ itemId, sectionId, field,
// value }` patches and folds them into inspection_results.data in one
// round-trip. See inspection-results.service for the upsert semantics.
const resultsBatchRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/results/batch',
    tags:       ['inspections'],
    summary:    'Apply a batch of result patches to an inspection in one round-trip',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection id whose results are patched') }),
        body:   { content: { 'application/json': { schema: ResultsBatchSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ResultsBatchResponseSchema } },
            description: 'Batch applied',
        },
        404: { description: 'Inspection not found in this tenant' },
    },
    operationId: 'batchPatchInspectionResults',
    description: 'Folds an array of { itemId, sectionId, field, value } patches into inspection_results.data using the same composite findingKey the single-field PATCH uses.',
}, { scopes: ['write'], tier: 'extended' }));

// Tasks 12-14 — sync conflict adjudication. GET lists the pending field-level
// conflicts persisted by inspection-sync.ts at merge time; POST clears them
// once the inspector has chosen a winning side.
const listConflictsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/conflicts',
    tags:       ['inspections'],
    summary:    'List pending sync conflicts for an inspection',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection id whose conflicts are listed') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ConflictListResponseSchema } },
            description: 'Pending conflicts (empty array when none)',
        },
        404: { description: 'Inspection not found in this tenant' },
    },
    operationId: 'listInspectionConflicts',
    description: 'Returns the field-level merge conflicts the sync endpoint persisted, so the conflict-resolver UI can adjudicate them out-of-band from the transient 409.',
}, { scopes: ['read'], tier: 'extended' }));

const resolveConflictsRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/conflicts/resolve',
    tags:       ['inspections'],
    summary:    'Clear sync conflicts the inspector has adjudicated',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection id whose conflicts are resolved') }),
        body:   { content: { 'application/json': { schema: ConflictResolveSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ConflictResolveResponseSchema } },
            description: 'Resolved',
        },
        404: { description: 'Inspection not found in this tenant' },
    },
    operationId: 'resolveInspectionConflicts',
    description: 'Deletes the pending conflict rows matching each { itemId, field } resolution. The winning side was already written on the prior sync; clearing the flag is the resolution.',
}, { scopes: ['write'], tier: 'extended' }));


export const inspectionsRoutes = createApiRouter()
    .openapi(dashboardRoute, async (c) => {
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
    })
    .openapi(listInspectionsRoute, async (c) => {
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
    })
    .openapi(listTemplatesRoute, async (c) => {
        const q = c.req.valid('query');
        const service = c.var.services.template;
        const { rows, total } = await service.listTemplates(c.get('tenantId'), q);
        return c.json({
            success: true,
            data: rows,
            meta: buildMeta({ total, page: q.page, pageSize: q.pageSize }),
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
        return c.json({ success: true, data: { template } }, 201);
    })
    .openapi(importSpectoraRoute, async (c) => {
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
    })
    .openapi(updateTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const service = c.var.services.template;
        const template = await service.updateTemplate(id, c.get('tenantId'), body.name, body.schema);
        return c.json({ success: true, data: { template } }, 200);
    })
    .openapi(deleteTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.template;
        await service.deleteTemplate(id, c.get('tenantId'));
        return c.json({ success: true }, 200);
    })
    .openapi(listInspectorsRoute, async (c) => {
        const service = c.var.services.admin;
        const { members } = await service.getMembers(c.get('tenantId'));
        return c.json({ success: true, data: members }, 200);
    })
    .openapi(bulkUpdateRoute, async (c) => {
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
    })
    .openapi(getCountsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const counts = await c.var.services.inspection.getCounts(tenantId);
        return c.json({ success: true, data: counts });
    })
    .openapi(getInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const result = await service.getInspection(id, c.get('tenantId'));
        return c.json({
            success: true,
            data: result
        }, 200);
    })
    .openapi(deleteInspectionRoute, async (c) => {
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
        return c.json({ success: true }, 200);
    })
    .openapi(updateInspectionRoute, async (c) => {
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
        return c.json({ success: true }, 200);
    })
    .openapi(getPropertyFactsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const facts = await c.var.services.inspection.getPropertyFacts(id, tenantId);
        return c.json({ success: true, data: facts }, 200);
    })
    .openapi(updatePropertyFactsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const facts = await c.var.services.inspection.updatePropertyFacts(id, tenantId, body);
        auditFromContext(c, 'inspection.property_facts.update', 'inspection', {
            entityId: id,
            metadata: { fields: Object.keys(body) },
        });
        return c.json({ success: true, data: facts }, 200);
    })
    .openapi(autofillPropertyFactsRoute, async (c) => {
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
    })
    .openapi(getResultsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const db = drizzle(c.env.DB);
        await c.var.services.inspection.getInspection(id, c.get('tenantId'));
        const results = await db.select().from(inspectionResults).where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, c.get('tenantId')))).get();
        return c.json({ success: true, data: { results: (results?.data || {}) } }, 200);
    })
    .openapi(updateResultsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { data } = c.req.valid('json');
        const service = c.var.services.inspection;
        await service.updateResults(id, c.get('tenantId'), data);
        return c.json({ success: true }, 200);
    })
    .openapi(updateTemplateSnapshotRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { snapshot } = c.req.valid('json');
        await c.var.services.inspection.updateTemplateSnapshot(id, c.get('tenantId'), snapshot);
        auditFromContext(c, 'inspection.template_snapshot.update', 'inspection', {
            entityId: id,
            metadata: { sectionCount: snapshot.sections?.length ?? 0 },
        });
        return c.json({ success: true }, 200);
    })
    .openapi(switchRatingSystemRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { ratingSystemId, mode } = c.req.valid('json');
        const stats = await c.var.services.inspection.switchRatingSystem(id, c.get('tenantId'), ratingSystemId, mode);
        auditFromContext(c, 'inspection.rating_system.switch', 'inspection', {
            entityId: id,
            metadata: { ratingSystemId, mode, ...stats },
        });
        return c.json({ success: true, data: stats }, 200);
    })
    .openapi(aggregateRecommendationsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
         
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
    })
    .openapi(createInspectionRoute, async (c) => {
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
    })
    .openapi(cloneInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const clone = await service.cloneInspection(id, c.get('tenantId'));

        auditFromContext(c, 'inspection.create', 'inspection', {
            entityId: clone.id,
            metadata: { clonedFrom: id, propertyAddress: clone.propertyAddress },
        });
        return c.json({ success: true, data: { inspection: clone } }, 201);
    })
    .openapi(uploadPhotoRoute, async (c) => {
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
        return c.json({ success: true, data: { key, targetType, itemId, customId } }, 200);
    })
    .openapi(mediaCenterRoute, async (c) => {
        const { id } = c.req.valid('param');
        const data = await c.var.services.inspection.getMediaCenter(id, c.get('tenantId'));
        return c.json({ success: true, data }, 200);
    })
    .openapi(mediaUploadRoute, async (c) => {
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
    })
    .openapi(mediaAttachRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { poolId, itemId, sectionId } = c.req.valid('json');
        const result = await c.var.services.inspection.attachPoolPhoto(id, c.get('tenantId'), poolId, itemId, sectionId);
        auditFromContext(c, 'inspection.media.attach', 'inspection', {
            entityId: id,
            metadata: { poolId, itemId, sectionId },
        });
        return c.json({ success: true, data: result }, 200);
    })
    .openapi(mediaPoolDeleteRoute, async (c) => {
        const { id, poolId } = c.req.valid('param');
        await c.var.services.inspection.deletePoolPhoto(id, c.get('tenantId'), poolId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(updateMediaAnnotationsRoute, async (c) => {
        const { id, mediaId } = c.req.valid('param');
        const { annotations, caption } = c.req.valid('json');

        const out = await c.var.services.inspection.updateMediaAnnotations(
            id,
            mediaId,
            c.get('tenantId'),
            annotations,
            caption,
        );

        if (!out) {
            throw Errors.NotFound('Media not found');
        }

        return c.json({ success: true as const, data: out }, 200);
    })
    .openapi(completeInspectionRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const service = c.var.services.inspection;
        const { inspection } = await service.getInspection(id, tenantId);

        // Idempotency: if already completed, short-circuit to prevent accidental
        // email storms when the client retries on network errors or double-clicks.
        if (inspection.status === 'completed' || inspection.status === 'delivered') {
            return c.json({ success: true }, 200);
        }

        const db = drizzle(c.env.DB);
        await db.update(inspectionTable).set({ status: 'completed' }).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));

        if (inspection.clientEmail) {
            const tenantSlug = c.get('requestedSubdomain') ?? '';
            const reportUrl = buildReportUrl(getBookingHost(c), tenantSlug, id);
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
        return c.json({ success: true }, 200);
    })
    .openapi(sendReportPdfRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json') ?? {};
        const service = c.var.services.inspection;
        const { inspection } = await service.getInspection(id, tenantId);

        const recipient = body.toEmail || inspection.clientEmail;
        if (!recipient) {
            throw Errors.BadRequest('No recipient email — set inspection.clientEmail or pass toEmail.');
        }

        const tenantSlug = c.get('requestedSubdomain') ?? '';
        const reportUrl = buildReportUrl(getBookingHost(c), tenantSlug, id);
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
    })
    .openapi(getReportDataRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const data = await service.getReportData(id, tenantId);
        return c.json({ success: true, data }, 200);
    })
    .openapi(publishReadinessRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const service = c.var.services.inspection;
        const readiness = await service.computePublishReadiness(id, tenantId);
        return c.json(readiness, 200);
    })
    .openapi(getRepairListRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const data = await c.var.services.inspection.getRepairList(id, tenantId);
        return c.json({ success: true, data }, 200);
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/confirm',
        tags: ["inspections"], summary: "Confirm inspection for current tenant",
        middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Confirmed' } },
        operationId: "confirmInspection",
        description: "Auto-generated placeholder for confirmInspection (POST /{id}/confirm, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        await c.var.services.inspection.confirmInspection(tenantId, id);
        return c.json({ success: true });
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/cancel',
        tags: ["inspections"], summary: "Cancel inspection for current tenant",
        middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
        request: {
            params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
            body: { content: { 'application/json': { schema: CancelInspectionSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
        },
        responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Cancelled' } },
        operationId: "cancelInspection",
        description: "Auto-generated placeholder for cancelInspection (POST /{id}/cancel, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const { reason, notes } = c.req.valid('json');
        await c.var.services.inspection.cancelInspection(tenantId, id, reason, notes);
        return c.json({ success: true });
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/uncancel',
        tags: ["inspections"], summary: "Create inspection uncancel for current tenant",
        middleware: [requireRole(['owner', 'admin'])] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Uncancelled' } },
        operationId: "createInspectionUncancel",
        description: "Auto-generated placeholder for createInspectionUncancel (POST /{id}/uncancel, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        await c.var.services.inspection.uncancelInspection(tenantId, id);
        return c.json({ success: true });
    })
    .openapi(recipientsRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id }   = c.req.valid('param');
        const list     = await c.var.services.inspection.getRecipientList(id, tenantId);
        return c.json({ success: true, data: list }, 200);
    })
    .openapi(peopleRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id }   = c.req.valid('param');
        const card     = await c.var.services.inspection.getPeopleCard(id, tenantId);
        return c.json({ success: true, data: card }, 200);
    })
    .openapi(publishRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const service = c.var.services.inspection;
        const result = await service.publishInspection(id, tenantId, body);

        // Design System 0520 subsystem D phase 9 — Republish snapshot.
        // After the inspection's status flips to published, persist a frozen
        // snapshot into report_versions so the customer-facing viewer can
        // browse history + diff. Best-effort: failures log but do NOT block
        // the publish response. snapshot-too-large (> 1 MB) downgrades to a
        // warning audit entry rather than a 5xx — the report itself remains
        // viewable through the existing /reports/:id path.
        const userId = (c.get('user') as { sub?: string } | undefined)?.sub;
        if (userId) {
            try {
                const out = await c.var.services.reportVersion.snapshotOnPublish(
                    tenantId, id, userId, body.summary,
                );
                logger.info('report-version snapshot saved', {
                    inspectionId:  id,
                    versionNumber: out.versionNumber,
                });
            } catch (err) {
                logger.warn('report-version snapshot failed (non-fatal)', {
                    inspectionId: id,
                    error:        err instanceof Error ? err.message : String(err),
                });
            }
        }

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
            const tenantSlug = c.get('requestedSubdomain') ?? '';
            const reportUrl = buildReportUrl(getBookingHost(c), tenantSlug, id);
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
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/pdf/refresh',
        tags: ["inspections"],
        summary: 'Refresh PDF renders (Summary + Full)',
        middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: {
            202: {
                content: { 'application/json': { schema: createApiResponseSchema(z.object({
                    status: z.string().describe('TODO describe status field for the OpenInspection MCP integration'),
                    summary: z.string().describe('TODO describe summary field for the OpenInspection MCP integration'),
                    full: z.string().describe('TODO describe full field for the OpenInspection MCP integration'),
                })) } },
                description: 'PDF renders enqueued',
            },
        },
        operationId: "refreshInspection",
        description: "Auto-generated placeholder for refreshInspection (POST /{id}/pdf/refresh, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const reportPdf = c.var.services.reportPdf;
        if (!(await reportPdf.isPipelineEnabled(tenantId))) {
            throw Errors.Forbidden('PDF pipeline is disabled for this workspace. Enable it in Settings → Reports.');
        }
        const tenantSlug = c.get('requestedSubdomain') ?? '';
        const reportUrl = buildReportUrl(getBookingHost(c), tenantSlug, id);
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
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'get', path: '/{id}/pdf',
        tags: ["inspections"],
        summary: 'Download report PDF (Summary or Full)',
        request: {
            params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
            query: z.object({ type: z.enum(['summary', 'full']).default('full').describe('TODO describe type field for the OpenInspection MCP integration') }).describe('TODO describe query field for the OpenInspection MCP integration'),
        },
        responses: {
            200: {
                content: { 'application/pdf': { schema: z.any().describe('TODO describe schema field for the OpenInspection MCP integration') } },
                description: 'PDF bytes',
            },
            202: {
                content: { 'application/json': { schema: createApiResponseSchema(z.object({
                    status: z.string().describe('TODO describe status field for the OpenInspection MCP integration'),
                    error: z.string().nullable().optional().describe('TODO describe error field for the OpenInspection MCP integration'),
                })) } },
                description: 'PDF still rendering',
            },
        },
        operationId: "listInspectionPdf",
        description: "Auto-generated placeholder for listInspectionPdf (GET /{id}/pdf, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['read'], tier: 'extended' })), async (c) => {
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
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/agent-token',
        tags: ["inspections"],
        summary: 'Generate shareable agent view token',
        middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: {
            200: {
                content: { 'application/json': { schema: createApiResponseSchema(z.object({ token: z.string().describe('TODO describe token field for the OpenInspection MCP integration'), url: z.string().describe('TODO describe url field for the OpenInspection MCP integration') })) } },
                description: 'Agent view token and URL',
            },
        },
        operationId: "createInspectionAgentToken",
        description: "Auto-generated placeholder for createInspectionAgentToken (POST /{id}/agent-token, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const token = await c.var.services.inspection.generateAgentViewToken(tenantId, id);
        const tenantSlug = c.get('requestedSubdomain') ?? '';
        const url = `${buildReportUrl(getBookingHost(c), tenantSlug, id)}?view=agent&token=${token}`;
        return c.json({ success: true, data: { token, url } });
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/share-agent',
        tags: ["inspections"],
        summary: 'Email the report share link to the linked agent',
        middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
        request: { params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
        responses: {
            200: {
                content: { 'application/json': { schema: createApiResponseSchema(z.object({ sentTo: z.string().describe('TODO describe sentTo field for the OpenInspection MCP integration') })) } },
                description: 'Share link emailed to agent',
            },
        },
        operationId: "createInspectionShareAgent",
        description: "Auto-generated placeholder for createInspectionShareAgent (POST /{id}/share-agent, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['write'], tier: 'extended' })), async (c) => {
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
        const tenantSlug = c.get('requestedSubdomain') ?? '';
        const url = `${buildReportUrl(getBookingHost(c), tenantSlug, id)}?view=agent&token=${token}`;

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
    })
    .openapi(saveAnnotationRoute, async (c) => {
        const { id, itemId, photoIndex } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const formData = await c.req.parseBody();
        const file = formData['image'] as File | undefined;
        const nodesJson = String(formData['nodes'] ?? '[]');
        const sectionId = typeof formData['sectionId'] === 'string' && formData['sectionId'].length > 0
            ? formData['sectionId']
            : undefined;
        if (!file) throw Errors.BadRequest('image file required');
        const bytes = await file.arrayBuffer();
        const result = await c.var.services.inspection.saveAnnotation(
            id, tenantId, itemId, photoIndex, bytes, nodesJson, sectionId,
        );
        return c.json({ success: true, data: result }, 200);
    })
    .openapi(approveConciergeRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        await c.var.services.concierge.approveByInspector(id, tenantId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(createFromWizardRoute, async (c) => {
        const input    = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!userId) throw Errors.Unauthorized('Missing user identity');

        const out = await c.var.services.inspection.createFromWizard(tenantId, userId, input);
        return c.json({ success: true as const, data: out }, 200);
    })
    .openapi(patchItemFieldRoute, async (c) => {
        const { id, itemId } = c.req.valid('param');
        const { field, value, expectedVersion, force, sectionId } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!userId) throw Errors.Unauthorized('Missing user identity');

        const out = await c.var.services.inspection.patchItem(
            id, tenantId, itemId, field, value, expectedVersion, userId, { force: force ?? false }, sectionId,
        );

        if (out.kind === 'not_found') {
            throw Errors.NotFound('Inspection not found');
        }
        if (out.kind === 'conflict') {
            return c.json({ success: false as const, error: { code: 'CONFLICT', current: out.current, yours: out.yours } }, 409);
        }
        // Design System 0520 subsystem C phase 2 — apprentice writes get queued.
        // Returns 200 + { kind: 'queued', reviewId } so the editor can update
        // its UI to "Pending review" without retrying.
        if (out.kind === 'queued') {
            return c.json({ success: true as const, data: { kind: 'queued', reviewId: out.reviewId } }, 200);
        }
        return c.json({ success: true as const, data: { kind: 'ok', newVersion: out.newVersion, by: out.by, at: out.at } }, 200);
    })
    .openapi(preflightRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const out = await c.var.services.inspection.computePreflight(id, tenantId);
        return c.json({ success: true as const, data: out }, 200);
    })
    .openapi(createUnitRoute, async (c) => {
        const { id }      = c.req.valid('param');
        const input       = c.req.valid('json');
        const tenantId    = c.get('tenantId');
        try {
            const out = await c.var.services.unit.create(tenantId, { inspectionId: id, ...input });
            return c.json({ success: true as const, data: out }, 200);
        } catch (err) {
            throw Errors.BadRequest((err as Error).message);
        }
    })
    .openapi(listUnitsRoute, async (c) => {
        const { id }   = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const units    = await c.var.services.unit.list(tenantId, id);
        return c.json({ success: true as const, data: { units } }, 200);
    })
    .openapi(updateUnitRoute, async (c) => {
        const { unitId } = c.req.valid('param');
        const patch      = c.req.valid('json');
        await c.var.services.unit.update(c.get('tenantId'), unitId, patch);
        return c.json({ success: true as const }, 200);
    })
    .openapi(deleteUnitRoute, async (c) => {
        const { unitId } = c.req.valid('param');
        await c.var.services.unit.delete(c.get('tenantId'), unitId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(moveUnitRoute, async (c) => {
        const { unitId } = c.req.valid('param');
        const { newParentUnitId, newSortOrder } = c.req.valid('json');
        try {
            await c.var.services.unit.move(c.get('tenantId'), unitId, newParentUnitId, newSortOrder);
            return c.json({ success: true as const }, 200);
        } catch (err) {
            throw Errors.BadRequest((err as Error).message);
        }
    })
    .openapi(mintObserverLinkRoute, async (c) => {
        const { id }   = c.req.valid('param');
        const { durationSeconds } = c.req.valid('json');
        const createdBy = (c.get('user') as { sub?: string } | undefined)?.sub;
        if (!createdBy) throw Errors.Unauthorized('Missing user identity');

        const out = await c.var.services.observerLink.mint(c.get('tenantId'), {
            inspectionId: id,
            createdBy,
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        });

        // Augment the bare service output with a fully-qualified claim URL
        // so the InspectorToolsDock modal can render a copy-and-paste field
        // without re-deriving the host or token path on the client.
        const baseUrl = c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`;
        const url     = `${baseUrl}/observe/${out.token}`;
        return c.json({ success: true as const, data: { ...out, url } }, 200);
    })
    .openapi(listObserverLinksRoute, async (c) => {
        const { id } = c.req.valid('param');
        const links  = await c.var.services.observerLink.list(c.get('tenantId'), id);
        return c.json({ success: true as const, data: { links } }, 200);
    })
    .openapi(revokeObserverLinkRoute, async (c) => {
        const { linkId } = c.req.valid('param');
        await c.var.services.observerLink.revoke(c.get('tenantId'), linkId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(listVersionsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const versions = await c.var.services.reportVersion.list(c.get('tenantId'), id);
        return c.json({ success: true as const, data: { versions } }, 200);
    })
    .openapi(getVersionRoute, async (c) => {
        const { id, n } = c.req.valid('param');
        const snap = await c.var.services.reportVersion.get(c.get('tenantId'), id, parseInt(n, 10));
        if (!snap) throw Errors.NotFound('Version not found');
        return c.json({ success: true as const, data: snap }, 200);
    })
    .openapi(diffVersionRoute, async (c) => {
        const { id, n } = c.req.valid('param');
        const { from }  = c.req.valid('query');
        const diff = await c.var.services.reportVersion.diff(
            c.get('tenantId'), id, parseInt(from, 10), parseInt(n, 10),
        );
        if (!diff) throw Errors.NotFound('Version diff not available');
        return c.json({ success: true as const, data: diff }, 200);
    })
    // Typed-Hono dead-routes cleanup Task 10 — vectorised result patches.
    .openapi(resultsBatchRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { patches } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!userId) throw Errors.Unauthorized('Missing user identity');

        // Ownership guard mirrors the single-field PATCH — 404 on tenant
        // mismatch keeps the existence-enumeration leak closed.
        try {
            await c.var.services.inspection.getInspection(id, tenantId);
        } catch {
            throw Errors.NotFound('Inspection not found');
        }

        const db = drizzle(c.env.DB);
        const data = await applyResultsBatch(db, id, patches, { tenantId, userId });
        auditFromContext(c, 'inspection.results_batch_patched', 'inspection', {
            entityId: id, metadata: { applied: data.applied, by: userId },
        });
        return c.json({ success: true as const, data }, 200);
    })
    // Typed-Hono dead-routes cleanup Task 12 — list persisted sync conflicts.
    .openapi(listConflictsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');

        // Ownership guard — 404 on tenant mismatch keeps the enumeration leak closed.
        try {
            await c.var.services.inspection.getInspection(id, tenantId);
        } catch {
            throw Errors.NotFound('Inspection not found');
        }

        const db = drizzle(c.env.DB);
        const data = await listPendingConflicts(db, id);
        return c.json({ success: true as const, data }, 200);
    })
    // Typed-Hono dead-routes cleanup Task 13 — clear adjudicated conflicts.
    .openapi(resolveConflictsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { resolutions } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!userId) throw Errors.Unauthorized('Missing user identity');

        try {
            await c.var.services.inspection.getInspection(id, tenantId);
        } catch {
            throw Errors.NotFound('Inspection not found');
        }

        const db = drizzle(c.env.DB);
        const data = await resolveConflicts(db, id, resolutions);
        auditFromContext(c, 'inspection.conflicts_resolved', 'inspection', {
            entityId: id, metadata: { resolved: data.resolved, by: userId },
        });
        return c.json({ success: true as const, data }, 200);
    })
    .get('/:id/report', async (c) => {
        return c.json({
            success: false,
            error: {
                code: 'MOVED',
                message: 'HTML report rendering has moved to the React Router v7 frontend. Use GET /api/inspections/:id/report-data for JSON data.',
            },
        }, 410);
    })
    .get('/:id/full', requireRole(['owner', 'admin', 'inspector']), async (c) => {
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
                return c.json({ success: false, error: { code: 'not_found', message: 'Inspection not found' } }, 404);
            }
            throw err;
        }
    })
    .get('/:id/sign-status', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

        const existing = await db.select().from(inspectionAgreements)
            .where(and(eq(inspectionAgreements.inspectionId, id), eq(inspectionAgreements.tenantId, tenantId))).get();

        return c.json({ success: true, data: { signed: !!existing } }, 200);
    })
    .get('/:id/agreement', async (c) => {
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
    })
    .post('/:id/sign', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

        // Verify inspection exists
        const inspection = await db.select().from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const raw = await c.req.json();
        const parsed = z.object({ signatureBase64: z.string().min(1).describe('TODO describe signatureBase64 field for the OpenInspection MCP integration') }).safeParse(raw);
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
    })
    .get('/:id/presence/ws', async (c) => {
        if (c.req.header('Upgrade') !== 'websocket') {
            return new Response('expected websocket', { status: 426 });
        }
        if (!c.env.INSPECTION_PRESENCE) {
            return new Response('presence unavailable', { status: 501 });
        }

        const id = c.req.param('id');
        if (!id) return new Response('not found', { status: 404 });

        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;

        // Design System 0520 subsystem D phase 6 — observer fallback.
        // Inspector path uses JWT; observers carry the dedicated
        // __Host-observer_session cookie. We try JWT first (the common
        // case) then degrade to the observer cookie. Both produce a DO
        // attach request with `x-user-role: inspector` or `observer`
        // respectively — the DO already routes the two roles correctly
        // (observers are read-only in the roster snapshot).
        let attachUserId: string;
        let attachName:   string;
        let attachRole:   'inspector' | 'observer';

        if (userId && tenantId) {
            let ins;
            try {
                const out = await c.var.services.inspection.getInspection(id, tenantId);
                ins = out.inspection;
            } catch {
                return new Response('not found', { status: 404 });
            }

            let helpers: string[] = [];
            try {
                const parsed = JSON.parse(ins.helperInspectorIds ?? '[]');
                if (Array.isArray(parsed)) helpers = parsed as string[];
            } catch { /* malformed — treat as no helpers */ }

            const allowed = ins.inspectorId === userId
                         || ins.leadInspectorId === userId
                         || helpers.includes(userId);
            if (!allowed) return new Response('forbidden', { status: 403 });

            attachUserId = userId;
            attachName   = ins.inspectorId === userId ? 'Inspector' : 'Helper';
            attachRole   = 'inspector';
        } else {
            const cookie = getCookie(c, OBSERVER_COOKIE_NAME);
            if (!cookie) return new Response('unauthorized', { status: 401 });
            const payload = await verifyObserverCookie(cookie, c.env.JWT_SECRET);
            if (!payload || payload.inspectionId !== id) {
                return new Response('forbidden', { status: 403 });
            }
            attachUserId = `observer-${payload.linkId}`;
            attachName   = 'Observer';
            attachRole   = 'observer';
        }

        const doId = c.env.INSPECTION_PRESENCE.idFromName(id);
        const stub = c.env.INSPECTION_PRESENCE.get(doId);

        const fwd = new Request('https://do.local/ws', {
            method:  'GET',
            headers: {
                'Upgrade':          'websocket',
                'x-user-id':        attachUserId,
                'x-user-name':      attachName,
                'x-user-photo-url': '',
                'x-user-role':      attachRole,
            },
        });
        return stub.fetch(fwd);
    });

export type InspectionsApi = typeof inspectionsRoutes;

export default inspectionsRoutes;
