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
                        event: z.enum(['view', 'submit', 'success', 'error']).describe('What happened in the widget: it was viewed, the form was submitted, the booking succeeded, or the widget hit an error.'),
                        metadata: z.record(z.string(), z.unknown()).optional().describe('Free-form details about the event, stored with it as sent. Optional.'),
                    }).describe('The widget event to record, with optional free-form details.'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration') }),
                },
            },
            description: 'Recorded',
        },
    },
    operationId: "createWidgetEvent",
    description: "Public, unauthenticated beacon that the embedded booking widget calls from a visitor's browser to report what happened in the widget. The company is resolved from the request's tenant context, and the event is recorded as a widget.<event> entry in that company's audit log only when the request's Origin header matches the company's widget origin allowlist. Anything else (no company, no Origin header, empty allowlist, origin not on the list) is dropped silently and still answers 200 with success true, so a 200 does not prove the event was stored. The submitted metadata is stored as sent, together with the origin. Not idempotent: each accepted call adds an entry."
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
