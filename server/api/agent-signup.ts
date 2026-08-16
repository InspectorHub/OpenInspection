import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { setCookie } from 'hono/cookie';
import { Errors } from '../lib/errors';
import { verifyTurnstile, resolveTurnstile, TURNSTILE_TEST_KEY_WARNING } from '../lib/middleware/bot-protection';
import { signJwt } from '../lib/jwt-keyring';
import { logger } from '../lib/logger';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { authCookieOptions, AUTH_COOKIE_NAME } from '../lib/auth-helpers';

/**
 * Agent Accounts A1 — self-serve agent signup endpoint.
 *
 * Public, no JWT. Validates input + Turnstile (when configured), creates a
 * global agent user (tenant_id NULL, role='agent'), runs same-email auto-link
 * to fold in any tenants where this email already lives as an agent contact,
 * and returns Set-Cookie + redirect to /agent-dashboard.
 */
const SignupBodySchema = z
    .object({
        email: z.string().email().describe('TODO describe email field for the OpenInspection MCP integration'),
        password: z.string().min(12).max(120).describe('TODO describe password field for the OpenInspection MCP integration'),
        name: z.string().min(2).max(120).describe('TODO describe name field for the OpenInspection MCP integration'),
        turnstileToken: z.string().optional().describe('TODO describe turnstileToken field for the OpenInspection MCP integration'),
        // Legacy optional field — tenant Privacy/Terms are configured in Settings,
        // not via Worker env. SaaS agents accept portal Terms at registration.
        termsAccepted: z.boolean().optional().describe('Optional; unused for env-based legal (removed).'),
    })
    .openapi('AgentSignupBody');

const SignupResponseSchema = z
    .object({
        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
        data: z.object({
            redirect: z.string().describe('TODO describe redirect field for the OpenInspection MCP integration'),
            userId: z.string().describe('TODO describe userId field for the OpenInspection MCP integration'),
        }).describe('TODO describe data field for the OpenInspection MCP integration'),
    })
    .openapi('AgentSignupResponse');

const signupRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/',
    tags: ["agents"],
    summary: "Create agent for current tenant",
    description: "Auto-generated placeholder for createAgent (POST /, agents domain). TODO: replace with a real description sourced from the handler.",
    request: {
        body: { content: { 'application/json': { schema: SignupBodySchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SignupResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Account created',
        },
        400: { description: 'Invalid input' },
        409: { description: 'Email already registered — log in instead' },
    },
    operationId: "createAgent"
}, { scopes: ['write'], tier: 'extended' }));

const agentSignupRoutes = createApiRouter()
    .openapi(signupRoute, async (c) => {
        const body = c.req.valid('json');

        // Bot protection. A deployment capability, not a test on whether someone
        // remembered to set a key: saas always challenges (on Cloudflare's
        // published test key when unconfigured, so the path stays live),
        // standalone leaves it to the operator. See `resolveTurnstile`.
        const turnstile = resolveTurnstile(c.env);
        if (turnstile.enforced) {
            if (turnstile.usingTestKey) {
                logger.warn('agent.signup.turnstile.test_key', { detail: TURNSTILE_TEST_KEY_WARNING });
            }
            if (!body.turnstileToken) {
                throw Errors.BadRequest('Bot challenge required');
            }
            let ok = false;
            try {
                ok = await verifyTurnstile(body.turnstileToken, turnstile.secret);
            } catch (err) {
                logger.warn('agent.signup.turnstile.failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
                ok = false;
            }
            if (!ok) throw Errors.BadRequest('Bot challenge failed');
        }

        const result = await c.var.services.agent.signup({
            email: body.email,
            password: body.password,
            name: body.name,
        });

        const keyring = await c.var.keyringPromise!;
        const now = Math.floor(Date.now() / 1000);
        const token = await signJwt({
            sub: result.userId,
            role: 'agent',
            'custom:userRole': 'agent',
            email: result.email,
            iat: now,
            exp: now + 60 * 60 * 24,
        }, keyring);

        setCookie(c, AUTH_COOKIE_NAME, token, authCookieOptions());

        return c.json({
            success: true as const,
            data: { redirect: '/agent-dashboard', userId: result.userId },
        }, 200);
    });

export type AgentSignupApi = typeof agentSignupRoutes;

export default agentSignupRoutes;
