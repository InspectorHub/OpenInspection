// Shared route definitions, inline schemas, and re-exported dependencies for the
// inspections API sub-routers. Extracted verbatim from the original inspections.ts
// (behavior-preserving refactor). Route handlers live in the sibling sub-router files.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import { auditFromContext } from '../../lib/audit';
import { getBookingHost, getBaseUrl, resolveTenantSlug } from '../../lib/url';
import { reportUrl as buildReportUrl, buildRenderReportUrl, agreementSignUrl } from '../../lib/public-urls';
import { buildPortalUrl } from '../../lib/portal-urls';
import { safeISODate } from '../../lib/date';
import { Errors } from '../../lib/errors';
import { contentDisposition } from '../../lib/content-disposition';
import { logger } from '../../lib/logger';
import { getCookie } from 'hono/cookie';
import { verifyObserverCookie } from '../../lib/observer-cookie';
import { OBSERVER_COOKIE_NAME } from '../../lib/middleware/observer-cookie';
import { paginationQuerySchema, PaginatedMetaSchema, buildMeta } from '../../lib/validations/pagination.schema';
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
    CreateReinspectionSchema,
    InspectionRecipientsResponseSchema,
    InspectionPeopleResponseSchema,
    InspectionHubResponseSchema,
    SendAgreementRequestSchema,
    AgreementRequestCreatedSchema,
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
    ReorderPhotosSchema,
    ItemPhotoMutationSchema,
    MovePhotoSchema,
    ResultsBatchSchema,
    ResultsBatchResponseSchema,
    ConflictListResponseSchema,
    ConflictResolveSchema,
    ConflictResolveResponseSchema,
    CoverCropSchema,
    PhotoCropSchema,
} from '../../lib/validations/inspection.schema';
import { CreateTemplateSchema, UpdateTemplateSchema, TemplateSchemaV2Schema } from '../../lib/validations/template.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { AggregatedRecommendationsResponseSchema } from '../../lib/validations/recommendation.schema';
import { aggregateAttachedRecommendations } from '../../lib/aggregate-recommendations';
import { UpdateMediaAnnotationsSchema, CreateVideoUploadSchema, FinalizeVideoSchema, SetPosterSchema } from '../../lib/validations/media.schema';
import { MediaVideoService } from '../../services/media-video.service';
import { PatchItemFieldSchema } from '../../lib/validations/inspection-patch.schema';
import { CreateInspectionFromWizardSchema } from '../../lib/validations/wizard.schema';
import { CreateUnitSchema, UpdateUnitSchema, MoveUnitSchema } from '../../lib/validations/unit.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections as inspectionTable, inspectionResults, agreements, agreementRequests, agreementSigners, contacts, inspectionInspectors, tenants, inspectionMediaPool } from '../../lib/db/schema';
import { runEnvelopeCompletionPipeline, runSignerReceiptEffects } from '../../lib/sign-effects';
import { applyResultsBatch } from '../../services/inspection-results.service';
import { syncInspectionAssignments, syncInspectionAssignmentsBatch } from '../../lib/db/assignment-links';
import { listPendingConflicts, resolveConflicts } from '../../services/conflicts.service';
import { findScheduleConflicts } from '../../lib/schedule-conflicts';
import { eq, inArray, and, asc } from 'drizzle-orm';
import { resolveSignatureInspector } from '../../lib/signature-helpers';
import { getTenantId, getDrizzle } from '../../lib/route-helpers';
import { withMcpMetadata } from "../../lib/route-metadata-standards";

