import { createRoute } from '@hono/zod-openapi';
import { setCookie } from 'hono/cookie';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getBaseUrl } from '../../lib/url';
import { signJwt } from '../../lib/jwt-keyring';
import { logger } from '../../lib/logger';
import { Errors } from '../../lib/errors';
import { verifyPassword, hashPassword } from '../../lib/password';
import { users } from '../../lib/db/schema/tenant';
import { DUMMY_HASH } from '../../services/auth.service';
import { findGlobalAgentByEmail } from '../../services/agent/account';
import { requestMagicLoginByEmail } from '../../services/agent/magic-login.service';
import {
    AgentLoginSchema,
    AgentLoginLinkSchema,
    AgentLoginResponseSchema,
    AgentLoginLinkResponseSchema,
} from '../../lib/validations/agent-login.schema';

/**
 * Spec 3 Task 5 — core (standalone/OSS) `/agent-login` dual-mode front door:
 * email+password primary (fast repeat login, no email round-trip) plus a
 * magic-link fallback layered on the SAME single-use primitive Task 2 built
 * (server/services/agent/magic-login.service.ts). This is NOT `/login` —
 * agents are locked out of the tenant login page in both modes, so these are
 * their only entry points, and it never hits the SaaS portal-bounce. No
 * Google OAuth here — that's the separate SaaS/portal page (Task 5c).
 *
 * SECURITY:
 *   - Password path authenticates ONLY a global agent (tenant_id IS NULL,
 *     role='agent', not soft-deleted) — findGlobalAgentByEmail is the single
 *     source of that predicate (server/services/agent/account.ts). A tenant
 *     user's email can never authenticate here even with the right password,
 *     because the lookup itself excludes every tenant-scoped row.
 *   - Anti-oracle: a missing account still runs verifyPassword against
 *     DUMMY_HASH so the response time doesn't leak whether the email exists
 *     (mirrors AuthService.validateCredentials exactly); a missing account
 *     and a wrong password both answer the SAME generic 401.
 *   - The link path ALWAYS answers { sent: true } — mirrors portal.ts's
 *     requestLink anti-enumeration pattern. Only the actual email SEND is
 *     deferred to waitUntil (network I/O to a third-party provider is the
 *     variable-timing risk); the account lookup + code mint are cheap,
 *     roughly-constant-time D1 + KV operations that already run identically
 *     on both branches, so deferring them buys no anti-timing benefit while
 *     making the known-account branch untestable synchronously.
 *   - The agent JWT (claim shape identical to Task 2 / agent-signup.ts —
 *     { sub, role: 'agent', 'custom:userRole': 'agent', email, exp }, NO
 *     tenantId) is delivered exclusively via Set-Cookie, never the JSON body.
 */

const loginRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/login',
    tags: ['agents', 'public'],
    summary: 'Authenticate an agent by email and password',
    description:
        'Public, unauthenticated endpoint. Authenticates ONLY a global agent account ' +
        "(tenant_id IS NULL, role='agent') by email + password and mints an agent " +
        "session cookie. A tenant user's email, a missing account, and a wrong " +
        'password all answer the SAME generic 401 (anti-oracle) — the token is ' +
        'delivered via Set-Cookie only, never in this response body.',
    request: {
        body: { content: { 'application/json': { schema: AgentLoginSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AgentLoginResponseSchema } },
            description: 'Agent session cookie set',
        },
        401: { description: 'Invalid email or password' },
    },
    operationId: 'agentLogin',
}, { scopes: [], tier: 'excluded' }));

const loginLinkRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/login-link',
    tags: ['agents', 'public'],
    summary: 'Request an agent magic sign-in link by email',
    description:
        'Public, unauthenticated endpoint. ALWAYS returns 200 { sent: true } ' +
        'regardless of whether the email has a global agent account, to prevent ' +
        'account enumeration. When it does, an email with a one-time sign-in link ' +
        '(900 second TTL) is sent — the send itself is deferred so the response is ' +
        'timing-identical either way.',
    request: {
        body: { content: { 'application/json': { schema: AgentLoginLinkSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AgentLoginLinkResponseSchema } },
            description: 'Always { sent: true } — no email enumeration',
        },
    },
    operationId: 'agentLoginLink',
}, { scopes: [], tier: 'excluded' }));

export const agentLoginRoutes = createApiRouter()
    .openapi(loginRoute, async (c) => {
        const { email, password } = c.req.valid('json');

        const row = await findGlobalAgentByEmail(c.env.DB, email);
        if (!row) {
            // Timing-equalization — mirrors AuthService.validateCredentials:
            // run a throwaway verify even though there's no account to check
            // against, so a missing email doesn't answer measurably faster.
            await verifyPassword(password, DUMMY_HASH);
            throw Errors.Unauthorized('Invalid email or password');
        }

        const [valid, needsRehash] = await verifyPassword(password, row.passwordHash);
        if (!valid) {
            throw Errors.Unauthorized('Invalid email or password');
        }

        if (needsRehash) {
            const upgraded = await hashPassword(password);
            await drizzle(c.env.DB).update(users).set({ passwordHash: upgraded }).where(eq(users.id, row.id));
        }

        // Agent JWT claim shape mirrors server/api/agent-signup.ts and the
        // magic-login redeem handler (server/api/agent/magic-login.ts)
        // EXACTLY — no tenantId/custom:tenantId. Agents are global users.
        const keyring = await c.var.keyringPromise!;
        const now = Math.floor(Date.now() / 1000);
        const token = await signJwt({
            sub: row.id,
            role: 'agent',
            'custom:userRole': 'agent',
            email: row.email,
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

        // Tenant-less global agent identity — same reasoning as the
        // magic-login redeem handler: no tenant-scoped audit_logs row
        // (auditLogs.tenantId is a NOT NULL FK), structured logging only.
        logger.info('agent.login.password', { userId: row.id });

        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(loginLinkRoute, async (c) => {
        const { email } = c.req.valid('json');

        const loginUrl = await requestMagicLoginByEmail({
            kv: c.env.TENANT_CACHE,
            db: c.env.DB,
            email,
            coreBaseUrl: getBaseUrl(c),
        });

        if (loginUrl) {
            // Do NOT await the send inside the request — only awaiting on the
            // known-account path would make it measurably slower than the
            // unknown-email path, a timing enumeration oracle. Defer to
            // waitUntil so the response returns immediately in all cases.
            const sendPromise = (async () => {
                try {
                    await c.var.services.email.sendAgentLoginLink(email, loginUrl);
                } catch (err) {
                    logger.error('agent.login.link_send_failed', {}, err instanceof Error ? err : undefined);
                }
            })();
            // `c.executionCtx` throws when no execution context is present
            // (e.g. unit tests) — probe defensively rather than via a
            // truthiness check. Mirrors server/api/portal.ts's requestLink.
            let execCtx: Pick<ExecutionContext, 'waitUntil'> | undefined;
            try {
                execCtx = c.executionCtx;
            } catch {
                execCtx = undefined;
            }
            if (execCtx) execCtx.waitUntil(sendPromise);
            else await sendPromise;
        }

        logger.info('agent.login.link_requested', { found: loginUrl !== null });

        // Identical response in all cases — payload AND timing (the only
        // I/O-variable step, the email send, is deferred above) — so there
        // is no enumeration oracle.
        return c.json({ success: true as const, data: { sent: true as const } }, 200);
    });

export type AgentLoginApi = typeof agentLoginRoutes;
