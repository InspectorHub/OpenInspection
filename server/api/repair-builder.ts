/**
 * Interactive Repair Request Builder — routes.
 *
 * GET /api/public/repair-builder/:tenant/:id/source
 *
 * Returns the flattened defect list from the published report plus the
 * caller's existing repair requests for this inspection. Gated by:
 *   1. Auth  — portal token / legacy agent-view KV token / owner-preview JWT
 *   2. Publish — inspections.reportStatus must be 'published'
 *   3. Tenant  — tenant_configs.enable_customer_repair_export must be true
 *
 * Mounted in index.ts. All CRUD routes are scoped to (tenantId, inspectionId)
 * to prevent cross-inspection reads within the same tenant.
 */

import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, tenantConfigs } from '../lib/db/schema';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { resolvePortalAccess, resolveOwnerPreviewFull, resolveAgentSession } from '../lib/public-access';
import { isReportPublished } from '../lib/status/report-status';
import { flattenReportDefects } from '../lib/repair-defects';
import { generatePdfFromUrl } from '../lib/pdf';
import { checkRateLimit } from '../lib/rate-limit';
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
 *   agent     → the raw legacy KV token string, OR the agent's stable userId when
 *               authenticated via a logged-in agent-portal session JWT
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

    // Path 3: owner-preview via session Bearer JWT (tenant user / inspector).
    const ownerFull = await resolveOwnerPreviewFull(c);
    if (ownerFull) {
        const creator: Creator = { kind: 'inspector', ref: ownerFull.userId };
        return { tenantId: ownerFull.tenantId, creator, ownerPreview: true };
    }

    // Path 4: logged-in agent-portal session JWT (tokenless dashboard link).
    // The agent JWT classifies as kind:'agent' and carries NO tenantId, so it is
    // rejected by owner-preview above. Verify the session, then confirm the agent
    // is actually associated with THIS inspection — deriving the tenantId from the
    // inspection row, never from the URL `:tenant` segment.
    const agentSession = await resolveAgentSession(c);
    if (agentSession) {
        const access = await c.var.services.agent.accessToInspection(agentSession.userId, id);
        if (access) {
            const creator: Creator = { kind: 'agent', ref: agentSession.userId };
            return { tenantId: access.tenantId, creator, ownerPreview: false };
        }
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
    inspectionId: string,
    rrId: string,
    creator: import('../services/repair-request.service').Creator,
): Promise<Response | null> {
    try {
        await c.var.services.repairRequest.assertCanEdit(tenantId, inspectionId, rrId, creator);
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
    findingKey:           z.string().describe('Stable per-defect key from the report source list.'),
    sectionTitle:         z.string().describe('Report section title snapshot for this defect.'),
    itemLabel:            z.string().describe('Report item label snapshot for this defect.'),
    commentSnapshot:      z.string().nullable().optional().describe('Defect comment text snapshot at add time.'),
    requestedCreditCents: z.number().int().min(0).nullable().optional().describe('Requested repair credit in integer cents.'),
    note:                 z.string().nullable().optional().describe('Buyer note explaining the requested credit.'),
});

const ItemPatchSchema = z.object({
    requestedCreditCents: z.number().int().min(0).optional().describe('Requested repair credit in integer cents.'),
    note:                 z.string().optional().describe('Buyer note explaining the requested credit.'),
    sortOrder:            z.number().int().optional().describe('Display order of this item in the list.'),
});

