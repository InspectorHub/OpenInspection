import { createRoute, z } from '@hono/zod-openapi';
import { setCookie } from 'hono/cookie';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getBaseUrl } from '../../lib/url';
import { signJwt } from '../../lib/jwt-keyring';
import { logger } from '../../lib/logger';
import {
    MagicLoginRequestSchema,
    MagicLoginRequestResponseSchema,
} from '../../lib/validations/agent-magic-login.schema';
import { requestMagicLogin, redeemMagicLogin } from '../../services/agent/magic-login.service';

/**
 * Agent unified link (Spec 3, Task 2) — the SEPARATE single-use magic-login
 * primitive layered on top of the durable agent report-link token. The report
 * token (resolvePortalAccess) grants ONLY report viewing and never mints a
 * session; this code is the only thing that mints an agent JWT, and only
 * after verifying a live, non-revoked agent-kind report token for an email
 * that has a global agent account.
 *
 * Two entry points, BOTH public/unauthenticated (the caller holds a report
 * token or a KV code, never a session) — both must be allowlisted past the
 * global JWT middleware (server/index.ts `isAgentPublic`) and, since the
 * redeem path is not under /api, explicitly forwarded to the API app in
 * workers/app.ts (see `/agent/magic-login`).
 */

const requestRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/magic-login/request',
    tags: ['agents', 'public'],
    summary: 'Email an agent a single-use sign-in link for a report token',
    description: 'Public, unauthenticated endpoint for the agent unified link. For a live, agent-kind report-link token whose recipient email has a global agent account, EMAILS a single-use magic-login link (900 second TTL) to that agent\'s account inbox — the link is never returned to the caller, so a leaked/forwarded report link cannot be replayed into a full agent session. Always returns { sent: true } with 200 (identical response and timing whether or not an account exists) so probing tokens cannot enumerate accounts.',
    request: {
        body: { content: { 'application/json': { schema: MagicLoginRequestSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: MagicLoginRequestResponseSchema } },
            description: 'Always { sent: true } — a sign-in link is emailed to the agent when an account exists; nothing is sent otherwise. The link is never returned here.',
        },
        401: { description: 'Invalid, revoked, expired, inspection-mismatched, or non-agent report token' },
    },
    operationId: 'requestAgentMagicLogin',
}, { scopes: [], tier: 'excluded' }));

const redeemRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agent/magic-login',
    tags: ['agents', 'public'],
    summary: 'Redeem a single-use agent magic-login code',
    description: 'Public, unauthenticated endpoint for the agent unified link. Redeems the single-use code minted by POST /api/agent/magic-login/request into an agent session cookie, then redirects into the agent dashboard. A missing, expired, or already-used code redirects to a friendly recovery page instead of surfacing a raw error.',
    request: {
        query: z.object({
            code: z.string().min(1).describe('Single-use magic-login code minted by POST /api/agent/magic-login/request. Expires after 900 seconds and is deleted from KV on the first redeem attempt, success or failure.'),
        }),
    },
    responses: {
        302: { description: 'Redirect to /agent-dashboard on success or /agent-login on failure' },
    },
    operationId: 'redeemAgentMagicLogin',
}, { scopes: [], tier: 'excluded' }));

/** POST /api/agent/magic-login/request — mounted under the /api/agent router group. */
export const agentMagicLoginRequestRoutes = createApiRouter()
    .openapi(requestRoute, async (c) => {
        const body = c.req.valid('json');
        const result = await requestMagicLogin({
            portalAccess: c.var.services.portalAccess,
            kv: c.env.TENANT_CACHE,
            db: c.env.DB,
            inspectionId: body.inspectionId,
            reportToken: body.token,
            coreBaseUrl: getBaseUrl(c),
        });
        // EMAIL the single-use sign-in link to the agent's own account inbox —
        // never return it to the caller. The durable report link is a reusable
        // bearer, so returning a full-session login URL to whoever presents it
        // was an account-takeover vector (#258 review #5). Only the agent's inbox
        // can now complete sign-in; report VIEWING via the token is unchanged.
        if (result) {
            // Defer the send to waitUntil — awaiting only on the account-exists
            // path would make it measurably slower than the no-account path, a
            // timing enumeration oracle. Mirrors server/api/agent/login.ts's
            // loginLink and portal.ts's requestLink.
            const sendPromise = (async () => {
                try {
                    await c.var.services.email.sendAgentLoginLink(result.email, result.loginUrl);
                } catch (err) {
                    logger.error('agent.magic_login.link_send_failed', {}, err instanceof Error ? err : undefined);
                }
            })();
            let execCtx: Pick<ExecutionContext, 'waitUntil'> | undefined;
            try {
                execCtx = c.executionCtx;
            } catch {
                execCtx = undefined;
            }
            if (execCtx) execCtx.waitUntil(sendPromise);
            else await sendPromise;
        }
        // Anti-oracle: identical { sent: true } response (and timing) whether or
        // not an agent account exists for the report link's recipient.
        return c.json({ success: true as const, data: { sent: true as const } }, 200);
    });

/** GET /agent/magic-login — mounted at the TOP LEVEL (not under /api); see workers/app.ts. */
export const agentMagicLoginRedeemRoutes = createApiRouter()
    .openapi(redeemRoute, async (c) => {
        const { code } = c.req.valid('query');
        try {
            const { userId, email } = await redeemMagicLogin(c.env.TENANT_CACHE, c.env.DB, code);

            // Agent JWT claim shape mirrors server/api/agent-signup.ts:101-108
            // EXACTLY — no tenantId/custom:tenantId. Agents are global users;
            // per-inspection tenant association is resolved per-route.
            const keyring = await c.var.keyringPromise!;
            const now = Math.floor(Date.now() / 1000);
            const token = await signJwt({
                sub: userId,
                role: 'agent',
                'custom:userRole': 'agent',
                email,
                iat: now,
                exp: now + 60 * 60 * 24,
            }, keyring);

            setCookie(c, '__Host-inspector_token', token, {
                httpOnly: true,
                secure: true,
                sameSite: 'Strict',
                path: '/',
                maxAge: 60 * 60 * 24,
            });

            // Global agent identity — tenant-less by design, so this does NOT go
            // through the tenant-scoped audit_logs table (auditLogs.tenantId is a
            // NOT NULL FK to tenants.id). Mirrors agent-signup.ts, which mints the
            // same kind of tenant-less session with structured logging only.
            logger.info('agent.magic_login.redeemed', { userId });

            return c.redirect('/agent-dashboard', 302);
        } catch (err) {
            logger.warn('agent.magic_login.redeem_failed', {
                error: err instanceof Error ? err.message : String(err),
            });
            return c.redirect('/agent-login?error=expired_link', 302);
        }
    });

export type AgentMagicLoginRequestApi = typeof agentMagicLoginRequestRoutes;
export type AgentMagicLoginRedeemApi = typeof agentMagicLoginRedeemRoutes;
