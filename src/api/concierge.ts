import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { agreementSignPath } from '../lib/public-urls';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const conciergeRoutes = new OpenAPIHono<HonoConfig>();

/**
 * Agent Accounts A3 — POST /api/concierge/confirm
 *
 * Public endpoint (no JWT). Client redeems the magic-link token. Service
 * verifies validity, transitions inspection state, and (when agreementRequired)
 * chains into the standard e-sign flow by minting an agreement_request via
 * AgreementService.findOrCreate. Response carries `redirect` so the
 * client-side script can route to the appropriate next step.
 */
const ConfirmBodySchema = z.object({
    token: z.string().min(8).max(128).describe('TODO describe token field for the OpenInspection MCP integration'),
}).openapi('ConciergeConfirmBody');

const ConfirmResponseSchema = createApiResponseSchema(
    z.object({
        inspectionId: z.string().uuid().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
        redirect:     z.string().describe('TODO describe redirect field for the OpenInspection MCP integration'),
    }),
).openapi('ConciergeConfirmResponse');

const confirmRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/confirm',
    tags: ["bookings"],
    summary: 'Client redeems a concierge magic-link token',
    request: {
        body: { content: { 'application/json': { schema: ConfirmBodySchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ConfirmResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Confirmed — caller redirects to either the agreement signing page or the inspection report',
        },
        400: { description: 'Token expired or already used' },
        404: { description: 'Token not found' },
    },
    operationId: "confirmConcierge",
    description: "Auto-generated placeholder for confirmConcierge (POST /confirm, bookings domain). TODO: replace with a real description sourced from the handler."
}, { scopes: [], tier: 'extended' }));

conciergeRoutes.openapi(confirmRoute, async (c) => {
    const { token } = c.req.valid('json');
    const result = await c.var.services.concierge.confirmByClient(token);

    // Resolve token data again to decide where to send the client. We avoid
    // having confirmByClient itself return the inspection because the service
    // boundary is purely state-machine.
    const view = await c.var.services.concierge.resolveToken(token);

    let redirect = '/';
    if (view) {
        if (view.inspection.agreementRequired) {
            // Chain into the existing e-sign flow: ensure an agreement_request
            // exists for this inspection, then redirect to /agreements/sign/<token>.
            try {
                const agr = await c.var.services.agreement.findOrCreate(
                    view.inspection.tenantId,
                    view.inspection.id,
                );
                redirect = agreementSignPath(view.inspection.tenantSubdomain, agr.token);
            } catch (err) {
                // No template configured — surface a generic thank-you page.
                logger.warn('concierge.findOrCreate.failed', {
                    tenantId: view.inspection.tenantId,
                    inspectionId: view.inspection.id,
                    error: err instanceof Error ? err.message : String(err),
                });
                redirect = `/report/${view.inspection.tenantSubdomain}/${view.inspection.id}`;
            }
        } else {
            // Optimistically redirect to the report viewer; the gate will lock
            // it down if the inspection is still pending.
            redirect = `/report/${view.inspection.tenantSubdomain}/${view.inspection.id}`;
        }
    }

    return c.json({
        success: true as const,
        data: { inspectionId: result.inspectionId, redirect },
    }, 200);
});

export default conciergeRoutes;

// Re-export Errors so callers don't need a separate import.
export { Errors };
