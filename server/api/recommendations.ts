import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { auditFromContext } from '../lib/audit';
import { Errors } from '../lib/errors';
import {
    CreateRecommendationSchema,
    UpdateRecommendationSchema,
    RecommendationResponseSchema,
    RecommendationListResponseSchema,
    ListRecommendationsQuerySchema,
} from '../lib/validations/recommendation.schema';
import { RECOMMENDATION_SEEDS } from '../data/recommendation-seeds';
import { withMcpMetadata } from "../lib/route-metadata-standards";

/* ── GET /api/recommendations ─────────────────────────────────────────────── */
const listRecommendationsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["recommendations"],
    summary: 'List recommendations (filter: category, severity)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { query: ListRecommendationsQuerySchema },
    responses: {
        200: { content: { 'application/json': { schema: RecommendationListResponseSchema } }, description: 'List' },
    },
    operationId: "listRecommendations",
    description: "List the company recommendation library, optionally filtered by category or severity."
}, { scopes: ['read'], tier: 'primary' }));

/* ── GET /api/recommendations/:id ─────────────────────────────────────────── */
const getRecommendationRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}',
    tags: ["recommendations"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().trim().min(1).describe('Recommendation id.') }) },
    responses: {
        200: { content: { 'application/json': { schema: RecommendationResponseSchema } }, description: 'Single recommendation' },
    },
    operationId: "getRecommendation",
    summary: "Get recommendation for current tenant",
    description: "Returns one recommendation (a canned repair item with severity and repair scope) from the company library. Fails with not found when the id is unknown or belongs to an ordinary canned comment that has no repair summary. Owner, manager or inspector."
}, { scopes: ['read'], tier: 'primary' }));

/* ── POST /api/recommendations ────────────────────────────────────────────── */
const createRecommendationRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["recommendations"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { body: { content: { 'application/json': { schema: CreateRecommendationSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: RecommendationResponseSchema } }, description: 'Created' },
    },
    operationId: "createRecommendation",
    summary: "Create recommendation for current tenant",
    description: "Adds a recommendation to the company library: a name, a severity, a repair-scope summary and optionally a category and suggested contractor type. Stored alongside the canned-comment library. Owner, manager or inspector. Writes an audit entry (recommendation.created). Returns the created recommendation."
}, { scopes: ['write'], tier: 'primary' }));

/* ── PUT /api/recommendations/:id ─────────────────────────────────────────── */
const replaceRecommendationRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/{id}',
    tags: ["recommendations"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Recommendation id.') }),
        body: { content: { 'application/json': { schema: UpdateRecommendationSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: RecommendationResponseSchema } }, description: 'Updated' },
    },
    operationId: "replaceRecommendation",
    summary: "Replace recommendation for current tenant",
    description: "Update a recommendation in the company library. Despite the PUT verb it is a partial update: only the fields sent change. Returns 404 when the id is unknown or belongs to an ordinary canned comment with no repair summary. Writes a recommendation.updated audit entry and marks the entry as edited, since recommendations share storage with the canned-comment library. Owner, manager or inspector."
}, { scopes: ['write'], tier: 'extended' }));

/* ── DELETE /api/recommendations/:id ──────────────────────────────────────── */
const deleteRecommendationRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}',
    tags: ["recommendations"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().trim().min(1).describe('Recommendation id.') }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('True when the request succeeded.'), data: z.object({ deleted: z.literal(true).describe('True when the recommendation was deleted.') }).describe('Response payload.') }) } }, description: 'Deleted' },
    },
    operationId: "deleteRecommendation",
    summary: "Delete recommendation for current tenant",
    description: "Permanently deletes a recommendation from the company library. Owner, manager or inspector. Writes an audit entry (recommendation.deleted)."
}, { scopes: ['write'], tier: 'primary' }));

/* ── POST /api/recommendations/seed-defaults ──────────────────────────────── */
const seedDefaultsRecommendationRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/seed-defaults',
    tags: ["recommendations"],
    summary: 'Bulk-insert the default 80 recommendations (idempotent — skips entries with matching name+category)',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {},
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.literal(true).describe('True when the request succeeded.'),
            data: z.object({ inserted: z.number().describe('Number of default recommendations added.'), skipped: z.number().describe('Number of default recommendations skipped because they already exist.') }).describe('Response payload.'),
        }) } }, description: 'Bulk seed result' },
    },
    operationId: "seedDefaultsRecommendation",
    description: "Load the built-in starter set of recommendations into the company library. An entry whose category and name already exist as a recommendation is skipped, so repeating the call is safe and adds only what is missing; the response counts how many were inserted and skipped. Takes no body and writes no audit entry. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

const recommendationsRoutes = createApiRouter()
    .openapi(listRecommendationsRoute, async (c) => {
        const { category, severity } = c.req.valid('query');
        const tenantId = c.get('tenantId') as string;
        const filter: { category?: string; severity?: 'good' | 'marginal' | 'significant' | 'minor' } = {};
        if (category) filter.category = category;
        if (severity) filter.severity = severity;
        const data = await c.var.services.recommendation.listByTenant(tenantId, filter);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(getRecommendationRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        const r = await c.var.services.recommendation.getById(id, tenantId);
        if (!r) throw Errors.NotFound('Recommendation not found');
        return c.json({ success: true as const, data: r }, 200);
    })
    .openapi(createRecommendationRoute, async (c) => {
        const input = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        const userId = (c.get('user') as { sub?: string } | undefined)?.sub;
        const r = await c.var.services.recommendation.create(tenantId, { ...input, createdByUserId: userId ?? null });
        auditFromContext(c, 'recommendation.created', 'recommendation', { entityId: r.id, metadata: { name: r.name, severity: r.severity } });
        return c.json({ success: true as const, data: r }, 200);
    })
    .openapi(replaceRecommendationRoute, async (c) => {
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const tenantId = c.get('tenantId') as string;
        const r = await c.var.services.recommendation.update(id, tenantId, patch);
        auditFromContext(c, 'recommendation.updated', 'recommendation', { entityId: r.id });
        return c.json({ success: true as const, data: r }, 200);
    })
    .openapi(deleteRecommendationRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        await c.var.services.recommendation.delete(id, tenantId);
        auditFromContext(c, 'recommendation.deleted', 'recommendation', { entityId: id });
        return c.json({ success: true as const, data: { deleted: true as const } }, 200);
    })
    .openapi(seedDefaultsRecommendationRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const result = await c.var.services.recommendation.bulkSeed(tenantId, RECOMMENDATION_SEEDS);
        return c.json({ success: true as const, data: result }, 200);
    });

export type RecommendationsApi = typeof recommendationsRoutes;

export default recommendationsRoutes;