// --- GET /api/inspections/dashboard — Spec 3A ---
export const dashboardRoute = createRoute(withMcpMetadata({
    method: 'get',
    path:   '/dashboard',
    tags: ["inspections"],
    summary: 'Bucketed inspections for dashboard',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const listInspectionsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/',
    tags: ["inspections"],
    summary: "List inspections for current tenant",
    description: 'Retrieve a paginated list of inspections with optional filtering.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const listTemplatesRoute = createRoute(withMcpMetadata({
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
export const listTemplateDuplicatesRoute = createRoute(withMcpMetadata({
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
export const getTemplateRoute = createRoute(withMcpMetadata({
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
export const createTemplateRoute = createRoute(withMcpMetadata({
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
export const importSpectoraRoute = createRoute(withMcpMetadata({
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
export const updateTemplateRoute = createRoute(withMcpMetadata({
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
export const deleteTemplateRoute = createRoute(withMcpMetadata({
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


/**
 * GET /api/inspections/inspectors
 */
export const listInspectorsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspectors',
    tags: ["inspections"],
    summary: "List inspection inspectors for current tenant",
    middleware: [requireRole('owner', 'manager', 'inspector')],
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
export const bulkUpdateRoute = createRoute(withMcpMetadata({
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
    // Task 10 — bulk assignInspector is the canonical "schedule a DIFFERENT
    // inspector" mutation, so the scheduleOthers capability gates this route.
    // owner/admin always pass; an inspector only passes with an explicit
    // {scheduleOthers:true} override. NOTE: this route also serves the
    // updateStatus bulk action, which is correspondingly gated (acceptable —
    // bulk status changes are an admin-grade operation).
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('scheduleOthers')],
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
export const getCountsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/counts',
    tags: ["inspections"],
    summary: 'Get inspection tab counts',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(InspectionCountsSchema) } },
            description: 'Tab counts',
        },
    },
    operationId: "countsInspection",
    description: "Auto-generated placeholder for countsInspection (GET /counts, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));


// IA-6 — GET /api/inspections/schedule-conflicts
// MUST be registered before /{id} to avoid 'schedule-conflicts' matching as an id param.
export const scheduleConflictsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/schedule-conflicts',
    tags: ['inspections'],
    summary: 'Detect same-day-hour assignment conflicts for an inspector',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        query: z.object({
            inspectorId: z.string().min(1).optional().describe('Inspector user id to check; defaults to the caller (solo wizard flow assigns the creator).'),
            date: z.string().min(1).describe('Proposed date/time — ISO datetime or YYYY-MM-DD.'),
            excludeId: z.string().optional().describe('Inspection id being rescheduled; excluded from collision results.'),
        }).describe('Conflict query'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.boolean().describe('Whether the request succeeded'),
                        data: z.object({
                            conflicts: z.array(z.object({
                                inspectionId: z.string().describe('Colliding inspection id'),
                                propertyAddress: z.string().describe('Colliding inspection address'),
                                date: z.string().describe('Colliding inspection date'),
                            })).describe('Same-day-hour collisions for this inspector'),
                        }).describe('Conflict payload'),
                    }).describe('Conflict response'),
                },
            },
            description: 'Success',
        },
    },
    operationId: 'getScheduleConflicts',
    description: 'IA-6 — advisory same-day-hour collision check counting lead and helper assignments. Callers render a warning; scheduling is never blocked.',
}, { scopes: ['read'], tier: 'extended' }));


/**
 * GET /api/inspections/:id
 */
export const getInspectionRoute = createRoute(withMcpMetadata({
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
export const deleteInspectionRoute = createRoute(withMcpMetadata({
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
    operationId: "deleteInspection"
}, { scopes: ['write'], tier: 'primary' }));


/**
 * PATCH /api/inspections/:id
 */
export const updateInspectionRoute = createRoute(withMcpMetadata({
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
        400: { description: 'coverPhotoId does not reference a photo of this inspection (DB-16)' },
    },
    operationId: "patchInspection"
}, { scopes: ['write'], tier: 'primary' }));


/**
 * Round-2 backlog G1 (Spectora §E.2) — GET /api/inspections/:id/property-facts
 * Returns the six Property Facts columns for the strip + report banner.
 */
export const getPropertyFactsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/property-facts',
    tags: ["inspections"],
    summary: "List inspection property facts",
    description: 'Returns the Property Facts strip payload (year built, sqft, foundation, lot, beds, baths).',
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
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
export const updatePropertyFactsRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}/property-facts',
    tags: ["inspections"],
    summary: "Patch inspection property fact",
    description: 'Patches the Property Facts strip. Omitted keys are unchanged; null clears a field.',
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: PropertyFactsSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
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
export const autofillPropertyFactsRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/property-facts/autofill',
    tags: ["inspections"],
    summary: 'Auto-fill property facts from public records (Estated.io)',
    description: 'Returns mapped Property Facts payload or null + reason code. Inspector remains free to override fields manually after auto-fill.',
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: PropertyFactsAutofillRequestSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    middleware: [requireRole('owner', 'manager')],
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
export const getResultsRoute = createRoute(withMcpMetadata({
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
export const updateResultsRoute = createRoute(withMcpMetadata({
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
export const PatchTemplateSnapshotBodySchema = z.object({
    snapshot: TemplateSchemaV2Schema.describe('Full v2 template structure to overwrite the inspection snapshot with'),
});
export const updateTemplateSnapshotRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}/template-snapshot',
    tags: ["inspections"],
    summary: 'Replace the per-inspection template snapshot',
    description: 'Replaces the templateSnapshot JSON wholesale. Validated against TemplateSchemaV2. Used by the inspection editor for inline structural edits (rating system swap, add/remove section/item).',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const SwitchRatingSystemSchema = z.object({
    ratingSystemId: z.string().uuid().describe('Target rating system ID to apply to this inspection'),
    mode:           z.enum(['remap', 'clear']).default('remap').describe('How to handle existing ratings: remap by severity bucket or clear them'),
});
export const SwitchRatingSystemResultSchema = z.object({
    remapped: z.number(),
    cleared:  z.number(),
    total:    z.number(),
});
export const switchRatingSystemRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/switch-rating-system',
    tags: ["inspections"],
    summary: 'Switch the rating system on the per-inspection snapshot',
    description: 'Swaps the per-inspection ratingSystem to the target system. mode="remap" maps existing item ratings by severity bucket; mode="clear" wipes them. Notes/photos/canned comments preserved. Clears the inspection_results.ratingSystemSnapshot freeze so the new system applies end-to-end.',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const aggregateRecommendationsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/recommendations',
    tags: ["inspections"],
    summary: 'Aggregate all attached recommendations + totals for repair list',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const createInspectionRoute = createRoute(withMcpMetadata({
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
    middleware: [requireRole('owner', 'manager', 'inspector')],
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
export const cloneInspectionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/clone',
    tags: ["inspections"],
    summary: "Clone inspection for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
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
export const uploadPhotoRoute = createRoute(withMcpMetadata({
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
    middleware: [requireRole('owner', 'manager', 'inspector')],
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

/* ── A-9 — Inspection photo serve ─────────────────────────────────────────
 * Item + pool photos are referenced across the editor (SideRail, PhotoStudio)
 * and media center, but no handler existed (every such <img> 404'd). This
 * authenticated route streams the R2 object scoped to the caller's tenant +
 * inspection (via the key prefix) and sets Content-Disposition from the stored
 * original filename (`?download=1` forces an attachment). The R2 key — which
 * contains '/' — travels as a query param to avoid path-segment splitting.
 * The public report viewer has its own token-scoped twin in public-report.ts.
 */
export const servePhotoRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/photo',
    tags: ["inspections"],
    summary: 'Serve an inspection photo (tenant-scoped)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('Inspection id that scopes the photo.') }),
        query: z.object({
            key: z.string().describe('R2 object key (`${tenantId}/${inspectionId}/...`).'),
            download: z.string().optional().describe('Set to "1" to force an attachment download named after the original file.'),
            w: z.string().optional().describe('Optional max width in pixels for an on-the-fly thumbnail (grid previews); omitted serves the full-resolution original.'),
        }),
    },
    responses: {
        200: { content: { 'image/*': { schema: z.any() } }, description: 'Photo bytes' },
        404: { description: 'Not found' },
    },
    operationId: "serveInspectionPhoto",
    description: "Streams an inspection item/pool photo from R2, scoped to the caller's tenant + inspection via the key prefix. Sets Content-Disposition from the stored original filename; ?download=1 forces an attachment.",
}, { scopes: ['read'], tier: 'extended' }));


/* ── Round-2 backlog #9 (Spectora §E.3) — Media Center ─────────────────────
 *
 * Three endpoints powering the editor's centralized photo library drawer:
 *   GET  /api/inspections/:id/media          — aggregate {attached, pool}
 *   POST /api/inspections/:id/media/upload   — bulk upload to loose pool
 *   POST /api/inspections/:id/media/attach   — attach pool photo to an item
 *   DELETE /api/inspections/:id/media/pool/:poolId — discard pool photo
 */
export const mediaCenterRoute = createRoute(withMcpMetadata({
    method: 'get',
    path:   '/{id}/media',
    tags: ["inspections"],
    summary: 'Media Center — all attached + pool photos',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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

export const mediaUploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/upload',
    tags: ["inspections"],
    summary: 'Upload a photo to the inspection media pool (loose, unattached)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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

export const mediaAttachRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/attach',
    tags: ["inspections"],
    summary: 'Attach a pool photo to an inspection item',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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

export const mediaPoolDeleteRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path:   '/{id}/media/pool/{poolId}',
    tags: ["inspections"],
    summary: 'Delete a pool photo (cancel an upload)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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

/* ── Plan 7 — video walk-through (Cloudflare Stream) ───────────────────────
 *
 * Direct creator upload: the worker mints a one-shot uploadURL, the browser
 * POSTs the file straight to Cloudflare (bytes bypass the worker → no GPS
 * leak path; Stream re-transcodes and strips container metadata on ingest).
 *   POST   /{id}/media/video/create-upload  — mint uploadURL + streamUid
 *   POST   /{id}/media/video/finalize       — insert the pool row (idempotent)
 *   POST   /{id}/media/video/poster         — set poster frame (thumbnailTimestampPct)
 *   DELETE /{id}/media/video/{streamUid}    — delete from Stream + drop pool row
 *
 * tenantId always comes from the JWT (c.get('tenantId')); the body never
 * carries it. Stream ownership is re-asserted from the meta envelope in the
 * service (fail closed) since videos are not D1 rows with a tenant filter.
 */
export const VideoCreateUploadResponseSchema = z.object({
    uploadURL: z.string().describe('One-shot Cloudflare Stream direct-creator-upload URL'),
    streamUid: z.string().describe('Cloudflare Stream UID for the pending video'),
}).openapi('VideoCreateUploadResponse');

export const VideoFinalizeResponseSchema = z.object({
    poolId:      z.string().describe('inspection_media_pool row id'),
    streamUid:   z.string().describe('Cloudflare Stream UID'),
    durationSec: z.number().nullable().describe('Video duration in seconds (null if not yet known)'),
    readyToStream: z.boolean().describe('Whether Stream has finished transcoding'),
}).openapi('VideoFinalizeResponse');

export const videoCreateUploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/video/create-upload',
    tags: ["inspections"],
    summary: 'Mint a Cloudflare Stream direct-creator-upload URL for a walk-through video',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('Inspection id') }).describe('Path params'),
        body: { content: { 'application/json': { schema: CreateVideoUploadSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(VideoCreateUploadResponseSchema) } },
            description: 'Upload URL minted',
        },
    },
    operationId: "createInspectionVideoUpload",
    description: "Mint a one-shot Cloudflare Stream direct-creator-upload URL (browser uploads bytes directly; worker never sees them)."
}, { scopes: ['write'], tier: 'extended' }));

export const videoFinalizeRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/video/finalize',
    tags: ["inspections"],
    summary: 'Finalize a video upload — insert the media-pool row (idempotent on streamUid)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('Inspection id') }).describe('Path params'),
        body: { content: { 'application/json': { schema: FinalizeVideoSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(VideoFinalizeResponseSchema) } },
            description: 'Pool video row created',
        },
    },
    operationId: "finalizeInspectionVideo",
    description: "Insert an inspection_media_pool video row after the browser-direct upload completes. Idempotent on streamUid."
}, { scopes: ['write'], tier: 'extended' }));

export const videoPosterRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/video/poster',
    tags: ["inspections"],
    summary: 'Set a video poster frame (thumbnailTimestampPct as a 0..1 fraction)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('Inspection id') }).describe('Path params'),
        body: { content: { 'application/json': { schema: SetPosterSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Poster set',
        },
    },
    operationId: "setInspectionVideoPoster",
    description: "Set the Cloudflare Stream poster frame and persist posterPct on the pool row."
}, { scopes: ['write'], tier: 'extended' }));

export const videoDeleteRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path:   '/{id}/media/video/{streamUid}',
    tags: ["inspections"],
    summary: 'Delete a walk-through video from Cloudflare Stream + drop the pool row',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:        z.string().uuid().describe('Inspection id'),
            streamUid: z.string().min(1).describe('Cloudflare Stream UID'),
        }).describe('Path params'),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Video deleted',
        },
    },
    operationId: "deleteInspectionVideo",
    description: "Delete a video from Cloudflare Stream (tenant-guarded via meta envelope) and remove its media-pool row."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3, P4) — reorder an item's photos[] (array order ==
// report photo order). Pure permutation; the submitted key set must match.
export const itemPhotosReorderRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/reorder',
    tags: ["inspections"],
    summary: 'Reorder an item\'s photos (array order = report order)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:     z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId: z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: ReorderPhotosSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Photos reordered',
        },
    },
    operationId: "reorderInspectionItemPhotos",
    description: "Auto-generated placeholder for reorderInspectionItemPhotos (POST /{id}/items/{itemId}/photos/reorder, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3, P4) — detach a photo from an item (drop the array
// entry; the R2 object is preserved).
export const itemPhotoDetachRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/{photoIndex}/detach',
    tags: ["inspections"],
    summary: 'Detach a photo from an inspection item (keeps the R2 object)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:         z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId:     z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
            photoIndex: z.coerce.number().int().nonnegative().describe('Index of the photo within the item\'s photos[] array'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: ItemPhotoMutationSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Photo detached',
        },
    },
    operationId: "detachInspectionItemPhoto",
    description: "Auto-generated placeholder for detachInspectionItemPhoto (POST /{id}/items/{itemId}/photos/{photoIndex}/detach, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3) — revert a photo's edits to the original (drop the
// annotated derivative; keep the source key). Non-destructive undo.
export const itemPhotoRevertRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/{photoIndex}/revert',
    tags: ["inspections"],
    summary: 'Revert a photo\'s edits to the original (drops annotations)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:         z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId:     z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
            photoIndex: z.coerce.number().int().nonnegative().describe('Index of the photo within the item\'s photos[] array'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: ItemPhotoMutationSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Photo reverted',
        },
    },
    operationId: "revertInspectionItemPhoto",
    description: "Auto-generated placeholder for revertInspectionItemPhoto (POST /{id}/items/{itemId}/photos/{photoIndex}/revert, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3, Task 9b) — move a photo from one item to another
// (detach from source + append to target, derivatives ride along).
export const itemPhotoMoveRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/{photoIndex}/move',
    tags: ["inspections"],
    summary: 'Move a photo from one inspection item to another',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:         z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId:     z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
            photoIndex: z.coerce.number().int().nonnegative().describe('Index of the photo within the source item\'s photos[] array'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: MovePhotoSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Photo moved',
        },
    },
    operationId: "moveInspectionItemPhoto",
    description: "Auto-generated placeholder for moveInspectionItemPhoto (POST /{id}/items/{itemId}/photos/{photoIndex}/move, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// Design System 0520 M14 — PhotoStudio annotation save (subsystem A, phase 4).
