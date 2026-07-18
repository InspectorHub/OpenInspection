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
    request: { query: ListRecommendationsQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: RecommendationListResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'List' },
    },
    operationId: "listRecommendations",
    description: "Auto-generated placeholder for listRecommendations (GET /, recommendations domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'primary' }));

/* ── GET /api/recommendations/:id ─────────────────────────────────────────── */
const getRecommendationRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}',
    tags: ["recommendations"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: RecommendationResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Single recommendation' },
    },
    operationId: "getRecommendation",
    summary: "Get recommendation for current tenant",
    description: "Auto-generated placeholder for getRecommendation (GET /{id}, recommendations domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'primary' }));

/* ── POST /api/recommendations ────────────────────────────────────────────── */
const createRecommendationRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["recommendations"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { body: { content: { 'application/json': { schema: CreateRecommendationSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: { content: { 'application/json': { schema: RecommendationResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Created' },
    },
    operationId: "createRecommendation",
    summary: "Create recommendation for current tenant",
    description: "Auto-generated placeholder for createRecommendation (POST /, recommendations domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary' }));

/* ── PUT /api/recommendations/:id ─────────────────────────────────────────── */
const replaceRecommendationRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/{id}',
    tags: ["recommendations"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateRecommendationSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: RecommendationResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Updated' },
    },
    operationId: "replaceRecommendation",
    summary: "Replace recommendation for current tenant",
    description: "Auto-generated placeholder for replaceRecommendation (PUT /{id}, recommendations domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/* ── DELETE /api/recommendations/:id ──────────────────────────────────────── */
const deleteRecommendationRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}',
    tags: ["recommendations"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ deleted: z.literal(true).describe('TODO describe deleted field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } }, description: 'Deleted' },
    },
    operationId: "deleteRecommendation",
    summary: "Delete recommendation for current tenant",
    description: "Auto-generated placeholder for deleteRecommendation (DELETE /{id}, recommendations domain). TODO: replace with a real description sourced from the handler."
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
            success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
            data: z.object({ inserted: z.number().describe('TODO describe inserted field for the OpenInspection MCP integration'), skipped: z.number().describe('TODO describe skipped field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
        }) } }, description: 'Bulk seed result' },
    },
    operationId: "seedDefaultsRecommendation",
    description: "Auto-generated placeholder for seedDefaultsRecommendation (POST /seed-defaults, recommendations domain). TODO: replace with a real description sourced from the handler."
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
