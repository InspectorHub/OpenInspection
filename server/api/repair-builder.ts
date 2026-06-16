/**
 * Interactive Repair Request Builder — source endpoint.
 *
 * GET /api/public/repair-builder/:tenant/:id/source
 *
 * Returns the flattened defect list from the published report plus the
 * caller's existing repair requests for this inspection. Gated by:
 *   1. Auth  — portal token / legacy agent-view KV token / owner-preview JWT
 *   2. Publish — inspections.reportStatus must be 'published'
 *   3. Tenant  — tenant_configs.enable_customer_repair_export must be true
 *
 * NOT mounted in index.ts yet (Task 4). Export the router as default so Task 4
 * can mount it with a one-liner.
 */

import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, tenantConfigs } from '../lib/db/schema';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { resolvePortalAccess, resolveOwnerPreviewFull } from '../lib/public-access';
import { isReportPublished } from '../lib/status/report-status';
import { flattenReportDefects } from '../lib/repair-defects';
import type { Creator } from '../services/repair-request.service';
import type { HonoConfig } from '../types/hono';

// ---------------------------------------------------------------------------
// Access resolution
// ---------------------------------------------------------------------------

/**
 * Resolves tenantId + Creator from the same three modes as the public report
 * route (portal token → legacy agent KV token → owner-preview JWT), returning
 * null when none succeed.
 *
 * creator.ref semantics:
 *   client    → recipientEmail (stable per-recipient identifier from the token row)
 *   agent     → the raw token string (unique KV credential for this agent session)
 *   inspector → userId from the verified owner-preview JWT
 */
async function resolveBuilderAccess(
    c: Context<HonoConfig>,
    id: string,
): Promise<{ tenantId: string; creator: Creator; ownerPreview: boolean } | null> {
    const token = c.req.query('token');

    // Path 1: persistent portal token (client / co_client / agent role).
    const grant = await resolvePortalAccess(c.var.services.portalAccess, token, id);
    if (grant) {
        const creator: Creator = { kind: 'client', ref: grant.recipientEmail };
        return { tenantId: grant.tenantId, creator, ownerPreview: false };
    }

    // Path 2: legacy KV agent-view token (existing share links).
    if (token) {
        const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
        if (legacy && legacy.inspectionId === id) {
            const creator: Creator = { kind: 'agent', ref: token };
            return { tenantId: legacy.tenantId, creator, ownerPreview: false };
        }
    }

    // Path 3: owner-preview via session Bearer JWT.
    const ownerFull = await resolveOwnerPreviewFull(c);
    if (ownerFull) {
        const creator: Creator = { kind: 'inspector', ref: ownerFull.userId };
        return { tenantId: ownerFull.tenantId, creator, ownerPreview: true };
    }

    return null;
}

// ---------------------------------------------------------------------------
// Shared gate helper
// ---------------------------------------------------------------------------

/**
 * Runs the publish gate + tenant-flag gate (same two drizzle queries as the
 * source route). Returns a 403 Response on failure, or null on success so the
 * caller can continue.
 *
 * Usage:
 *   const gate = await runBuilderGate(c, id, tenantId);
 *   if (gate) return gate;
 */
async function runBuilderGate(
    c: Context<HonoConfig>,
    id: string,
    tenantId: string,
) {
    const insp = await drizzle(c.env.DB)
        .select({ reportStatus: inspections.reportStatus })
        .from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
        .get();
    if (!insp || !isReportPublished(insp.reportStatus)) {
        return c.json(
            { success: false as const, error: { code: 'NOT_PUBLISHED', message: 'This report is not published.' } },
            403,
        );
    }

    const cfg = await drizzle(c.env.DB)
        .select({ enableCustomerRepairExport: tenantConfigs.enableCustomerRepairExport })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();
    if (!cfg?.enableCustomerRepairExport) {
        return c.json(
            { success: false as const, error: { code: 'FORBIDDEN', message: 'Repair request is not enabled.' } },
            403,
        );
    }

    return null;
}

// ---------------------------------------------------------------------------
// assertCanEdit error handler
// ---------------------------------------------------------------------------

/**
 * Wraps assertCanEdit: catches Forbidden/NotFound errors thrown by the service
 * and returns an explicit 403/404 json Response so the route handler can
 * `return handleEditGuard(...)` without the error surfacing as a 500.
 */