// Opaque JSON-encoded shape array (≤8 KB) + caption (≤200 chars). Tenant-
// isolated via ScopedDB; 404 on cross-tenant access (no enumeration leak).
export const updateMediaAnnotationsRoute = createRoute(withMcpMetadata({
    method:     'put',
    path:       '/{id}/media/{mediaId}/annotations',
    tags: ["inspections"],
    summary:    'Save PhotoStudio annotation overlay + caption',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const completeInspectionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/complete',
    tags: ["inspections"],
    summary: "Complete inspection for current tenant",
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
    operationId: "completeInspection",
    description: "Auto-generated placeholder for completeInspection (POST /{id}/complete, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


export const sendReportPdfRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/send-report-pdf',
    tags: ["inspections"],
    summary: 'Re-send the inspection report as a PDF email attachment',
    middleware: [requireRole('owner', 'manager', 'inspector')],
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
export const getReportDataRoute = createRoute(withMcpMetadata({
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
export const PublishDefectEntrySchema = z.object({
    sectionId:        z.string(),
    sectionTitle:     z.string(),
    itemId:           z.string(),
    itemLabel:        z.string(),
    cannedId:         z.string(),
    cannedTitle:      z.string(),
    missing:          z.array(z.enum(['location', 'trade'])),
    unresolvedTokens: z.array(z.string()),
});

export const publishReadinessRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/publish-readiness',
    tags: ['inspections'],
    summary: 'Check whether an inspection is ready to publish (required defect fields filled)',
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection identifier to evaluate for publish readiness') }),
    },
    responses: {
        200: {
            description: 'Readiness payload',
            content: {
                'application/json': {
                    schema: z.object({
                        ready: z.boolean(),
                        blockingDefects: z.array(PublishDefectEntrySchema),
                        // Track H (IA-7) — incomplete-but-not-required defects:
                        // yellow warning on the gate, never a block.
                        warningDefects: z.array(PublishDefectEntrySchema),
                    }),
                },
            },
        },
    },
    operationId: 'getInspectionPublishReadiness',
    description: 'Returns ready=true when every included defect has its REQUIRED fields filled (configurable per tenant/inspection — Track H IA-7); non-required gaps surface as warningDefects.',
}, { scopes: ['read'], tier: 'extended' }));


/**
 * GET /api/inspections/:id/repair-list
 *
 * Track E1 (ITB §11, UC-ITB-07) — flat punch-list of every defect-rated
 * item across the inspection, suitable for handing to a contractor or
 * realtor. Authenticated route; the public viewer page hits the same
 * service via a server-side render at /inspections/:id/repair-list.
 */
export const RepairListEntrySchema = z.object({
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
export const RepairListResponseSchema = z.object({
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

export const getRepairListRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/repair-list',
    tags: ["inspections"],
    summary: 'Get aggregated repair list (defects-only punch list)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const recipientsRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{id}/recipients',
    tags: ["inspections"],
    summary: 'List the recipients eligible for the Publish modal',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const peopleRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{id}/people',
    tags: ["inspections"],
    summary: 'People card payload (inspector, client, agents)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
 * GET /api/inspections/:id/hub
 *
 * Issue #111 — single aggregate payload powering the `/inspections/:id` hub
 * page. One round trip drives all six blocks (People / Schedule / Services /
 * Agreement / Invoice / Report status). 404 when the inspection does not exist
 * or belongs to another tenant.
 */
export const hubRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{id}/hub',
    tags: ['inspections'],
    summary: 'Aggregate hub payload (people, schedule, services, agreement, invoice, report status)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('Inspection identifier') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: InspectionHubResponseSchema } },
            description: 'Inspection hub payload',
        },
        404: { description: 'Inspection not found in this tenant' },
    },
    operationId: 'getInspectionHub',
    description: 'Returns one aggregate payload for the inspection hub page so the loader makes a single round trip: core inspection fields, the people card, booked service lines, the tenant agreement templates, this inspection\'s agreement requests, the most recent invoice, and the publish-readiness summary.',
}, { scopes: ['read'], tier: 'extended' }));

/**
 * POST /api/inspections/:id/agreement-requests
 *
 * Task 7 (Issue #111) — the hub Agreement card "Send agreement" button. Creates
 * a signing request and emails it to the client. Both body fields are optional:
 * agreementId defaults to the tenant's first agreement template, email defaults
 * to the inspection's clientEmail. 422 when no template exists, no email is
 * resolvable, or the supplied agreementId does not belong to the tenant.
 */
export const sendAgreementRequestRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/{id}/agreement-requests',
    tags: ['inspections'],
    summary: 'Create + email an agreement signing request for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('Inspection identifier') }),
        body: { content: { 'application/json': { schema: SendAgreementRequestSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AgreementRequestCreatedSchema } },
            description: 'Signing request created and emailed',
        },
        404: { description: 'Inspection not found in this tenant' },
        422: { description: 'No agreement template, no resolvable email, or agreement not in this tenant' },
    },
    operationId: 'createInspectionAgreementRequest',
    description: 'Creates an agreement signing request for the inspection, emails it to the client, marks it sent, and returns the created request.',
}, { scopes: ['write'], tier: 'extended' }));


