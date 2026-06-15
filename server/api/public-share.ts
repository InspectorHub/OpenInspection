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
import { isReportPublished } from '../lib/status/report-status';
import { logger } from '../lib/logger';
import { sendSuccess } from '../lib/response';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const shareTokenRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/inspections/{id}/share-token',
    tags: ["inspections", "public"],
    summary: 'Mint a 30-day view-only share token (customer-initiated)',
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
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

export const publicShareRoutes = createApiRouter()
    .openapi(shareTokenRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = (c.get('tenantId') || c.get('resolvedTenantId')) as string | null;
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

        const token = await c.var.services.inspection.generateAgentViewToken(tenantId, id);
        const baseUrl = c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`;
        const tenantSlug = c.get('requestedTenantSlug') ?? '';
        const url = `${baseUrl}/report/${tenantSlug}/${id}?view=agent&token=${token}`;
        logger.info('Public share-token minted', { inspectionId: id, tenantId });
        return sendSuccess(c, { token, url });
    });

export type PublicShareApi = typeof publicShareRoutes;

export default publicShareRoutes;
