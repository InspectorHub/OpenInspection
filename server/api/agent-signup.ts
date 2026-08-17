import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { setCookie } from 'hono/cookie';
import { Errors } from '../lib/errors';
import { verifyTurnstile, resolveTurnstile, TURNSTILE_TEST_KEY_WARNING } from '../lib/middleware/bot-protection';
import { signJwt } from '../lib/jwt-keyring';
import { logger } from '../lib/logger';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { authCookieOptions, AUTH_COOKIE_NAME } from '../lib/auth-helpers';
import { getDrizzle } from '../lib/route-helpers';

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
        // REQUIRED now, and it is the tick and only the tick. The version and
        // content hash are resolved server-side from the text in force — see the
        // handler. This field was previously documented as 'unused', which is how
        // an account could be created with no acceptance at all.
        termsAccepted: z.boolean().describe('Whether the agent accepted the agent terms shown to them. The version and content hash are recorded server-side from the text in force.'),
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

        // The acceptance is assembled SERVER-SIDE from the text actually in
        // force. `body.termsAccepted` is the user's tick — a fact about what they
        // did — and nothing more: a client-supplied version or hash would be the
        // client asserting what it read, which is precisely the evidence this
        // record exists to replace.
        //
        // No published agent terms means no signup. That is the review gate
        // (review) expressed as behaviour rather than a note: a deployment
        // that has not published a document written for agents cannot take an
        // agent's agreement to one. The message says so plainly, because an
        // operator hitting this needs to know it is their action that is missing.
        // WHOSE terms. An agent has no tenant, so the counterparty is the
        // OPERATOR — read as a capability (`profile.fixedTenantId`) rather than
        // by branching on APP_MODE. Where there is no fixed tenant the operator
        // is not a tenant of this deployment at all, and the document belongs in
        // the platform's own ledger: a different plan's half, and refusing here
        // is the honest answer rather than picking an arbitrary tenant's text.
        const operatorTenantId = c.var.profile.fixedTenantId;
        const { LegalVersionService } = await import('../services/legal-version.service');
        const legal = new LegalVersionService(getDrizzle(c) as never);
        const inForce = operatorTenantId
            ? await legal.latest(operatorTenantId, 'agent_terms')
            : null;
        if (!inForce) {
            throw Errors.BadRequest(
                'Agent signup is unavailable until this workspace publishes its agent terms.',
            );
        }
        if (body.termsAccepted !== true) {
            throw Errors.BadRequest('The agent terms must be accepted to create an account');
        }

        const result = await c.var.services.agent.signup({
            email: body.email,
            password: body.password,
            name: body.name,
            termsAccepted: {
                at: new Date().toISOString(),
                version: inForce.version,
                contentHash: inForce.contentHash,
                ...(c.req.header('cf-connecting-ip') ? { ip: c.req.header('cf-connecting-ip')! } : {}),
                ...(c.req.header('cf-ipcountry') ? { country: c.req.header('cf-ipcountry')! } : {}),
            },
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