/**
 * POST /api/inspections/:id/submit
 * Submits a completed report for review (in_progress → submitted).
 * Does NOT require the `publish` capability — any inspector/manager/owner can submit.
 */
export const submitReportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/submit',
    tags: ['inspections'],
    summary: 'Submit report for review',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection id') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ reportStatus: z.string() })) } },
            description: 'Report submitted for review',
        },
        400: { description: 'Invalid precondition (e.g. report already submitted, inspection not completed)' },
    },
    operationId: 'submitReport',
    description: 'Transitions reportStatus from in_progress → submitted. Requires inspection.status === completed.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/inspections/:id/return
 * Returns a submitted report to the inspector for revision (submitted → in_progress).
 * Requires the `publish` capability (owner/manager by default; inspector only if not overridden).
 */
export const returnReportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/return',
    tags: ['inspections'],
    summary: 'Return submitted report to inspector for revision',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('publish')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection id') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ reportStatus: z.string() })) } },
            description: 'Report returned to inspector',
        },
        400: { description: 'Invalid precondition (report is not in submitted state)' },
        403: { description: 'Missing publish capability' },
    },
    operationId: 'returnReport',
    description: 'Transitions reportStatus from submitted → in_progress. Requires publish capability.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/inspections/:id/unpublish
 * Unpublishes a published report, reverting it to in_progress (published → in_progress).
 * Requires the `publish` capability.
 */
