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
        shownContentHash: z.string().regex(/^[0-9a-f]{64}$/).optional().describe('SHA-256 of the agent-terms body this page actually rendered. Used ONLY to reject a stale page whose text is no longer in force — never as the recorded evidence, which always comes from the server.'),
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

const AgentTermsResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        version: z.string().describe('The version in force, YYYY-MM-DD.'),
        contentHash: z.string().describe('SHA-256 hex of the body below. Echo it back on submit so a stale page is refused.'),
        body: z.string().describe('The agent-terms text to display. The signer must be shown this, not a link to it.'),
    }),
}).openapi('AgentTermsResponse');

/**
 * The agent terms as currently in force — body included.
 *
 * Public and GET, because the signup page has to SHOW the text. The checkbox said
 * "I have read and accept the Agent Terms" while the page displayed nothing and
 * linked nowhere, so the acceptance recorded a presentation that had not happened
 * — the same defect that was closed for e-signature, where intent must come
 * from a recorded act rather than be inferred from an artefact existing.
 *
 * `contentHash` travels with the body so the form can send back what it rendered
 * and a stale page can be refused. That value is a staleness check only; the
 * evidence recorded on the account is always the hash the server read.
 */
const agentTermsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/terms',
    tags: ["agents"],
    summary: "The agent terms in force",
    description: "Returns the deployment's current agent-terms version, its content hash, and the body to display at signup. 404 when the deployment has published none — in which case agent signup is closed.",
    responses: {
        200: {
            content: { 'application/json': { schema: AgentTermsResponseSchema } },
            description: 'The agent terms in force',
        },
        404: { description: 'No agent terms published — agent signup is closed' },
    },
    operationId: "getAgentTerms"
}, { scopes: ['read'], tier: 'extended' }));

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
    .openapi(agentTermsRoute, async (c) => {
        const { DeploymentLegalService } = await import('../services/deployment-legal.service');
        const legal = new DeploymentLegalService(getDrizzle(c) as never);
        const inForce = await legal.latest('agent_terms');
        if (!inForce) {
            // 404 rather than an empty 200. "No agent terms exist" and "here are
            // the empty agent terms" are different facts, and the signup page has
            // to be able to tell them apart to close itself honestly.
            throw Errors.NotFound('This deployment has not published agent terms');
        }
        return c.json({
            success: true as const,
            data: {
                version: inForce.version,
                contentHash: inForce.contentHash,
                body: inForce.bodySnapshot,
            },
        }, 200);
    })
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
            }
            if (!ok) throw Errors.BadRequest('Bot challenge failed');
        }

        // The acceptance is assembled SERVER-SIDE from the text actually in
        // force. `body.termsAccepted` is the user's tick — a fact about what they
        // did — and nothing more: a client-supplied version or hash would be the
        // client asserting what it read, which is precisely the evidence this
        // record exists to replace.
        //
        // No published agent terms means no signup. That gate is expressed as
        // behaviour rather than as a note: a deployment
        // that has not published a document written for agents cannot take an
        // agent's agreement to one. The message says so plainly, because an
        // operator hitting this needs to know it is their action that is missing.
        //
        // WHOSE terms. An agent has no tenant, so the counterparty is whoever
        // OPERATES this deployment — and that is why the document lives in
        // `deployment_legal_versions` rather than under a tenant. This used to read
        // `profile.fixedTenantId`, which is the single tenant in standalone and
        // NULL in SaaS, so every SaaS signup was refused for a reason that had
        // nothing to do with the caller. One document with no tenant answers both
        // modes with the same query, and the branch is gone rather than widened.
        const { DeploymentLegalService } = await import('../services/deployment-legal.service');
        const legal = new DeploymentLegalService(getDrizzle(c) as never);
        const inForce = await legal.latest('agent_terms');
        if (!inForce) {
            logger.error('[agent-signup] refused: no agent terms published on this deployment');
            throw Errors.BadRequest(
                'Agent signup is unavailable until this deployment publishes its agent terms.',
            );
        }
        // Staleness, not evidence. The recorded hash is always the one the server
        // read above — a client-supplied hash would be the client asserting what it
        // read, which is what this record exists to replace. But a page that
        // rendered an older version is a real thing to catch: the tick was given
        // against text that is no longer in force, so the acceptance would name a
        // version the signer was never shown. Refuse and let them re-read.
        if (body.shownContentHash && body.shownContentHash !== inForce.contentHash) {
            logger.info('[agent-signup] refused: stale page — shown hash is not the version in force');
            throw Errors.BadRequest(
                'The agent terms were updated while this page was open. Reload and review the current version.',
            );
        }
        if (body.termsAccepted !== true) {
            // Logged, because the status code alone cannot say which of this
            // endpoint's four refusals fired — bot challenge, no published terms,
            // a stale page, or an unticked box all answer 400, and an operator
            // reading "400" learns nothing. Two round trips of an e2e diagnosis
            // were spent on exactly that.
            logger.info('[agent-signup] refused: terms not accepted');
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