async function runAssertCanEdit(
    c: Context<HonoConfig>,
    tenantId: string,
    rrId: string,
    creator: import('../services/repair-request.service').Creator,
): Promise<Response | null> {
    try {
        await c.var.services.repairRequest.assertCanEdit(tenantId, rrId, creator);
        return null;
    } catch (err: unknown) {
        // AppError carries a `code` string. Map Forbidden/NotFound to explicit JSON.
        const code = (err as { code?: string }).code ?? '';
        if (code === 'forbidden' || code === 'FORBIDDEN') {
            return c.json({ success: false as const, error: { code: 'FORBIDDEN', message: (err as Error).message ?? 'Forbidden.' } }, 403);
        }
        if (code === 'not_found' || code === 'NOT_FOUND') {
            return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: (err as Error).message ?? 'Not found.' } }, 404);
        }
        // Re-throw unexpected errors.
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

const SourceResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        defects: z.array(z.object({
            findingKey:   z.string(),
            sectionId:    z.string(),
            sectionTitle: z.string(),
            itemId:       z.string(),
            itemLabel:    z.string(),
            comment:      z.string(),
            category:     z.enum(['safety', 'recommendation', 'maintenance']),
        })).describe('Flattened repair-rated defects from the published report.'),
        mine: z.array(z.any()).describe('Caller\'s existing repair requests for this inspection.'),
    }),
});

const sourceRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/repair-builder/{tenant}/{id}/source',
    tags:    ['inspections', 'public'],
    summary: 'Repair builder source: defects + caller\'s existing requests',
    request: {
        params: z.object({
            tenant: z.string().describe('Tenant slug (display only; tenant resolved from token).'),
            id:     z.string().describe('Inspection id.'),
        }),
        query: z.object({
            token: z.string().optional().describe('Portal access token.'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SourceResponseSchema } },
            description: 'Defect list + caller repair requests',
        },
        401: { description: 'No valid access credential' },
        403: { description: 'Report not published or tenant feature disabled' },
    },
    operationId: 'getRepairBuilderSource',
    description:
        'Returns flattened defects from a published report plus the caller\'s existing ' +
        'repair requests. Requires a portal token, legacy agent-view token, or owner-preview ' +
        'session. Report must be published and tenant must have enabled the feature.',
}, { scopes: [], tier: 'extended' }));

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CRUD route schemas
// ---------------------------------------------------------------------------

const BuilderParamsSchema = z.object({
    tenant: z.string().describe('Tenant slug (display only; tenant resolved from token).'),
    id:     z.string().describe('Inspection id.'),
});

const BuilderListParamsSchema = BuilderParamsSchema.extend({
    rrId: z.string().describe('Repair request id.'),
});

const BuilderItemParamsSchema = BuilderListParamsSchema.extend({
    itemId: z.string().describe('Repair request item id.'),
});

const BuilderQuerySchema = z.object({
    token: z.string().optional().describe('Portal access token.'),
});

const ItemBodySchema = z.object({
    findingKey:           z.string(),
    sectionTitle:         z.string(),
    itemLabel:            z.string(),
    commentSnapshot:      z.string().nullable().optional(),
    requestedCreditCents: z.number().int().min(0).nullable().optional(),
    note:                 z.string().nullable().optional(),
});

const ItemPatchSchema = z.object({
    requestedCreditCents: z.number().int().min(0).optional(),
    note:                 z.string().optional(),
    sortOrder:            z.number().int().optional(),
});

const IntroPatchSchema = z.object({
    customIntro: z.string().nullable().optional(),
});

// Route definitions
const createListRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/repair-builder/{tenant}/{id}',
    tags:    ['inspections', 'public'],
    summary: 'Create a new repair request list for an inspection',
    request: {
        params: BuilderParamsSchema,
        query:  BuilderQuerySchema,
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.any() }) } }, description: 'Created repair request' },
        401: { description: 'No valid access credential' },
        403: { description: 'Report not published or tenant feature disabled' },
    },
    operationId: 'createRepairList',
    description: 'Creates a new repair request list scoped to the calling creator.',
}, { scopes: ['write'], tier: 'extended' }));

const getListRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/repair-builder/{tenant}/{id}/lists/{rrId}',
    tags:    ['inspections', 'public'],
    summary: 'Get a repair request list with items and credit total',
    request: {
        params: BuilderListParamsSchema,
        query:  BuilderQuerySchema,
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.any() }) } }, description: 'Repair request + items + creditTotal' },
        401: { description: 'No valid access credential' },
        403: { description: 'Report not published or tenant feature disabled' },
        404: { description: 'Repair request not found' },
    },
    operationId: 'getRepairList',
    description: 'Returns a repair request with its items and summed credit total.',
}, { scopes: ['read'], tier: 'extended' }));

const addItemRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/repair-builder/{tenant}/{id}/lists/{rrId}/items',
    tags:    ['inspections', 'public'],
    summary: 'Add an item to a repair request list',
    request: {
        params: BuilderListParamsSchema,
        query:  BuilderQuerySchema,
        body:   { content: { 'application/json': { schema: ItemBodySchema } }, required: true },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.any() }) } }, description: 'Added item' },
        400: { description: 'Validation error' },
        401: { description: 'No valid access credential' },
        403: { description: 'Not the creator or report not published' },
    },
    operationId: 'addRepairItem',
    description: 'Adds a defect item to the caller\'s repair request. Creator-auth enforced.',
}, { scopes: ['write'], tier: 'extended' }));

const updateItemRoute = createRoute(withMcpMetadata({
    method:  'patch',
    path:    '/repair-builder/{tenant}/{id}/lists/{rrId}/items/{itemId}',
    tags:    ['inspections', 'public'],
    summary: 'Update a repair request item (credit, note, sortOrder)',
    request: {
        params: BuilderItemParamsSchema,
        query:  BuilderQuerySchema,
        body:   { content: { 'application/json': { schema: ItemPatchSchema } }, required: true },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Updated' },
        400: { description: 'Validation error' },
        401: { description: 'No valid access credential' },
        403: { description: 'Not the creator or report not published' },
    },
    operationId: 'updateRepairItem',
    description: 'Patches requestedCreditCents, note, and/or sortOrder on an item. Creator-auth enforced.',
}, { scopes: ['write'], tier: 'extended' }));

const removeItemRoute = createRoute(withMcpMetadata({
    method:  'delete',
    path:    '/repair-builder/{tenant}/{id}/lists/{rrId}/items/{itemId}',
    tags:    ['inspections', 'public'],
    summary: 'Remove an item from a repair request list',
    request: {
        params: BuilderItemParamsSchema,
        query:  BuilderQuerySchema,
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Deleted' },
        401: { description: 'No valid access credential' },
        403: { description: 'Not the creator or report not published' },
    },
    operationId: 'removeRepairItem',
    description: 'Removes an item from the caller\'s repair request. Creator-auth enforced.',
}, { scopes: ['write'], tier: 'extended' }));