export const unpublishReportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/unpublish',
    tags: ['inspections'],
    summary: 'Unpublish a published report',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('publish')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection id') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ reportStatus: z.string() })) } },
            description: 'Report unpublished',
        },
        400: { description: 'Invalid precondition (report is not published)' },
        403: { description: 'Missing publish capability' },
    },
    operationId: 'unpublishReport',
    description: 'Transitions reportStatus from published → in_progress. Requires publish capability.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/inspections/:id/publish
 */
export const publishRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/publish',
    tags: ["inspections"],
    summary: "Publish inspection for current tenant",
    // Task 10 — publish capability layered on top of the role gate. owner/admin
    // always pass; an inspector with permission_overrides {publish:false}
    // ("requires review") is 403'd here.
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('publish')] as const,
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
                    schema: createApiResponseSchema(z.object({ reportUrl: z.string().describe('TODO describe reportUrl field for the OpenInspection MCP integration'), reportStatus: z.string().describe('TODO describe reportStatus field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Published',
        },
    },
    operationId: "publishInspection",
    description: "Auto-generated placeholder for publishInspection (POST /{id}/publish, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/**
 * Issue #119 (Re-inspections) Task 4 — POST /api/inspections/:id/reinspect
 * Creates a new linked inspection that carries forward the selected still-open
 * flagged items from a published baseline report. 400 when the baseline is not
 * published.
 */
export const reinspectRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/reinspect',
    tags: ['inspections'],
    summary: 'Create a re-inspection from this (published) baseline report',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().describe('Baseline inspection id (original or a prior re-inspection; must be published).') }),
        body: { content: { 'application/json': { schema: CreateReinspectionSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(z.object({ id: z.string(), reinspectionRound: z.number() })) } }, description: 'Re-inspection created' },
        400: { description: 'Baseline not published / invalid' },
    },
    operationId: 'createReinspection',
    description: 'Creates a new linked inspection that carries forward the selected still-open flagged items from a published baseline report.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * Issue #119 (Re-inspections) Task 6 — GET /api/inspections/:id/reinspect-candidates
 * The still-open flagged items off a published baseline, so the hub's
 * "Create re-inspection" modal can list them with the carry-forward set
 * pre-checked. Empty array when the baseline is unpublished.
 */
