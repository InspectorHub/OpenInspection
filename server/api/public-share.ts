// Public, no-auth endpoint that mints a 30-day view-only share token for a
// delivered inspection report. Surfaces UC-C-7 (customer forwards report) on
// the public /report/:id viewer's Share button.
//
// Reuses InspectionService.generateAgentViewToken — the underlying KV token
// is generic (`agent_view_token:<token>` → `<inspectionId>:<tenantId>`) and
// the existing /report/:id?view=agent&token=<t> resolution path already
// validates it. Calling it `share-token` here is just nomenclature; one
// service method serves both inspector- and customer-side share flows.

import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { resolvePortalAccess } from '../lib/public-access';
import { isReportPublished } from '../lib/status/report-status';
import { logger } from '../lib/logger';
import { sendSuccess } from '../lib/response';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const shareTokenRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/inspections/{id}/share-token',
    tags: ["inspections", "public"],
    summary: 'Mint a 30-day view-only share token (customer-initiated)',
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        // The caller MUST prove it can already see this report: the persistent
        // portal token (or legacy agent-view token) carried by the report page
        // it is forwarding from. Without this proof, knowing the inspection UUID
        // would be enough to mint a full-report link — defeating the per-recipient
        // tokenized-link model.
        query: z.object({ token: z.string().optional().describe('The caller\'s existing portal/agent-view access token for this inspection.') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
                data: z.object({ token: z.string().describe('TODO describe token field for the OpenInspection MCP integration'), url: z.string().describe('TODO describe url field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
            }) } },
            description: 'Share URL minted',
        },
        403: { description: 'Report not delivered yet' },
        404: { description: 'Inspection not found' },
    },
    operationId: "createPublicShareInspectionsShareToken",
    description: "Auto-generated placeholder for createPublicShareInspectionsShareToken (POST /inspections/{id}/share-token, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: [], tier: 'extended' }));

const publicShareRoutes = createApiRouter()
    .openapi(shareTokenRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { token } = c.req.valid('query');

        // Authorize by an EXISTING access proof for THIS inspection — the same
        // portal token (or legacy agent-view bridge) the report-data endpoints
        // accept — and take the AUTHORITATIVE tenantId from it. The tenant is no
        // longer trusted from the URL-derived middleware value, which provided no
        // protection (it was resolved from the inspection id itself).
        let tenantId = (await resolvePortalAccess(c.var.services.portalAccess, token, id))?.tenantId ?? null;
        if (!tenantId && token) {
            const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
            if (legacy && legacy.inspectionId === id) tenantId = legacy.tenantId;
        }
        if (!tenantId) throw Errors.NotFound('Inspection not found');

        const db = drizzle(c.env.DB);
        const insp = await db.select({
            status: inspections.status,
            reportStatus: inspections.reportStatus,
        }).from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) throw Errors.NotFound('Inspection not found');
        if (!isReportPublished(insp.reportStatus)) {
            throw Errors.Forbidden('Report has not been published yet');
        }

        const shareToken = await c.var.services.inspection.generateAgentViewToken(tenantId, id);
        const baseUrl = c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`;
        const tenantSlug = c.get('requestedTenantSlug') ?? '';
        const url = `${baseUrl}/report/${tenantSlug}/${id}?view=agent&token=${shareToken}`;
        logger.info('Public share-token minted', { inspectionId: id, tenantId });
        return sendSuccess(c, { token: shareToken, url });
    });

export type PublicShareApi = typeof publicShareRoutes;

export default publicShareRoutes;
