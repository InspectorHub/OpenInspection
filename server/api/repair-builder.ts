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
 *
 * SCOPED TO THE ORDER, ACROSS ALL ITS PUBLISHED REPORTS. An order can deliver
 * several documents, and a client negotiating repairs does not care which one a
 * defect came from — they are negotiating about one house. So the defect list is
 * gathered per inspection, not per report, and stays that way: splitting it
 * would make the client assemble their own list from two or three documents
 * before they could ask for anything.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { flattenReportDefects } from '../lib/repair-defects';
import { generatePdfFromUrl } from '../lib/pdf';
import { checkRateLimit } from '../lib/rate-limit';
import { resolveBuilderAccess } from '../lib/repair-access';
import { runBuilderGate, runAssertCanEdit, runShareGate, getBaseUrl, loadQuickPhrases } from '../lib/repair-gates';
import {
    shareViewRoute,
    sharePdfRoute,
    shareEmailRoute,
} from './repair-builder/share';
import {
    createListRoute,
    getListRoute,
    addItemRoute,
    updateItemRoute,
    removeItemRoute,
    setIntroRoute,
} from './repair-builder/crud-routes';

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
            defectTitle:  z.string(),
            comment:      z.string(),
            location:     z.string().nullable(),
            category:     z.enum(['safety', 'recommendation', 'maintenance']),
            severityBucket: z.enum(['satisfactory', 'monitor', 'defect', 'other']),
            trade:        z.string().nullable(),
            // No estimateLow/estimateHigh. This payload feeds a surface whose
            // only money field is the client's own credit request, so shipping
            // the report's cost figures here just puts a number the inspection
            // company appears to stand behind next to that field.
        })).describe('Flattened repair-rated defects from the published report. Carries no cost estimate: the repair builder is pure-credit.'),
        mine: z.array(z.any()).describe('Caller\'s existing repair requests for this inspection.'),
        // #275 — the ONLY tenant-config value this public, token-authenticated
        // route exposes. Whitelisted field by field on purpose: the rest of the
        // config row is not the client's business.
        quickPhrases: z.array(z.string()).nullable().describe('Tenant-configured quick-insert phrases for the note field. null = never configured (the client shows its seeded defaults); [] = the tenant turned the buttons off.'),
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

const repairBuilderRoutes = createApiRouter()
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
        const [defects, mine, quickPhrases] = await Promise.all([
            flattenReportDefects(c.var.services.inspection, id, tenantId),
            c.var.services.repairRequest.listMineWithItems(tenantId, id, creator),
            loadQuickPhrases(c, tenantId),
        ]);

        return c.json({ success: true as const, data: { defects, mine, quickPhrases } }, 200);
    })

    // POST /repair-builder/:tenant/:id — create list
    .openapi(createListRoute, async (c) => {
        const { id } = c.req.valid('param');

        const access = await resolveBuilderAccess(c, id);
        if (!access) return c.json({ success: false as const, error: { code: 'UNAUTHORIZED', message: 'No access.' } }, 401);
        const { tenantId, creator } = access;
        // IA-35 / IA-73 — creating a list is a write; a read-only agent is refused.
        if (access.accessLevel !== 'readwrite') {
            return c.json({ success: false as const, error: { code: 'FORBIDDEN', message: 'Read-only access to the repair list.' } }, 403);
        }

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
        const guardResult = await runAssertCanEdit(c, tenantId, id, rrId, creator, access.accessLevel);
        if (guardResult) return guardResult;

        // Map Zod-output (undefined optional) to service ItemInput (null optional)
        // to satisfy exactOptionalPropertyTypes.
        const item = await c.var.services.repairRequest.addItem(tenantId, rrId, {
            findingKey:           body.findingKey,
            sectionTitle:         body.sectionTitle,
            itemLabel:            body.itemLabel,
            defectTitle:          body.defectTitle ?? null,
            location:             body.location ?? null,
            category:             body.category ?? null,
            trade:                body.trade ?? null,
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
        const guardResult = await runAssertCanEdit(c, tenantId, id, rrId, creator, access.accessLevel);
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
        const guardResult = await runAssertCanEdit(c, tenantId, id, rrId, creator, access.accessLevel);
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
        const guardResult = await runAssertCanEdit(c, tenantId, id, rrId, creator, access.accessLevel);
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

        // The route owns the LINK; the email service owns the email. Building
        // the HTML here is what left this send unbranded, uneditable and
        // unclassified while every registry-backed send was none of those.
        await c.var.services.email.sendRepairRequestShare(body.to, {
            propertyAddress: propertyAddress || '',
            shareUrl: `${baseUrl}/repair-request/${shareToken}`,
            message: body.message,
        });

        return c.json({ success: true as const }, 200);
    });

export type RepairBuilderApi = typeof repairBuilderRoutes;

export default repairBuilderRoutes;
