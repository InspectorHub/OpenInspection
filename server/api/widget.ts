import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const recordEventRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/event',
    tags: ["webhooks"],
    summary: 'Record an embeddable widget event (public, no JWT)',
    middleware: [] as const,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        event: z.enum(['view', 'submit', 'success', 'error']).describe('TODO describe event field for the OpenInspection MCP integration'),
                        metadata: z.record(z.string(), z.unknown()).optional().describe('TODO describe metadata field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Recorded',
        },
    },
    operationId: "createWidgetEvent",
    description: "Auto-generated placeholder for createWidgetEvent (POST /event, webhooks domain). TODO: replace with a real description sourced from the handler."
}, { scopes: [], tier: 'excluded' }));

const widgetRoutes = createApiRouter()
    .openapi(recordEventRoute, async (c) => {
        const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
        if (!tenantId) {
            return c.json({ success: true }, 200);
        }
        const origin = c.req.header('origin');
        const ok = await c.var.services.widget.isOriginAllowed(tenantId, origin ?? null);
        if (!ok) {
            // Silently drop unauthorised events (no signal for attackers, no DB noise)
            return c.json({ success: true }, 200);
        }
        const { event, metadata } = c.req.valid('json');
        await c.var.services.widget.recordEvent(tenantId, event, { ...(metadata ?? {}), origin });
        return c.json({ success: true }, 200);
    });

export type WidgetApi = typeof widgetRoutes;
export default widgetRoutes;