const setIntroRoute = createRoute(withMcpMetadata({
    method:  'patch',
    path:    '/repair-builder/{tenant}/{id}/lists/{rrId}',
    tags:    ['inspections', 'public'],
    summary: 'Set or clear the custom intro for a repair request list',
    request: {
        params: BuilderListParamsSchema,
        query:  BuilderQuerySchema,
        body:   { content: { 'application/json': { schema: IntroPatchSchema } }, required: true },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Updated' },
        401: { description: 'No valid access credential' },
        403: { description: 'Not the creator or report not published' },
    },
    operationId: 'setRepairIntro',
    description: 'Sets or clears the customIntro field on a repair request. Creator-auth enforced.',
}, { scopes: ['write'], tier: 'extended' }));

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const repairBuilderRoutes = createApiRouter()
    .openapi(sourceRoute, async (c) => {
        const { id } = c.req.valid('param');

        // --- Auth gate ---
        const access = await resolveBuilderAccess(c, id);
        if (!access) {
            return c.json(
                { success: false as const, error: { code: 'UNAUTHORIZED', message: 'No access.' } },
                401,
            );
        }
        const { tenantId, creator } = access;

        // --- Publish + tenant-flag gate ---
        const gateResult = await runBuilderGate(c, id, tenantId);
        if (gateResult) return gateResult;

        // --- Data fetch ---
        const [defects, mine] = await Promise.all([
            flattenReportDefects(c.var.services.inspection, id, tenantId),
            c.var.services.repairRequest.listMine(tenantId, id, creator),
        ]);

        return c.json({ success: true as const, data: { defects, mine } }, 200);
    })

    // POST /repair-builder/:tenant/:id — create list
    .openapi(createListRoute, async (c) => {
        const { id } = c.req.valid('param');

        const access = await resolveBuilderAccess(c, id);
        if (!access) return c.json({ success: false as const, error: { code: 'UNAUTHORIZED', message: 'No access.' } }, 401);
        const { tenantId, creator } = access;

        const gateResult = await runBuilderGate(c, id, tenantId);
        if (gateResult) return gateResult;

        const rr = await c.var.services.repairRequest.create(tenantId, id, creator);
        return c.json({ success: true as const, data: rr }, 200);
    })

    // GET /repair-builder/:tenant/:id/lists/:rrId — get list + items + creditTotal
    .openapi(getListRoute, async (c) => {
        const { id, rrId } = c.req.valid('param');

        const access = await resolveBuilderAccess(c, id);
        if (!access) return c.json({ success: false as const, error: { code: 'UNAUTHORIZED', message: 'No access.' } }, 401);
        const { tenantId } = access;

        const gateResult = await runBuilderGate(c, id, tenantId);
        if (gateResult) return gateResult;

        const result = await c.var.services.repairRequest.get(tenantId, rrId);
        if (!result) {
            return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Repair request not found.' } }, 404);
        }
        const creditTotal = await c.var.services.repairRequest.creditTotal(tenantId, rrId);
        return c.json({ success: true as const, data: { request: result.request, items: result.items, creditTotal } }, 200);
    })

    // POST /repair-builder/:tenant/:id/lists/:rrId/items — add item
    .openapi(addItemRoute, async (c) => {
        const { id, rrId } = c.req.valid('param');
        const body = c.req.valid('json');

        const access = await resolveBuilderAccess(c, id);
        if (!access) return c.json({ success: false as const, error: { code: 'UNAUTHORIZED', message: 'No access.' } }, 401);
        const { tenantId, creator } = access;

        const gateResult = await runBuilderGate(c, id, tenantId);
        if (gateResult) return gateResult;

        const guardResult = await runAssertCanEdit(c, tenantId, rrId, creator);
        if (guardResult) return guardResult;

        // Map Zod-output (undefined optional) to service ItemInput (null optional)
        // to satisfy exactOptionalPropertyTypes.
        const item = await c.var.services.repairRequest.addItem(tenantId, rrId, {
            findingKey:           body.findingKey,
            sectionTitle:         body.sectionTitle,
            itemLabel:            body.itemLabel,
            commentSnapshot:      body.commentSnapshot ?? null,
            requestedCreditCents: body.requestedCreditCents ?? null,
            note:                 body.note ?? null,
        });
        return c.json({ success: true as const, data: item }, 200);
    })

    // PATCH /repair-builder/:tenant/:id/lists/:rrId/items/:itemId — update item
    .openapi(updateItemRoute, async (c) => {
        const { id, rrId, itemId } = c.req.valid('param');
        const body = c.req.valid('json');

        const access = await resolveBuilderAccess(c, id);
        if (!access) return c.json({ success: false as const, error: { code: 'UNAUTHORIZED', message: 'No access.' } }, 401);
        const { tenantId, creator } = access;

        const gateResult = await runBuilderGate(c, id, tenantId);
        if (gateResult) return gateResult;

        const guardResult = await runAssertCanEdit(c, tenantId, rrId, creator);
        if (guardResult) return guardResult;

        // Map Zod-output optional fields to service patch type (null not undefined).
        const patch: Parameters<typeof c.var.services.repairRequest.updateItem>[3] = {};
        if (body.requestedCreditCents !== undefined) patch.requestedCreditCents = body.requestedCreditCents ?? null;
        if (body.note !== undefined) patch.note = body.note ?? null;
        if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
        await c.var.services.repairRequest.updateItem(tenantId, rrId, itemId, patch);
        return c.json({ success: true as const }, 200);
    })

    // DELETE /repair-builder/:tenant/:id/lists/:rrId/items/:itemId — remove item
    .openapi(removeItemRoute, async (c) => {
        const { id, rrId, itemId } = c.req.valid('param');

        const access = await resolveBuilderAccess(c, id);
        if (!access) return c.json({ success: false as const, error: { code: 'UNAUTHORIZED', message: 'No access.' } }, 401);
        const { tenantId, creator } = access;

        const gateResult = await runBuilderGate(c, id, tenantId);
        if (gateResult) return gateResult;

        const guardResult = await runAssertCanEdit(c, tenantId, rrId, creator);
        if (guardResult) return guardResult;

        await c.var.services.repairRequest.removeItem(tenantId, rrId, itemId);
        return c.json({ success: true as const }, 200);
    })

    // PATCH /repair-builder/:tenant/:id/lists/:rrId — set/clear intro
    .openapi(setIntroRoute, async (c) => {
        const { id, rrId } = c.req.valid('param');
        const { customIntro } = c.req.valid('json');

        const access = await resolveBuilderAccess(c, id);
        if (!access) return c.json({ success: false as const, error: { code: 'UNAUTHORIZED', message: 'No access.' } }, 401);
        const { tenantId, creator } = access;

        const gateResult = await runBuilderGate(c, id, tenantId);
        if (gateResult) return gateResult;

        const guardResult = await runAssertCanEdit(c, tenantId, rrId, creator);
        if (guardResult) return guardResult;

        await c.var.services.repairRequest.setIntro(tenantId, rrId, customIntro ?? null);
        return c.json({ success: true as const }, 200);
    });

export type RepairBuilderApi = typeof repairBuilderRoutes;

export default repairBuilderRoutes;