export const reinspectCandidatesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/reinspect-candidates',
    tags: ['inspections'],
    summary: 'Candidate carry-forward items for a re-inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().min(1).describe('Baseline inspection id (the published report to re-inspect).') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({
                candidates: z.array(z.object({
                    itemId: z.string(),
                    label: z.string(),
                    originalNotes: z.string().nullable(),
                    open: z.boolean(),
                })),
            })) } },
            description: 'Re-inspection candidate items',
        },
    },
    operationId: 'getReinspectCandidates',
    description: 'Returns the baseline report\'s flagged items (still-open ones pre-flagged) so the inspector can choose which to carry forward into a new re-inspection.',
}, { scopes: ['read'], tier: 'extended' }));


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
export const saveAnnotationRoute = createRoute(withMcpMetadata({
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
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ annotatedKey: z.string().describe('TODO describe annotatedKey field for the OpenInspection MCP integration') })) } },
            description: 'Annotation saved',
        },
    },
    operationId: "createInspectionItemsPhotosAnnotation",
    description: "Auto-generated placeholder for createInspectionItemsPhotosAnnotation (POST /{id}/items/{itemId}/photos/{photoIndex}/annotation, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// ── Media Studio (cover crop): POST /api/inspections/:id/cover ───────────────
// Bakes a cropped JPEG derivative of the chosen cover source photo to R2 and
// records the re-editable crop transform. Mirrors the annotation save shape.
export const setCoverCropRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/cover',
    tags: ["inspections"],
    summary: 'Set cropped report cover (baked JPEG derivative + crop transform)',
    request: {
        params: z.object({
            id: z.string().describe('Inspection id'),
        }).describe('Cover crop path params'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        image: z.unknown().openapi({ type: 'string', format: 'binary' }).describe('Baked cropped JPEG (2048px long edge)'),
                        sourceKey: z.string().describe('R2 key of the cover source photo this crop applies to'),
                        crop: z.string().describe('JSON-encoded CoverCrop transform (source-pixel coords)'),
                    }).describe('Cover crop multipart body'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ coverImageKey: z.string().describe('R2 key of the baked cropped cover derivative') })) } },
            description: 'Cropped cover saved',
        },
    },
    operationId: "setInspectionCover",
    description: "Bake and store a cropped report-cover JPEG derivative for an inspection and record its re-editable crop transform (POST /{id}/cover, inspections domain)."
}, { scopes: ['write'], tier: 'extended' }));

