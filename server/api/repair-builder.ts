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

        // --- Publish gate ---
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

        // --- Tenant flag gate ---
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

        // --- Data fetch ---
        const [defects, mine] = await Promise.all([
            flattenReportDefects(c.var.services.inspection, id, tenantId),
            c.var.services.repairRequest.listMine(tenantId, id, creator),
        ]);

        return c.json({ success: true as const, data: { defects, mine } }, 200);
    });

export type RepairBuilderApi = typeof repairBuilderRoutes;

export default repairBuilderRoutes;
