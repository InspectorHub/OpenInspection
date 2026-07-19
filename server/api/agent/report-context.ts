import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { logger } from '../../lib/logger';
import { resolvePortalAccess } from '../../lib/public-access';
import { MagicLoginRequestSchema } from '../../lib/validations/agent-magic-login.schema';
import { AgentReportContextResponseSchema } from '../../lib/validations/agent-report-context.schema';

/**
 * Spec 3 Task 3 — read-only probe the portal report-landing BFF loader
 * (app/routes/public/portal-inspection.tsx) calls with the SAME durable
 * report token the report itself renders under, to decide which CTA to show
 * below the report: "Go to my workspace" (an agent account already exists —
 * routes through POST /api/agent/magic-login/request) vs "Create your free
 * agent account" (signup CTA).
 *
 * Public/unauthenticated (the caller holds a report token, never a session) —
 * must be allowlisted past the global JWT middleware exactly like
 * POST /api/agent/magic-login/request (server/index.ts `isAgentPublic`).
 *
 * Unlike magic-login/request, an invalid/expired/mismatched token or a
 * non-agent-kind token is NOT an error here — this is a context probe for a
 * page that must keep rendering the report regardless, so every outcome
 * replies 200; a bad token just yields `kind: null` (no CTA shown).
 */
const reportContextRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/report-context',
    tags: ['agents', 'public'],
    summary: 'Resolve a report token\'s role kind + agent-account status',
    description: 'Public, unauthenticated read-only probe for the portal report-landing BFF loader. Resolves the report token to a role kind and, for agent-kind tokens only, whether a global agent account exists for the recipient email. A bad/expired/mismatched token replies 200 with kind: null rather than 401 — this is a context probe, not an auth check.',
    request: {
        body: { content: { 'application/json': { schema: MagicLoginRequestSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AgentReportContextResponseSchema } },
            description: 'Resolved kind (+ recipientEmail/hasAccount for agent-kind tokens), or kind: null for an invalid token',
        },
    },
    operationId: 'getAgentReportContext',
}, { scopes: [], tier: 'excluded' }));

/** POST /api/agent/report-context — mounted under the /api/agent router group. */
export const agentReportContextRoutes = createApiRouter()
    .openapi(reportContextRoute, async (c) => {
        const body = c.req.valid('json');
        try {
            const grant = await resolvePortalAccess(c.var.services.portalAccess, body.token, body.inspectionId);
            if (!grant) {
                return c.json({ success: true as const, data: { kind: null } }, 200);
            }

            // SECURITY: resolve `kind` from the grant's ISSUING tenant (never the
            // caller-supplied `tenant` field) — mirrors requestMagicLogin's own
            // kindForKey call (server/services/agent/magic-login.service.ts).
            const kind = await c.var.services.people.kindForKey(grant.tenantId, grant.role);
            if (kind !== 'agent') {
                return c.json({ success: true as const, data: { kind } }, 200);
            }

            // Anti-oracle note (deliberate, safe): returning recipientEmail to the
            // holder of THIS specific valid token is not enumeration — the caller
            // already IS that recipient (they presented the token that resolves to
            // it). No side effects here (read-only probe), so no audit log.
            const hasAccount = await c.var.services.agent.accountExistsForEmail(grant.recipientEmail);
            return c.json({
                success: true as const,
                data: { kind: 'agent' as const, recipientEmail: grant.recipientEmail, hasAccount },
            }, 200);
        } catch (err) {
            logger.error(
                'agent.report_context.failed',
                { inspectionId: body.inspectionId },
                err instanceof Error ? err : undefined,
            );
            return c.json({ success: true as const, data: { kind: null } }, 200);
        }
    });