// ── Media Studio (Plan 4): crop an item/defect photo ─────────────────────────
export const cropItemPhotoRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/items/{itemId}/photos/{photoIndex}/crop',
    tags: ["inspections"],
    summary: 'Bake and store a cropped derivative for an inspection-item or defect photo',
    request: {
        params: z.object({
            id: z.string().describe('Inspection id'),
            itemId: z.string().describe('Inspection item id'),
            photoIndex: z.coerce.number().int().min(0).describe('Index into the item/defect photos array'),
        }).describe('Crop item-photo path params'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        image: z.unknown().openapi({ type: 'string', format: 'binary' }).describe('Baked cropped JPEG (2048px long edge)'),
                        crop: z.string().describe('JSON-encoded PhotoCrop transform (source-pixel coords)'),
                        sectionId: z.string().optional().describe('Section id for composite finding key (defect photos)'),
                    }).describe('Crop item-photo multipart body'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ croppedKey: z.string().describe('R2 key of the baked cropped derivative') })) } },
            description: 'Cropped item photo saved',
        },
    },
    operationId: "cropInspectionItemPhoto",
    description: "Bake and store a cropped derivative for an inspection-item or per-defect photo and record its re-editable crop transform (POST /{id}/items/{itemId}/photos/{photoIndex}/crop, inspections domain).",
}, { scopes: ['write'], tier: 'extended' }));