const IntroPatchSchema = z.object({
    customIntro: z.string().nullable().optional().describe('Document-level intro shown atop the repair request.'),
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
// Share routes — public (shareToken IS the credential), publish-gated
// ---------------------------------------------------------------------------

/**
 * Share gate: look up the repair request by shareToken, then check that its
 * inspection is currently published. Returns a structured result on success,
 * or a Response (403/404) on failure.
 *
 * Also fetches `propertyAddress` so callers don't need a second query.
 */
async function runShareGate(
    c: Context<HonoConfig>,
    shareToken: string,
): Promise<
    | {
          request: { id: string; tenantId: string; inspectionId: string; customIntro: string | null };
          items: unknown[];
          tenantId: string;
          propertyAddress: string | null;
      }
    | Response
> {
    const result = await c.var.services.repairRequest.getByShareToken(shareToken);
    if (!result) {
        return c.json(
            { success: false as const, error: { code: 'NOT_FOUND', message: 'Repair request not found.' } },
            404,
        );
    }

    const { request, items } = result;
    const insp = await drizzle(c.env.DB)
        .select({ reportStatus: inspections.reportStatus, propertyAddress: inspections.propertyAddress })
        .from(inspections)
        .where(and(eq(inspections.id, request.inspectionId), eq(inspections.tenantId, request.tenantId)))
        .get();

    if (!insp || !isReportPublished(insp.reportStatus)) {
        return c.json(
            { success: false as const, error: { code: 'NOT_PUBLISHED', message: 'This report is not published.' } },
            403,
        );
    }

    return {
        request,
        items,
        tenantId: request.tenantId,
        propertyAddress: insp.propertyAddress ?? null,
    };
}

/** Derive the absolute base URL from env or the incoming Host header. */
function getBaseUrl(c: Context<HonoConfig>): string {
    return (c.env.APP_BASE_URL || '').replace(/\/$/, '')
        || (c.req.header('host') ? `https://${c.req.header('host')}` : '');
}

// Share route schemas

const ShareTokenParamsSchema = z.object({
    shareToken: z.string().describe('Opaque share token for the repair request.'),
});

const ShareViewResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        propertyAddress: z.string().nullable(),
        customIntro:     z.string().nullable(),
        items:           z.array(z.any()),
        creditTotal:     z.number(),
    }),
});

const ShareEmailBodySchema = z.object({
    to:      z.string().email('Invalid email address').describe('Recipient email address for the share link.'),
    message: z.string().optional().describe('Optional personal message included in the email.'),
});

const shareViewRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/repair-request/share/{shareToken}',
    tags:    ['inspections', 'public'],
    summary: 'Public share view of a repair request (publish-gated)',
    request: { params: ShareTokenParamsSchema },
    responses: {
        200: { content: { 'application/json': { schema: ShareViewResponseSchema } }, description: 'Repair request share view' },
        403: { description: 'Report not published' },
        404: { description: 'Unknown share token' },
    },
    operationId: 'getRepairRequestShareView',
    description: 'Returns the property address, custom intro, items, and credit total for a shared repair request. No login required; shareToken is the credential. Report must be published.',
}, { scopes: [], tier: 'extended' }));

const sharePdfRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/repair-request/share/{shareToken}/pdf',
    tags:    ['inspections', 'public'],
    summary: 'Download a PDF of a shared repair request (publish-gated)',
    request: { params: ShareTokenParamsSchema },
    responses: {
        200: { description: 'PDF binary' },
        403: { description: 'Report not published' },
        404: { description: 'Unknown share token' },
    },
    operationId: 'getRepairRequestSharePdf',
    description: 'Renders a PDF of the repair request share page via Browser Rendering. Report must be published.',
}, { scopes: [], tier: 'extended' }));

const shareEmailRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/repair-request/share/{shareToken}/email',
    tags:    ['inspections', 'public'],
    summary: 'Email a shared repair request link (publish-gated)',
    request: {
        params: ShareTokenParamsSchema,
        body:   { content: { 'application/json': { schema: ShareEmailBodySchema } }, required: true },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Email sent' },
        400: { description: 'Invalid request body' },
        403: { description: 'Report not published' },
        404: { description: 'Unknown share token' },
    },
    operationId: 'emailRepairRequestShare',
    description: 'Sends the share URL to a contractor or other recipient. Rate-limited. Report must be published.',
}, { scopes: [], tier: 'extended' }));

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
        // B1: use listMineWithItems so mine[].items is populated and the builder
        // page can rehydrate initialSelected/initialDrafts/initialItemIds on reload
        // without re-adding items (which would inflate creditTotal).
        const [defects, mine] = await Promise.all([
            flattenReportDefects(c.var.services.inspection, id, tenantId),
            c.var.services.repairRequest.listMineWithItems(tenantId, id, creator),
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

        // I1: scope get() to (tenantId, inspectionId) so a rrId from a different
        // inspection within the same tenant is rejected with 404.
        const result = await c.var.services.repairRequest.get(tenantId, id, rrId);
        if (!result) {
            return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Repair request not found.' } }, 404);
        }
        const creditTotal = await c.var.services.repairRequest.creditTotal(tenantId, id, rrId);
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

        // I1: pass inspectionId so assertCanEdit rejects RRs from a different inspection.
        const guardResult = await runAssertCanEdit(c, tenantId, id, rrId, creator);
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

        // I1: pass inspectionId so assertCanEdit rejects RRs from a different inspection.
        const guardResult = await runAssertCanEdit(c, tenantId, id, rrId, creator);
        if (guardResult) return guardResult;

        // Map Zod-output optional fields to service patch type (null not undefined).
        const patch: Parameters<typeof c.var.services.repairRequest.updateItem>[4] = {};
        if (body.requestedCreditCents !== undefined) patch.requestedCreditCents = body.requestedCreditCents ?? null;
        if (body.note !== undefined) patch.note = body.note ?? null;
        if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
        // I1: pass inspectionId so the service guards against cross-inspection writes.
        await c.var.services.repairRequest.updateItem(tenantId, id, rrId, itemId, patch);
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

        // I1: pass inspectionId so assertCanEdit rejects RRs from a different inspection.
        const guardResult = await runAssertCanEdit(c, tenantId, id, rrId, creator);
        if (guardResult) return guardResult;

        // I1: pass inspectionId so the service guards against cross-inspection deletes.
        await c.var.services.repairRequest.removeItem(tenantId, id, rrId, itemId);
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

        // I1: pass inspectionId so assertCanEdit rejects RRs from a different inspection.
        const guardResult = await runAssertCanEdit(c, tenantId, id, rrId, creator);
        if (guardResult) return guardResult;

        // I1: pass inspectionId so the service guards against cross-inspection writes.
        await c.var.services.repairRequest.setIntro(tenantId, id, rrId, customIntro ?? null);
        return c.json({ success: true as const }, 200);
    })

    // -------------------------------------------------------------------------
    // Share routes (Task 5) — public, publish-gated
    // -------------------------------------------------------------------------

    // GET /repair-request/share/:shareToken — share view data
    .openapi(shareViewRoute, async (c) => {
        const { shareToken } = c.req.valid('param');

        const gateResult = await runShareGate(c, shareToken);
        if (gateResult instanceof Response) return gateResult;

        const { request, items, tenantId, propertyAddress } = gateResult;
        // Share routes use the RR's own inspectionId (already validated by runShareGate).
        const creditTotal = await c.var.services.repairRequest.creditTotal(tenantId, request.inspectionId, request.id);

        return c.json({
            success: true as const,
            data: {
                propertyAddress,
                customIntro: request.customIntro,
                items,
                creditTotal,
            },
        }, 200);
    })

    // GET /repair-request/share/:shareToken/pdf — render PDF
    .openapi(sharePdfRoute, async (c) => {
        const { shareToken } = c.req.valid('param');

        const gateResult = await runShareGate(c, shareToken);
        if (gateResult instanceof Response) return gateResult;

        const baseUrl = getBaseUrl(c);
        const pageUrl = `${baseUrl}/repair-request/${shareToken}`;
        const pdfBuffer = await generatePdfFromUrl(c.env.BROWSER, pageUrl);

        return new Response(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="repair-request.pdf"',
            },
        });
    })

    // POST /repair-request/share/:shareToken/email — send share link
    .openapi(shareEmailRoute, async (c) => {
        const { shareToken } = c.req.valid('param');
        const body = c.req.valid('json');

        const gateResult = await runShareGate(c, shareToken);
        if (gateResult instanceof Response) return gateResult;

        const { propertyAddress } = gateResult;

        await checkRateLimit(c, 'book');

        const baseUrl = getBaseUrl(c);
        const shareUrl = `${baseUrl}/repair-request/${shareToken}`;
        const safeAddress = escapeHtmlShare(propertyAddress || 'your property');
        const safeMessage = body.message
            ? escapeHtmlShare(body.message).replace(/\n/g, '<br/>')
            : '';

        const html = `
            <div style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
                <p style="font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: #64748b; margin: 0 0 4px;">Repair Request</p>
                <h1 style="font-size: 22px; line-height: 1.25; font-weight: 600; margin: 0 0 16px;">${safeAddress}</h1>
                <p style="font-size: 14px; line-height: 1.5; color: #475569;">
                    A repair request list has been shared with you. Click the link below to review the items.
                </p>
                ${safeMessage ? `
                <div style="margin-top: 20px; padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
                    <p style="font-size: 11px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: #64748b; margin: 0 0 8px;">Message</p>
                    <p style="font-size: 14px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${safeMessage}</p>
                </div>` : ''}
                <p style="margin-top: 24px;">
                    <a href="${shareUrl}" style="display: inline-block; padding: 10px 16px; background: #0f172a; color: white; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 700;">View repair request</a>
                </p>
            </div>
        `;

        await c.var.services.email.sendEmail(
            [body.to],
            `Repair request — ${propertyAddress || 'your property'}`,
            html,
        );

        return c.json({ success: true as const }, 200);
    });

function escapeHtmlShare(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export type RepairBuilderApi = typeof repairBuilderRoutes;

export default repairBuilderRoutes;
