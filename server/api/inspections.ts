import { createRoute, z } from '@hono/zod-openapi';
import { HonoConfig } from '../types/hono';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { requireCapability } from '../lib/middleware/require-capability';
import { auditFromContext } from '../lib/audit';
import { getBookingHost, resolveTenantSlug } from '../lib/url';
import { reportUrl as buildReportUrl, buildRenderReportUrl, agreementSignUrl } from '../lib/public-urls';
import { resolveArchiveVersion } from './inspections-pdf-helpers';
import { safeISODate } from '../lib/date';
import { Errors } from '../lib/errors';
import { contentDisposition } from '../lib/content-disposition';
import { logger } from '../lib/logger';
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
    ResultsBatchSchema,
    ResultsBatchResponseSchema,
    ConflictListResponseSchema,
    ConflictResolveSchema,
    ConflictResolveResponseSchema,
    CoverCropSchema,
} from '../lib/validations/inspection.schema';
import { CreateTemplateSchema, UpdateTemplateSchema, TemplateSchemaV2Schema } from '../lib/validations/template.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';
import { AggregatedRecommendationsResponseSchema } from '../lib/validations/recommendation.schema';
import { aggregateAttachedRecommendations } from '../lib/aggregate-recommendations';
import { UpdateMediaAnnotationsSchema } from '../lib/validations/media.schema';
import { PatchItemFieldSchema } from '../lib/validations/inspection-patch.schema';
import { CreateInspectionFromWizardSchema } from '../lib/validations/wizard.schema';
import { CreateUnitSchema, UpdateUnitSchema, MoveUnitSchema } from '../lib/validations/unit.schema';
import { drizzle } from 'drizzle-orm/d1';
import { inspections as inspectionTable, inspectionResults, agreements, agreementRequests, agreementSigners, users, contacts, inspectionInspectors, tenants } from '../lib/db/schema';
import { runEnvelopeCompletionPipeline, runSignerReceiptEffects } from '../lib/sign-effects';
import { applyResultsBatch } from '../services/inspection-results.service';
import { syncInspectionAssignments, syncInspectionAssignmentsBatch } from '../lib/db/assignment-links';
import { listPendingConflicts, resolveConflicts } from '../services/conflicts.service';
import { findScheduleConflicts } from '../lib/schedule-conflicts';
import { eq, inArray, and, asc } from 'drizzle-orm';
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
            name:             users.name,
            email:            users.email,
            phone:            users.phone,
            licenseNumber:    users.licenseNumber,
            slug:             users.slug,
            signatureEnabled: users.signatureEnabled,
        }).from(users).where(and(eq(users.id, inspectorId), eq(users.tenantId, tenantId))).get();
        if (!row) return undefined;
        // saas-aware: requestedTenantSlug is empty in saas, so the "Book again"
        // link would otherwise drop. Resolve via the shared helper (DB fallback).
        const tenantSlug = (await resolveTenantSlug(c, tenantId)) || null;
        return { ...row, tenantSlug };
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
const listInspectionsRoute = createRoute(withMcpMetadata({
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


/**
 * GET /api/inspections/inspectors
 */
const listInspectorsRoute = createRoute(withMcpMetadata({
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
const getCountsRoute = createRoute(withMcpMetadata({
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
const scheduleConflictsRoute = createRoute(withMcpMetadata({
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
const getPropertyFactsRoute = createRoute(withMcpMetadata({
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
const PatchTemplateSnapshotBodySchema = z.object({
    snapshot: TemplateSchemaV2Schema.describe('Full v2 template structure to overwrite the inspection snapshot with'),
});
const updateTemplateSnapshotRoute = createRoute(withMcpMetadata({
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
const SwitchRatingSystemSchema = z.object({
    ratingSystemId: z.string().uuid().describe('Target rating system ID to apply to this inspection'),
    mode:           z.enum(['remap', 'clear']).default('remap').describe('How to handle existing ratings: remap by severity bucket or clear them'),
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
const aggregateRecommendationsRoute = createRoute(withMcpMetadata({
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
const cloneInspectionRoute = createRoute(withMcpMetadata({
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
const servePhotoRoute = createRoute(withMcpMetadata({
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
const mediaCenterRoute = createRoute(withMcpMetadata({
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

const mediaUploadRoute = createRoute(withMcpMetadata({
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

const mediaAttachRoute = createRoute(withMcpMetadata({
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

const mediaPoolDeleteRoute = createRoute(withMcpMetadata({
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

// Design System 0520 M14 — PhotoStudio annotation save (subsystem A, phase 4).
// Opaque JSON-encoded shape array (≤8 KB) + caption (≤200 chars). Tenant-
// isolated via ScopedDB; 404 on cross-tenant access (no enumeration leak).
const updateMediaAnnotationsRoute = createRoute(withMcpMetadata({
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
const completeInspectionRoute = createRoute(withMcpMetadata({
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


const sendReportPdfRoute = createRoute(withMcpMetadata({
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
const PublishDefectEntrySchema = z.object({
    sectionId:        z.string(),
    sectionTitle:     z.string(),
    itemId:           z.string(),
    itemLabel:        z.string(),
    cannedId:         z.string(),
    cannedTitle:      z.string(),
    missing:          z.array(z.enum(['location', 'trade'])),
    unresolvedTokens: z.array(z.string()),
});

const publishReadinessRoute = createRoute(withMcpMetadata({
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
const recipientsRoute = createRoute(withMcpMetadata({
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
const peopleRoute = createRoute(withMcpMetadata({
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
const hubRoute = createRoute(withMcpMetadata({
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
const sendAgreementRequestRoute = createRoute(withMcpMetadata({
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
 * POST /api/inspections/:id/publish
 */
const publishRoute = createRoute(withMcpMetadata({
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
                    schema: createApiResponseSchema(z.object({ reportUrl: z.string().describe('TODO describe reportUrl field for the OpenInspection MCP integration'), status: z.string().describe('TODO describe status field for the OpenInspection MCP integration') })),
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
const reinspectRoute = createRoute(withMcpMetadata({
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
const reinspectCandidatesRoute = createRoute(withMcpMetadata({
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

// ── Image Studio (cover crop): POST /api/inspections/:id/cover ───────────────
// Bakes a cropped JPEG derivative of the chosen cover source photo to R2 and
// records the re-editable crop transform. Mirrors the annotation save shape.
const setCoverCropRoute = createRoute(withMcpMetadata({
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
const createFromWizardRoute = createRoute(withMcpMetadata({
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
const patchItemFieldRoute = createRoute(withMcpMetadata({
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

const listUnitsRoute = createRoute(withMcpMetadata({
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

const updateUnitRoute = createRoute(withMcpMetadata({
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

const deleteUnitRoute = createRoute(withMcpMetadata({
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

const moveUnitRoute = createRoute(withMcpMetadata({
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

const mintObserverLinkRoute = createRoute(withMcpMetadata({
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

const listObserverLinksRoute = createRoute(withMcpMetadata({
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

const revokeObserverLinkRoute = createRoute(withMcpMetadata({
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

const listVersionsRoute = createRoute(withMcpMetadata({
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

const getVersionRoute = createRoute(withMcpMetadata({
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

const diffVersionRoute = createRoute(withMcpMetadata({
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
const resultsBatchRoute = createRoute(withMcpMetadata({
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
const listConflictsRoute = createRoute(withMcpMetadata({
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

const resolveConflictsRoute = createRoute(withMcpMetadata({
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
            // DB-8: fetch team fields BEFORE the update so the link-table mirror
            // carries ALL canonical assignment columns (preserves team-mode lead/
            // helpers that bulk-assign cannot change).
            const affected = await db.select({
                id:                 inspectionTable.id,
                leadInspectorId:    inspectionTable.leadInspectorId,
                helperInspectorIds: inspectionTable.helperInspectorIds,
            }).from(inspectionTable)
                .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)))
                .all();
            await db.update(inspectionTable).set({ inspectorId: body.inspectorId })
                .where(and(inArray(inspectionTable.id, body.ids), eq(inspectionTable.tenantId, tenantId)));
            // DB-8: re-sync the link table for each reassigned inspection, preserving
            // team-mode rows that this bulk operation cannot change. B-29: one
            // db.batch round trip for all N resyncs (was a 2N-statement loop).
            const inspectorId = body.inspectorId;
            await syncInspectionAssignmentsBatch(db, tenantId, affected.map(row => {
                let helpers: string[] = [];
                try { helpers = JSON.parse(row.helperInspectorIds ?? '[]'); } catch { /* malformed legacy JSON */ }
                return {
                    inspectionId:       row.id,
                    inspectorId,
                    leadInspectorId:    row.leadInspectorId,
                    helperInspectorIds: helpers,
                };
            }));

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
    // IA-6 — advisory schedule conflict check; placed before /{id} to prevent
    // 'schedule-conflicts' being matched as a param value.
    .openapi(scheduleConflictsRoute, async (c) => {
        const { inspectorId, date, excludeId } = c.req.valid('query');
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);
        // Solo wizard flow sends no inspectorId — the inspection will be
        // assigned to the creator, so that is who we check against.
        const targetId = inspectorId || c.get('user').sub;
        const conflicts = await findScheduleConflicts(db, tenantId, targetId, date, excludeId);
        return c.json({ success: true, data: { conflicts } }, 200);
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
        // DB-8: delete link rows before (or together with) the inspection row.
        await db.delete(inspectionInspectors).where(and(eq(inspectionInspectors.inspectionId, id), eq(inspectionInspectors.tenantId, tenantId)));
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

        // DB-16 — coverPhotoId holds the R2 key of a photo belonging to THIS
        // inspection (an attached item photo or a loose pool photo); null clears
        // the cover. Reject foreign/dangling keys so the preflight gate + report
        // renderer can always resolve the image.
        if (typeof body.coverPhotoId === 'string') {
            const ok = await c.var.services.inspection.isInspectionPhotoKey(id, tenantId, body.coverPhotoId);
            if (!ok) {
                return c.json({ success: false as const, error: { code: 'INVALID_COVER_PHOTO', message: 'coverPhotoId does not reference a photo of this inspection' } }, 400);
            }
        }

        // Tenant-ownership pre-check above guards access. The validated `body`
        // can legitimately be empty: the settings sheet forwards its whole form
        // and the BFF sanitizer drops empty-string "unchanged" fields, so a save
        // that touched nothing (or only fields outside UpdateInspectionSchema)
        // arrives as `{}`. drizzle throws "No values to set" on `.set({})`, which
        // used to surface as a 500 → the sheet's "Error — try again". Treat the
        // no-op as a successful save instead of writing an empty UPDATE.
        if (Object.keys(body).length > 0) {
            await db.update(inspectionTable).set(body).where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId)));
        }

        // DB-8: re-sync link table when inspectorId is explicitly updated.
        // DB-8: mirror ALL canonical assignment columns — PATCH can only change
        // inspectorId, so preserve the pre-patch team-mode fields (leadInspectorId,
        // helperInspectorIds) from the fetched row so the link table stays a faithful
        // mirror of post-patch canonical state and team-mode rows are not wiped.
        if ('inspectorId' in body) {
            let helpers: string[] = [];
            try { helpers = JSON.parse(inspection.helperInspectorIds ?? '[]'); } catch { /* malformed legacy JSON -> no helpers */ }
            await syncInspectionAssignments(db, tenantId, id, {
                inspectorId:        body.inspectorId ?? null,
                leadInspectorId:    inspection.leadInspectorId,
                helperInspectorIds: helpers,
            });
        }

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
        const { items, totals } = aggregateAttachedRecommendations(row?.data as Record<string, unknown> | undefined);
        return c.json({ success: true as const, data: { items, totals } }, 200);
    })
    .openapi(createInspectionRoute, async (c) => {
        const body = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const service = c.var.services.inspection;
        const contactService = c.var.services.contact;

        // Filter undefined values and handle inspectorId logic
        const createData = Object.fromEntries(
            Object.entries(body).filter(([_, v]) => v !== undefined)
        ) as typeof body;

        // IA-1: Resolve client contact before creating the inspection.
        let clientContactId: string | undefined;
        if (body.client) {
            const { id } = await contactService.upsertClientContact(tenantId, {
                name:  body.client.name,
                email: body.client.email,
                phone: body.client.phone,
                type:  'client',
            });
            clientContactId = id;
            // Double-write denormalized columns so legacy read paths keep working.
            // Unconditional: the structured client object is the authoritative
            // source — the flat clientName carries a zod default ('Private
            // Client') that would otherwise always win and mask the real name.
            (createData as Record<string, unknown>).clientName = body.client.name;
            (createData as Record<string, unknown>).clientEmail = body.client.email ?? null;
            (createData as Record<string, unknown>).clientPhone = body.client.phone ?? null;
        }

        // IA-1: Resolve agent — newAgent creates/finds a contacts row; agentContactId uses an existing one.
        let resolvedAgentId: string | undefined = createData.referredByAgentId as string | undefined;
        if (body.newAgent) {
            const { id } = await contactService.upsertClientContact(tenantId, {
                name:  body.newAgent.name,
                email: body.newAgent.email,
                type:  'agent',
            });
            resolvedAgentId = id;
        } else if (body.agentContactId) {
            resolvedAgentId = body.agentContactId;
        }

        const inspection = await service.createInspection(tenantId, {
            ...createData,
            inspectorId:       body.inspectorId || c.get('user').sub,
            referredByAgentId: resolvedAgentId ?? null,
            // IA-1: pass the resolved contact ids through; createInspection stores them.
            clientContactId,
        } as Parameters<typeof service.createInspection>[1]);

        // IA-1: Apply serviceSelections price overrides — replace null priceOverride
        // for any service whose id appears in serviceSelections with a set override.
        if (body.serviceSelections && body.serviceSelections.length > 0) {
            await service.applyServicePriceOverrides(inspection.id, tenantId, body.serviceSelections);
        }

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
    .openapi(servePhotoRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const { key, download, w } = c.req.valid('query');
        if (!c.env.PHOTOS) return c.notFound();
        // Ownership: keys are `${tenantId}/${inspectionId}/...`; reject anything
        // outside this caller's tenant + the inspection in the path.
        if (!key.startsWith(`${tenantId}/${id}/`)) return c.notFound();
        const obj = await c.env.PHOTOS.get(key);
        if (!obj) return c.notFound();

        // DB-16 — optional on-the-fly thumbnail (`?w=`) for grid previews so the
        // browser doesn't download full-resolution originals. Uses the Cloudflare
        // Images binding when available; ANY failure (no binding / no entitlement /
        // non-image) falls back to streaming the original, so it never regresses.
        const width = w ? Math.min(Math.max(parseInt(w, 10) || 0, 16), 2000) : 0;
        const images = (c.env as unknown as { IMAGES?: {
            input(s: ReadableStream): { transform(o: { width: number }): { output(o: { format: string }): Promise<{ response(): Response }> } };
        } }).IMAGES;
        if (width > 0 && images && obj.body) {
            try {
                const out = await images.input(obj.body).transform({ width }).output({ format: 'image/webp' });
                const r = out.response();
                const h = new Headers(r.headers);
                h.set('Cache-Control', 'private, max-age=300');
                return new Response(r.body, { status: 200, headers: h });
            } catch (err) {
                logger.warn('[photo] thumbnail transform failed — serving original', { key, width, error: String(err) });
                // fall through to original below (re-fetch since the stream was consumed)
                const orig = await c.env.PHOTOS.get(key);
                if (orig) {
                    const hh = new Headers();
                    hh.set('Content-Type', orig.httpMetadata?.contentType || 'application/octet-stream');
                    hh.set('Cache-Control', 'private, max-age=300');
                    return new Response(orig.body, { status: 200, headers: hh });
                }
                return c.notFound();
            }
        }

        const headers = new Headers();
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Content-Disposition', contentDisposition(obj.customMetadata?.originalName, download === '1'));
        headers.set('Cache-Control', 'private, max-age=300');
        if (obj.httpEtag) headers.set('etag', obj.httpEtag);
        return new Response(obj.body, { status: 200, headers });
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
            const tenantSlug = await resolveTenantSlug(c, tenantId);
            // linkUrl: per-recipient TOKENIZED report link so the no-login client
            // can open it (a plain URL 404s "Report not found"). Idempotent per
            // (inspection, recipient) — re-sends keep the same stable link.
            const reportToken = await c.var.services.portalAccess.issueToken({ tenantId, inspectionId: id, recipientEmail: inspection.clientEmail, role: 'client' });
            const linkUrl = `${buildReportUrl(getBookingHost(c), tenantSlug, id)}?token=${encodeURIComponent(reportToken)}`;
            // renderUrl: token-bearing URL for the headless browser PDF render.
            const renderUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
            const clientEmail = inspection.clientEmail;
            const address = inspection.propertyAddress as string;

            // Sprint B-4a — resolve the inspector record so the report email
            // body carries the rebooking signature footer.
            const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);
            const sigHost = getBookingHost(c);

            // Best-effort PDF: if BROWSER binding is missing or rendering fails,
            // fall back to the existing text-only "Report Ready" email so we
            // never block inspection completion on an optional dependency.
            // Route through the PDF cache — if the publish flow already rendered
            // this content, getOrRender returns the cached record at zero Browser
            // Rendering cost.
            const deliver = async () => {
                try {
                    const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
                    const versions = await c.var.services.reportVersion.list(tenantId, id);
                    const versionNumber = resolveArchiveVersion(inspection.status, versions);
                    const record = await c.var.services.reportPdf.getOrRender(id, tenantId, 'full', { reportUrl: renderUrl, contentHash, versionNumber });
                    const obj = await c.var.services.reportPdf.streamPdf(record);
                    if (!obj) throw new Error('PDF unavailable');
                    const pdf = await obj.arrayBuffer();
                    await c.var.services.email.sendInspectionReportPdf(clientEmail, address, linkUrl, pdf, sigInspector, sigHost);
                } catch (err) {
                    logger.error('[complete] PDF generation failed, falling back to text-only email',
                        { inspectionId: id }, err instanceof Error ? err : undefined);
                    await c.var.services.email.sendReportReady(clientEmail, address, linkUrl, sigInspector, sigHost);
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

        const tenantSlug = await resolveTenantSlug(c, tenantId);
        // linkUrl: per-recipient TOKENIZED report link. The report viewer is
        // gated (token / session / owner-preview); a plain URL 404s "Report not
        // found" for a no-login recipient. issueToken is idempotent per
        // (inspection, recipient), so re-sends reuse the same stable link.
        const reportToken = await c.var.services.portalAccess.issueToken({ tenantId, inspectionId: id, recipientEmail: recipient, role: 'client' });
        const linkUrl = `${buildReportUrl(getBookingHost(c), tenantSlug, id)}?token=${encodeURIComponent(reportToken)}`;
        // renderUrl: token-bearing URL for the headless browser PDF render.
        const renderUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
        const address = inspection.propertyAddress as string;

        // Sprint B-4a — append rebooking signature for the assigned inspector.
        const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);
        const sigHost = getBookingHost(c);

        try {
            // Route through the PDF cache — reuses an existing render when content
            // is unchanged, avoiding a redundant Browser Rendering call.
            const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
            const versions = await c.var.services.reportVersion.list(tenantId, id);
            const versionNumber = resolveArchiveVersion(inspection.status, versions);
            const record = await c.var.services.reportPdf.getOrRender(id, tenantId, 'full', { reportUrl: renderUrl, contentHash, versionNumber });
            const obj = await c.var.services.reportPdf.streamPdf(record);
            if (!obj) throw new Error('PDF unavailable');
            const pdf = await obj.arrayBuffer();
            await c.var.services.email.sendInspectionReportPdf(recipient, address, linkUrl, pdf, sigInspector, sigHost);
            auditFromContext(c, 'inspection.send_pdf', 'inspection', { entityId: id, metadata: { recipient } });
            return c.json({ success: true as const, data: { sentTo: recipient } }, 200);
        } catch (err) {
            logger.error('[send-report-pdf] PDF failed, sending text-only', { inspectionId: id }, err instanceof Error ? err : undefined);
            await c.var.services.email.sendReportReady(recipient, address, linkUrl, sigInspector, sigHost);
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
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
        middleware: [requireRole('owner', 'manager')] as const,
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
    .openapi(hubRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id }   = c.req.valid('param');

        // Tenant slug for building /report/:tenantSlug/:id links. Public/standalone
        // paths set requestedTenantSlug via tenant routing; saas AUTHENTICATED
        // requests resolve the tenant from the JWT and never set it — fall back
        // to a tenants.slug lookup by the verified tenantId.
        let tenantSlug = c.get('requestedTenantSlug') ?? '';
        if (!tenantSlug) {
            const row = await drizzle(c.env.DB).select({ slug: tenants.slug })
                .from(tenants)
                .where(eq(tenants.id, tenantId))
                .get();
            tenantSlug = row?.slug ?? '';
        }

        const data = await c.var.services.inspection.getInspectionHub(id, tenantId, tenantSlug);
        if (!data) return c.json({ success: false, error: 'Inspection not found' }, 404);
        return c.json({ success: true, data }, 200);
    })
    .openapi(sendAgreementRequestRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id }   = c.req.valid('param');
        const body     = c.req.valid('json');
        const db       = drizzle(c.env.DB);

        // 404 if the inspection is missing or belongs to another tenant.
        const inspection = await db.select().from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        // Resolve the agreement template: explicit id (tenant-scoped) or the
        // tenant's first agreement (same gatekeeper as GET .../agreement).
        let agreement;
        if (body.agreementId) {
            agreement = await db.select().from(agreements)
                .where(and(eq(agreements.id, body.agreementId), eq(agreements.tenantId, tenantId))).get();
            if (!agreement) throw Errors.UnprocessableEntity('The selected agreement template was not found in this workspace.');
        } else {
            agreement = await db.select().from(agreements)
                .where(eq(agreements.tenantId, tenantId)).get();
            if (!agreement) throw Errors.UnprocessableEntity('No agreement template exists yet. Create one in Settings before sending.');
        }

        // Resolve the recipient: explicit email or the inspection's client email.
        const clientEmail = body.email ?? inspection.clientEmail ?? null;
        if (!clientEmail) throw Errors.UnprocessableEntity('No client email on this inspection. Add a client email or enter one to send.');

        // Create the signing request (tenant-scoped inside the service).
        const request = await c.var.services.agreement.createSigningRequest(tenantId, {
            agreementId: agreement.id,
            clientEmail,
            clientName: inspection.clientName ?? null,
            inspectionId: id,
        });

        // Build the public sign URL exactly like the admin send path.
        // Use the saas-aware resolver (requestedTenantSlug is empty in saas → DB fallback).
        const slug = await resolveTenantSlug(c, tenantId);
        const signUrl = agreementSignUrl(getBookingHost(c), slug, request.token);

        // Sign the email with the assigned inspector's rebooking footer (B-4a).
        const sigInspector = await resolveSignatureInspector(c, inspection.inspectorId, tenantId);
        await c.var.services.email.sendAgreementRequest(
            clientEmail, inspection.clientName ?? null, request.agreementName, signUrl, sigInspector, getBookingHost(c),
        );

        // Flip the row to 'sent' (the admin path stamps a request.sent audit
        // event; the hub surfaces row status directly, so we persist it).
        const sentAt = new Date();
        await db.update(agreementRequests)
            .set({ status: 'sent', sentAt })
            .where(and(eq(agreementRequests.id, request.id), eq(agreementRequests.tenantId, tenantId)));

        auditFromContext(c, 'agreement.send', 'agreement_request', {
            entityId: request.id,
            metadata: { agreementId: agreement.id, clientEmail, inspectionId: id },
        });

        return c.json({
            success: true as const,
            data: {
                id:          request.id,
                status:      'sent',
                clientEmail,
                createdAt:   safeISODate(request.createdAt),
            },
        }, 200);
    })
    .openapi(publishRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        const service = c.var.services.inspection;
        // Build the publish options explicitly so `recipients` is omitted (not
        // set to `undefined`) when absent — exactOptionalPropertyTypes rejects
        // `recipients: X[] | undefined` against the service's optional param.
        const publishOptions: Parameters<typeof service.publishInspection>[2] = {
            theme: body.theme,
            notifyClient: body.notifyClient,
            notifyAgent: body.notifyAgent,
            requireSignature: body.requireSignature,
            requirePayment: body.requirePayment,
            sendAgreementCopy: body.sendAgreementCopy,
            ...(body.recipients ? { recipients: body.recipients } : {}),
        };
        const result = await service.publishInspection(id, tenantId, publishOptions);

        // Design System 0520 subsystem D phase 9 — Republish snapshot.
        // After the inspection's status flips to published, persist a frozen
        // snapshot into report_versions so the customer-facing viewer can
        // browse history + diff. Best-effort: failures log but do NOT block
        // the publish response. snapshot-too-large (> 1 MB) downgrades to a
        // warning audit entry rather than a 5xx — the report itself remains
        // viewable through the existing /reports/:id path.
        const userId = (c.get('user') as { sub?: string } | undefined)?.sub;
        let publishedVersion: number | null = null;
        if (userId) {
            try {
                const out = await c.var.services.reportVersion.snapshotOnPublish(
                    tenantId, id, userId, body.summary,
                );
                publishedVersion = out.versionNumber;
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
            const tenantSlug = await resolveTenantSlug(c, tenantId);
            // renderUrl: token-bearing URL for the headless browser PDF render.
            const renderUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
            const sourceVersion = Date.now();
            // Content hash enables post-publish owner/client downloads to reuse this
            // render instead of triggering a second Browser Rendering call.
            const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
            const renderBoth = async () => {
                try {
                    await Promise.all([
                        reportPdf.markQueued(id, tenantId, 'summary', publishedVersion),
                        reportPdf.markQueued(id, tenantId, 'full', publishedVersion),
                    ]);
                    await Promise.allSettled([
                        reportPdf.renderAndStore(id, tenantId, 'summary', { reportUrl: renderUrl, sourceVersion, versionNumber: publishedVersion, contentHash }),
                        reportPdf.renderAndStore(id, tenantId, 'full',    { reportUrl: renderUrl, sourceVersion, versionNumber: publishedVersion, contentHash }),
                    ]);
                } catch (err) {
                    logger.error('[publish] PDF render enqueue failed', { inspectionId: id }, err instanceof Error ? err : undefined);
                }
            };
            c.executionCtx.waitUntil(renderBoth());
        }

        return c.json({ success: true, data: result }, 200);
    })
    .openapi(reinspectRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        try {
            const created = await c.var.services.inspection.createReinspection(tenantId, id, {
                selectedItemIds: body.selectedItemIds,
                inspectorId: body.inspectorId,
            });
            return c.json({ success: true, data: { id: created.id, reinspectionRound: created.reinspectionRound ?? 1 } }, 200);
        } catch (err) {
            return c.json({ success: false, error: { code: 'BAD_REQUEST', message: err instanceof Error ? err.message : 'Failed to create re-inspection' } }, 400);
        }
    })
    .openapi(reinspectCandidatesRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const candidates = await c.var.services.inspection.getReinspectCandidates(tenantId, id);
        return c.json({ success: true, data: { candidates } }, 200);
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/pdf/refresh',
        tags: ["inspections"],
        summary: 'Refresh PDF renders (Summary + Full)',
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
        const tenantSlug = await resolveTenantSlug(c, tenantId);
        // renderUrl: token-bearing URL for the headless browser PDF render.
        const renderUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
        const sourceVersion = Date.now();

        // Refresh re-renders the CURRENT (highest) version in place rather than
        // corrupting a different version's archived row (#120). Resolve the
        // current version per type and pass it consistently to markQueued and
        // renderAndStore.
        const currentSummary = await reportPdf.getPdfRecord(id, tenantId, 'summary');
        const currentFull    = await reportPdf.getPdfRecord(id, tenantId, 'full');
        const summaryVersion = currentSummary?.versionNumber ?? null;
        const fullVersion    = currentFull?.versionNumber ?? null;
        // Store content_hash so post-refresh downloads reuse this render (force
        // re-render is still guaranteed — renderAndStore always calls the browser).
        const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);

        await Promise.all([
            reportPdf.markQueued(id, tenantId, 'summary', summaryVersion),
            reportPdf.markQueued(id, tenantId, 'full', fullVersion),
        ]);
        c.executionCtx.waitUntil((async () => {
            try {
                await Promise.allSettled([
                    reportPdf.renderAndStore(id, tenantId, 'summary', { reportUrl: renderUrl, sourceVersion, versionNumber: summaryVersion, contentHash }),
                    reportPdf.renderAndStore(id, tenantId, 'full',    { reportUrl: renderUrl, sourceVersion, versionNumber: fullVersion,    contentHash }),
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
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
        request: {
            params: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
            query: z.object({ type: z.enum(['summary', 'full']).default('full').describe('TODO describe type field for the OpenInspection MCP integration') }).describe('TODO describe query field for the OpenInspection MCP integration'),
        },
        responses: {
            200: {
                content: { 'application/pdf': { schema: z.any().describe('TODO describe schema field for the OpenInspection MCP integration') } },
                description: 'PDF bytes',
            },
        },
        operationId: "listInspectionPdf",
        description: "Auto-generated placeholder for listInspectionPdf (GET /{id}/pdf, inspections domain). TODO: replace with a real description sourced from the handler."
    }, { scopes: ['read'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId') as string;
        if (!tenantId) return c.json({ success: false, error: { message: 'Tenant required' } }, 400);
        const { id } = c.req.valid('param');
        const { type } = c.req.valid('query');
        // On-demand render — requires CF Browser Rendering + R2 bindings.
        // The publish-time pre-render pipeline (POST /{id}/pdf/refresh) keeps its
        // own isPipelineEnabled gate and is not affected here.
        if (!c.env.BROWSER || !c.env.PHOTOS) {
            return c.json({ success: false, error: { code: 'PDF_UNAVAILABLE', message: 'PDF rendering is not configured on this deployment.' } }, 503);
        }
        // Tenant isolation: getInspection throws NotFound if cross-tenant.
        const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);
        const versions = await c.var.services.reportVersion.list(tenantId, id);
        // Published/delivered → immutable archive version (#120). Drafts → null → keyed on dataVersion.
        const versionNumber = resolveArchiveVersion(inspection.status, versions);
        const tenantSlug = await resolveTenantSlug(c, tenantId);
        const reportUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, id, c.env.JWT_SECRET);
        const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
        const record = await c.var.services.reportPdf.getOrRender(id, tenantId, type, {
            reportUrl,
            contentHash,
            versionNumber,
        });
        const obj = await c.var.services.reportPdf.streamPdf(record);
        if (!obj) return c.json({ success: false, error: { message: 'PDF object missing in storage' } }, 404);
        const filename = `report-${id}${type === 'summary' ? '-summary' : ''}.pdf`;
        return new Response(obj.body, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'private, max-age=300',
            },
        });
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/agent-token',
        tags: ["inspections"],
        summary: 'Generate shareable agent view token',
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
        const tenantSlug = await resolveTenantSlug(c, tenantId);
        const url = `${buildReportUrl(getBookingHost(c), tenantSlug, id)}?view=agent&token=${token}`;
        return c.json({ success: true, data: { token, url } });
    })
    .openapi(createRoute(withMcpMetadata({
        method: 'post', path: '/{id}/share-agent',
        tags: ["inspections"],
        summary: 'Email the report share link to the linked agent',
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
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
        const tenantSlug = await resolveTenantSlug(c, tenantId);
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
    .openapi(setCoverCropRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const formData = await c.req.parseBody();
        const file = formData['image'] as File | undefined;
        if (!file) throw Errors.BadRequest('image file required');
        let rawCrop: unknown;
        try { rawCrop = JSON.parse(String(formData['crop'] ?? '{}')); }
        catch { throw Errors.BadRequest('invalid crop'); }
        const parsed = CoverCropSchema.safeParse(rawCrop);
        if (!parsed.success) throw Errors.BadRequest('invalid crop');
        const sourceKey = String(formData['sourceKey'] ?? '');
        const bytes = await file.arrayBuffer();
        const result = await c.var.services.inspection.setCroppedCover(id, tenantId, sourceKey, bytes, parsed.data);
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
        const data = await listPendingConflicts(db, tenantId, id);
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
        const data = await resolveConflicts(db, tenantId, id, resolutions);
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
    .get('/:id/full', requireRole('owner', 'manager', 'inspector'), async (c) => {
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

        // Track I-a — signed truth rides the envelope: a signed agreement_requests
        // row for this inspection (any channel — emailed OR on-site) lights it.
        const existing = await db.select({ id: agreementRequests.id }).from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, id),
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.status, 'signed'),
            )).limit(1).get();

        return c.json({ success: true, data: { signed: !!existing } }, 200);
    })
    .get('/:id/agreement', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);
        const svc = c.var.services.agreement;

        // Verify inspection exists (404 distinct from "no template").
        const inspection = await db.select({ id: inspectionTable.id }).from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        // Track I-a — ride the envelope: find-or-create the signing request so the
        // on-site signing surface reads the SAME snapshot + signer set as the
        // emailed flow. No template configured → { agreement: null } as before.
        let env: Awaited<ReturnType<typeof svc.findOrCreate>>;
        try {
            env = await svc.findOrCreate(tenantId, id);
        } catch (e) {
            if (e instanceof Error && /No agreement template configured/.test(e.message)) {
                return c.json({ success: true, data: { agreement: null } }, 200);
            }
            throw e;
        }

        const envelope = await db.select().from(agreementRequests)
            .where(eq(agreementRequests.id, env.requestId)).get();
        if (!envelope) throw Errors.NotFound('Agreement request not found');

        const snapshot = await svc.getSnapshotForRequest(envelope);
        const agreementRow = await db.select({ name: agreements.name }).from(agreements)
            .where(eq(agreements.id, envelope.agreementId)).get();
        const signerRows = await svc.listSigners(tenantId, env.requestId);

        return c.json({
            success: true,
            data: {
                // Backward-compatible subset: callers reading data.agreement.{id,name,content} still work.
                agreement: { id: envelope.agreementId, name: agreementRow?.name ?? 'Agreement', content: snapshot.content },
                requestId: env.requestId,
                completionPolicy: envelope.completionPolicy,
                signers: signerRows.map((s) => ({ id: s.id, name: s.name, email: s.email, role: s.role, status: s.status })),
            },
        }, 200);
    })
    .post('/:id/sign', async (c) => {
        const id = c.req.param('id') as string;
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);
        const svc = c.var.services.agreement;

        // Verify inspection exists
        const inspection = await db.select({ id: inspectionTable.id }).from(inspectionTable)
            .where(and(eq(inspectionTable.id, id), eq(inspectionTable.tenantId, tenantId))).get();
        if (!inspection) throw Errors.NotFound('Inspection not found');

        const raw = await c.req.json();
        const parsed = z.object({
            signatureBase64: z.string().min(1).describe('Base64-encoded signature image (data URL or raw base64) drawn by the signer on-site.'),
            signerId: z.string().optional().describe('Target signer within the envelope; defaults to the first non-terminal signer.'),
            onBehalfOf: z.string().max(200).optional().describe('Name of the party an authorized agent signs for.'),
            onBehalfDisclaimer: z.string().max(2000).optional().describe('Disclaimer the authorized agent attests to when signing on behalf of another.'),
        }).safeParse(raw);
        if (!parsed.success) return c.json({ success: false, error: { message: 'Invalid signature data', code: 'validation_error' } }, 400);
        const body = parsed.data;

        // Idempotency at the inspection level: if a signed envelope already
        // exists for this inspection, short-circuit (don't spin a fresh envelope).
        // Preserves the old `{ alreadySigned: true }` contract.
        const alreadySignedEnv = await db.select({ id: agreementRequests.id, status: agreementRequests.status })
            .from(agreementRequests)
            .where(and(
                eq(agreementRequests.inspectionId, id),
                eq(agreementRequests.tenantId, tenantId),
                eq(agreementRequests.status, 'signed'),
            )).limit(1).get();
        if (alreadySignedEnv) {
            return c.json({ success: true, data: { signed: true, alreadySigned: true, envelopeStatus: 'signed' } }, 200);
        }

        // Track I-a — on-site signing rides the envelope so every signature carries
        // a snapshot + audit chain + receipt. An envelope requires a template; the
        // old flow recorded signatures against nothing (the legal hole we close).
        let env: Awaited<ReturnType<typeof svc.findOrCreate>>;
        try {
            env = await svc.findOrCreate(tenantId, id);
        } catch (e) {
            if (e instanceof Error && /No agreement template configured/.test(e.message)) {
                return c.json({ success: false, error: { code: 'no_agreement_template', message: 'Create an agreement template before collecting signatures' } }, 409);
            }
            throw e;
        }

        const envelope = await db.select().from(agreementRequests)
            .where(eq(agreementRequests.id, env.requestId)).get();
        if (!envelope) throw Errors.NotFound('Agreement request not found');

        const signers = await db.select().from(agreementSigners)
            .where(eq(agreementSigners.requestId, env.requestId))
            .orderBy(asc(agreementSigners.createdAt)).all();

        // Pick the target signer: explicit signerId, else first non-terminal.
        let signer;
        if (body.signerId) {
            signer = signers.find((s) => s.id === body.signerId);
            if (!signer) throw Errors.NotFound('Signer not found');
        } else {
            signer = signers.find((s) => !['signed', 'declined', 'expired'].includes(s.status));
            if (!signer) {
                // Every signer is terminal — nothing left to sign.
                throw Errors.Conflict('Agreement is no longer signable');
            }
        }

        // Idempotent — an already-signed signer short-circuits without re-firing effects.
        if (signer.status === 'signed') {
            return c.json({ success: true, data: { signed: true, alreadySigned: true, signerId: signer.id, envelopeStatus: envelope.status } }, 200);
        }

        // Terminal-state guard: declined / expired signers must never reach the audit append.
        if (signer.status === 'declined' || signer.status === 'expired') {
            throw Errors.Conflict('Agreement is no longer signable');
        }

        const plaintext = await svc.getSignerLink(env.requestId, signer.id);

        const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
        const ua = (c.req.header('user-agent') || '').slice(0, 200) || null;
        const country = c.req.header('cf-ipcountry') || null;
        const tsMs = Date.now();

        // Spec 5H P0 — audit-before-mutation per-signer append (chain integrity
        // survives a partial failure). Hash the signature image for cert reference.
        const sigBytes = (() => {
            try {
                const b64 = body.signatureBase64.replace(/^data:image\/[a-z]+;base64,/, '');
                const bin = atob(b64);
                const out = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
                return out;
            } catch { return new Uint8Array(); }
        })();
        const sigHash = sigBytes.length > 0
            ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', sigBytes)))
                .map((b) => b.toString(16).padStart(2, '0')).join('')
            : null;
        try {
            await c.var.services.auditLog.append(envelope.tenantId, envelope.id, 'signer.signed', {
                envelopeId: envelope.id,
                signerId: signer.id,
                signerEmail: signer.email,
                signerRole: signer.role,
                channel: 'in_person',
                contentHash: envelope.contentHash ?? null,
                onBehalfOf: body.onBehalfOf ?? null,
                country,
                ip,
                signatureImageHash: sigHash ? `sha256:${sigHash}` : null,
                tsMs,
                ua,
            });
        } catch (e) {
            logger.warn('audit.append.signer-signed.failed', { requestId: envelope.id, signerId: signer.id, error: (e as Error).message });
        }

        const result = await svc.markSignedBySigner(plaintext, body.signatureBase64, {
            signedAtMs: tsMs,
            channel: 'in_person',
            ipAddress: ip,
            userAgent: ua,
            onBehalfOf: body.onBehalfOf ?? null,
            onBehalfDisclaimer: body.onBehalfDisclaimer ?? null,
        });

        // Spec 2A — per-signer automation event (fires on EVERY sign).
        if (result.inspectionId) {
            c.var.services.automation.trigger({
                tenantId: result.tenantId,
                inspectionId: result.inspectionId,
                triggerEvent: 'agreement.signer_signed',
                companyName: c.env.APP_NAME || 'OpenInspection',
                reportBaseUrl: c.env.APP_BASE_URL || '',
            }).catch(() => {});
        }

        // Envelope completion side-effects fire EXACTLY ONCE.
        if (result.envelopeCompletedNow) {
            await runEnvelopeCompletionPipeline(c, {
                requestId: result.requestId,
                tenantId: result.tenantId,
                inspectionId: result.inspectionId,
                clientEmail: envelope.clientEmail ?? null,
                clientName: envelope.clientName ?? null,
                agreementId: envelope.agreementId,
            });
        }

        // Per-signer in-person receipt — every signer gets a receipt at their own
        // email EXCEPT when this same sign completed the envelope and the signer
        // IS the envelope client (the completion pipeline already emailed them).
        const completedSelf = result.envelopeCompletedNow
            && !!envelope.clientEmail
            && signer.email.trim().toLowerCase() === envelope.clientEmail.trim().toLowerCase();
        if (!completedSelf) {
            await runSignerReceiptEffects(c, {
                signerEmail: signer.email,
                signerName: signer.name,
                inspectionId: result.inspectionId,
                requestId: result.requestId,
            });
        }

        return c.json({ success: true, data: { signed: true, signerId: signer.id, envelopeStatus: result.envelopeStatus } }, 200);
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
