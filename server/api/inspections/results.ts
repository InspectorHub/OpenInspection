// Per-inspection results & editing sub-router: property facts, results,
// template snapshot, rating-system switch, recommendations aggregate,
// optimistic item-field patch, preflight gates, and batch result patches.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import {
    PropertyFactsSchema,
    PropertyFactsResponseSchema,
    PropertyFactsAutofillRequestSchema,
    PropertyFactsAutofillResponseSchema,
    ResultsBatchSchema,
    ResultsBatchResponseSchema,
} from '../../lib/validations/inspection.schema';
import { TemplateSchemaV2Schema } from '../../lib/validations/template.schema';
import { AggregatedRecommendationsResponseSchema } from '../../lib/validations/recommendation.schema';
import { aggregateAttachedRecommendations } from '../../lib/aggregate-recommendations';
import { applyResultsBatch } from '../../services/inspection-results.service';
import { drizzle } from 'drizzle-orm/d1';
import { inspectionResults } from '../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

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
// Vectorised result patches (used by the standalone form-renderer "Save").
// -----------------------------------------------------------------------------
// POST /{id}/results/batch — accepts an array of `{ itemId, sectionId, field,
// value }` patches and folds them into inspection_results.data in one
// round-trip with forced last-writer-wins semantics (NOT the retired CAS
// version-check path). See inspection-results.service for the upsert semantics.
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
    description: 'Folds an array of { itemId, sectionId, field, value } patches into inspection_results.data using the same composite findingKey, with forced last-writer-wins per field.',
}, { scopes: ['write'], tier: 'extended' }));

const resultsRoutes = createApiRouter()
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
    .openapi(preflightRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const out = await c.var.services.inspection.computePreflight(id, tenantId);
        return c.json({ success: true as const, data: out }, 200);
    })
    .openapi(resultsBatchRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { patches } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        const userId   = user?.sub;
        if (!userId) throw Errors.Unauthorized('Missing user identity');

        // Ownership guard — 404 on tenant mismatch keeps the existence-
        // enumeration leak closed.
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
    });

export default resultsRoutes;