// -----------------------------------------------------------------------------
// Agent Accounts A3 — POST /api/inspections/:id/concierge/approve
// -----------------------------------------------------------------------------
// Inspector flips an awaiting_inspector concierge booking to awaiting_client.
// Service mints the magic-link + sends the client confirm email. Tenant scope
// is enforced via JWT-derived tenantId — never trust the URL for tenant.
export const approveConciergeRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/concierge/approve',
    tags: ["inspections"],
    summary: 'Approve a concierge booking awaiting inspector review',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const createFromWizardRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/wizard',
    tags: ["inspections"],
    summary:    'Create an inspection from the 4-step NewInspectionWizard',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const patchItemFieldRoute = createRoute(withMcpMetadata({
    method:     'patch',
    path:       '/{id}/items/{itemId}',
    tags: ["inspections"],
    summary:    'Patch a single item field with optimistic-concurrency version check',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const preflightRoute = createRoute(withMcpMetadata({
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

export const createUnitRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/units',
    tags: ["inspections"],
    summary:    'Create a unit (Building / Floor / Unit) under an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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

export const listUnitsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/units',
    tags: ["inspections"],
    summary:    'List units for an inspection (flat — client builds tree)',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  {
        200: { description: 'ok' },
    },
    operationId: "listInspectionUnits",
    description: "Auto-generated placeholder for listInspectionUnits (GET /{id}/units, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

export const updateUnitRoute = createRoute(withMcpMetadata({
    method:     'patch',
    path:       '/{id}/units/{unitId}',
    tags: ["inspections"],
    summary:    'Rename or re-sort a unit',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), unitId: z.string().min(1).describe('TODO describe unitId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateUnitSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    operationId: "patchInspectionUnit",
    description: "Auto-generated placeholder for patchInspectionUnit (PATCH /{id}/units/{unitId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const deleteUnitRoute = createRoute(withMcpMetadata({
    method:     'delete',
    path:       '/{id}/units/{unitId}',
    tags: ["inspections"],
    summary:    'Delete a unit (cascades to children)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), unitId: z.string().min(1).describe('TODO describe unitId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    operationId: "deleteInspectionUnit",
    description: "Auto-generated placeholder for deleteInspectionUnit (DELETE /{id}/units/{unitId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const moveUnitRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/units/{unitId}/move',
    tags: ["inspections"],
    summary:    'Reparent + reorder atomically (cycle-detected)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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

export const mintObserverLinkRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/observer-links',
    tags: ["inspections"],
    summary:    'Mint a no-account read-only viewer link',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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

export const listObserverLinksRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/observer-links',
    tags: ["inspections"],
    summary:    'List active observer links for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok' } },
    operationId: "listInspectionObserverLinks",
    description: "Auto-generated placeholder for listInspectionObserverLinks (GET /{id}/observer-links, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

export const revokeObserverLinkRoute = createRoute(withMcpMetadata({
    method:     'delete',
    path:       '/{id}/observer-links/{linkId}',
    tags: ["inspections"],
    summary:    'Revoke an observer link',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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

export const listVersionsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions',
    tags: ["inspections"],
    summary:    'List published versions for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok' } },
    operationId: "listInspectionVersions",
    description: "Auto-generated placeholder for listInspectionVersions (GET /{id}/versions, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

export const getVersionRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions/{n}',
    tags: ["inspections"],
    summary:    'Get full snapshot for a specific version',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), n: z.string().regex(/^\d+$/).describe('TODO describe n field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok' }, 404: { description: 'not found' } },
    operationId: "getInspectionVersion",
    description: "Auto-generated placeholder for getInspectionVersion (GET /{id}/versions/{n}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

export const diffVersionRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions/{n}/diff',
    tags: ["inspections"],
    summary:    'Diff version :n against ?from=<version>',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
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
export const resultsBatchRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/results/batch',
    tags:       ['inspections'],
    summary:    'Apply a batch of result patches to an inspection in one round-trip',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
export const listConflictsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/conflicts',
    tags:       ['inspections'],
    summary:    'List pending sync conflicts for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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

export const resolveConflictsRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/conflicts/resolve',
    tags:       ['inspections'],
    summary:    'Clear sync conflicts the inspector has adjudicated',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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


// Re-export every imported dependency so sub-router handlers can pull them from a
// single module without changing handler bodies.
export {
    createRoute, z, createApiRouter, requireRole, requireCapability, auditFromContext, getBookingHost, getBaseUrl, resolveTenantSlug, buildReportUrl, buildRenderReportUrl, agreementSignUrl, buildPortalUrl, safeISODate, Errors, contentDisposition, logger, getCookie, verifyObserverCookie, OBSERVER_COOKIE_NAME, paginationQuerySchema, PaginatedMetaSchema, buildMeta, InspectionListQuerySchema, CreateInspectionSchema, UpdateInspectionSchema, PatchResultsSchema, BulkInspectionSchema, InspectionSchema, InspectionListResponseSchema, InspectionCountsSchema, PublishInspectionSchema, CreateReinspectionSchema, InspectionRecipientsResponseSchema, InspectionPeopleResponseSchema, InspectionHubResponseSchema, SendAgreementRequestSchema, AgreementRequestCreatedSchema, ReportDataResponseSchema, CancelInspectionSchema, DashboardResponseSchema, PropertyFactsSchema, PropertyFactsResponseSchema, PropertyFactsAutofillRequestSchema, PropertyFactsAutofillResponseSchema, MediaCenterResponseSchema, MediaPoolUploadResponseSchema, MediaAttachRequestSchema, MediaAttachResponseSchema, ReorderPhotosSchema, ItemPhotoMutationSchema, MovePhotoSchema, ResultsBatchSchema, ResultsBatchResponseSchema, ConflictListResponseSchema, ConflictResolveSchema, ConflictResolveResponseSchema, CoverCropSchema, PhotoCropSchema, CreateTemplateSchema, UpdateTemplateSchema, TemplateSchemaV2Schema, createApiResponseSchema, SuccessResponseSchema, AggregatedRecommendationsResponseSchema, aggregateAttachedRecommendations, UpdateMediaAnnotationsSchema, CreateVideoUploadSchema, FinalizeVideoSchema, SetPosterSchema, MediaVideoService, PatchItemFieldSchema, CreateInspectionFromWizardSchema, CreateUnitSchema, UpdateUnitSchema, MoveUnitSchema, drizzle, inspectionTable, inspectionResults, agreements, agreementRequests, agreementSigners, contacts, inspectionInspectors, tenants, inspectionMediaPool, runEnvelopeCompletionPipeline, runSignerReceiptEffects, applyResultsBatch, syncInspectionAssignments, syncInspectionAssignmentsBatch, listPendingConflicts, resolveConflicts, findScheduleConflicts, eq, inArray, and, asc, resolveSignatureInspector, getTenantId, getDrizzle, withMcpMetadata,
};
