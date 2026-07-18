import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { setCookie } from 'hono/cookie';
import { drizzle } from 'drizzle-orm/d1';
import { desc, eq } from 'drizzle-orm';
import { Errors } from '../lib/errors';
import { requireRole } from '../lib/middleware/rbac';
import { signJwt } from '../lib/jwt-keyring';
import { agentTenantLinks, users } from '../lib/db/schema/tenant';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { getLegalLinks, buildTermsAcceptedBlob } from '../lib/legal-links';

/**
 * Agent Accounts A1 — invite + accept endpoints. The (existing) /api/agent
 * routes (singular, agent.ts) handle inspector-facing read-only views like
 * "my-reports" and "leaderboard". These plural /api/agents routes own the
 * invite + accept lifecycle for the new global-agent persona.
 */

const InviteBodySchema = z
    .object({
        email: z.string().email().openapi({ example: 'jane@realty.com' }).describe('TODO describe email field for the OpenInspection MCP integration'),
        contactId: z.string().uuid().optional().describe('TODO describe contactId field for the OpenInspection MCP integration'),
    })
    .openapi('AgentInviteBody');

const InviteResponseSchema = z
    .object({
        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
        data: z.object({
            token: z.string().describe('TODO describe token field for the OpenInspection MCP integration'),
            expiresAt: z.number().openapi({ description: 'Unix epoch seconds' }),
            emailSent: z.boolean().describe('TODO describe emailSent field for the OpenInspection MCP integration'),
        }).describe('TODO describe data field for the OpenInspection MCP integration'),
    })
    .openapi('AgentInviteResponse');

const inviteRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/invite',
    tags: ["agents"],
    summary: 'Invite a partner agent',
    description: "Auto-generated placeholder for inviteAgent (POST /invite, agents domain). TODO: replace with a real description sourced from the handler.",
    request: {
        body: { content: { 'application/json': { schema: InviteBodySchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: InviteResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Invite created',
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
        409: { description: 'Invite already pending for this email' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "inviteAgent"
}, { scopes: ['write'], tier: 'extended' }));

// --- POST /api/agents/accept ---

const AcceptBodySchema = z
    .object({
        token: z.string().min(8).describe('TODO describe token field for the OpenInspection MCP integration'),
        password: z.string().min(12).describe('TODO describe password field for the OpenInspection MCP integration'),
        name: z.string().min(2).max(120).describe('TODO describe name field for the OpenInspection MCP integration'),
        // Legal-links feature — required (true) only when the operator configured
        // TERMS_URL/PRIVACY_URL; enforced in the handler, optional on the wire.
        termsAccepted: z.boolean().optional().describe('Acceptance of operator Terms of Service and Privacy Policy; required when the operator has configured TERMS_URL/PRIVACY_URL'),
    })
    .openapi('AgentAcceptBody');

const AcceptResponseSchema = z
    .object({
        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
        data: z.object({
            redirect: z.string().describe('TODO describe redirect field for the OpenInspection MCP integration'),
            userId: z.string().describe('TODO describe userId field for the OpenInspection MCP integration'),
        }).describe('TODO describe data field for the OpenInspection MCP integration'),
    })
    .openapi('AgentAcceptResponse');

const acceptRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/accept',
    tags: ["agents"],
    summary: 'Accept a partner-agent invite',
    description: "Auto-generated placeholder for acceptAgent (POST /accept, agents domain). TODO: replace with a real description sourced from the handler.",
    request: {
        body: { content: { 'application/json': { schema: AcceptBodySchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AcceptResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Invite accepted',
        },
        400: { description: 'Expired token or invalid input' },
        404: { description: 'Token not found' },
        409: { description: 'Invite already used or email belongs to non-agent account' },
    },
    operationId: "acceptAgent"
}, { scopes: ['write'], tier: 'extended' }));

// --- A2: GET /api/agents/links — inspector-side partner-link listing ---

const LinkRowSchema = z
    .object({
        id:          z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
        agentUserId: z.string().describe('TODO describe agentUserId field for the OpenInspection MCP integration'),
        agentName:   z.string().nullable().describe('TODO describe agentName field for the OpenInspection MCP integration'),
        agentEmail:  z.string().nullable().describe('TODO describe agentEmail field for the OpenInspection MCP integration'),
        status:      z.enum(['pending', 'active', 'revoked']).describe('TODO describe status field for the OpenInspection MCP integration'),
        createdAt:   z.number().nullable().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
        revokedAt:   z.number().nullable().describe('TODO describe revokedAt field for the OpenInspection MCP integration'),
    })
    .openapi('AgentLinkRow');

const ListLinksResponseSchema = z
    .object({
        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
        data: z.object({ links: z.array(LinkRowSchema).describe('TODO describe links field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
    })
    .openapi('ListAgentLinksResponse');

const listLinksRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/links',
    tags: ["agents"],
    summary: 'List partner-agent links for the current tenant',
    description: "Auto-generated placeholder for listAgentLinks (GET /links, agents domain). TODO: replace with a real description sourced from the handler.",
    responses: {
        200: {
            content: { 'application/json': { schema: ListLinksResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Links',
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listAgentLinks"
}, { scopes: ['read'], tier: 'extended' }));

// --- A2: POST /api/agents/<linkId>/revoke ---

const RevokeParamsSchema = z.object({
    linkId: z.string().min(1).describe('TODO describe linkId field for the OpenInspection MCP integration'),
}).openapi('AgentLinkRevokeParams');

const RevokeResponseSchema = z
    .object({
        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
        data: z.object({ ok: z.literal(true).describe('TODO describe ok field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
    })
    .openapi('AgentLinkRevokeResponse');

const revokeRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{linkId}/revoke',
    tags: ["agents"],
    summary: 'Revoke a partner-agent link',
    description: "Auto-generated placeholder for revokeAgent (POST /{linkId}/revoke, agents domain). TODO: replace with a real description sourced from the handler.",
    request: { params: RevokeParamsSchema.describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: RevokeResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Link revoked',
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
        404: { description: 'Link not found' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "revokeAgent"
}, { scopes: ['write'], tier: 'extended' }));

/**
 * C-10 ③-C — GET /api/agents/invite-info?token=
 * Anonymous (like /accept): resolves an agent-invite token into the metadata
 * the public accept page renders (inspector name + tenant + invited email).
 * 404 when the token is unknown, expired, or already used so the page shows
 * its friendly recovery state. Returns whitelisted fields only.
 */
const InviteInfoResponseSchema = z
    .object({
        success: z.literal(true).describe('Always true on the 200 path.'),
        data: z.object({
            token:       z.string().describe('The invite token (echoed back for the form hidden field).'),
            inspector:   z.object({
                name:     z.string().describe('Inviting inspector display name.'),
                photoUrl: z.string().optional().describe('Inviting inspector avatar URL, when available.'),
            }).describe('Inviting inspector summary (public fields only).'),
            tenantName:  z.string().describe('Inviting company name.'),
            inviteEmail: z.string().describe('Email address the invite was sent to (read-only on the form).'),
        }).describe('Resolved invite metadata for the accept page.'),
    })
    .openapi('AgentInviteInfoResponse');

const inviteInfoRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/invite-info',
    tags: ["agents"],
    summary: 'Resolve a partner-agent invite token',
    description: "Public, no-login resolution of an agent-invite token into the inspector + tenant + email metadata the accept page renders. Returns 404 for unknown/expired/used tokens so the page can show its recovery state.",
    request: { query: z.object({ token: z.string().describe('The agent-invite token from the invite email.') }) },
    responses: {
        200: { content: { 'application/json': { schema: InviteInfoResponseSchema } }, description: 'Invite resolved' },
        404: { description: 'Invite not found, expired, or already used' },
    },
    operationId: "getAgentInviteInfo",
}, { scopes: [], tier: 'extended' }));

const agentsRoutes = createApiRouter()
    .openapi(inviteRoute, async (c) => {
        // RBAC moved inside to keep OpenAPIHono context typing happy. Owners, admins,
        // and rank-and-file inspectors can all invite agents.
        await requireRole('owner', 'manager', 'inspector')(c, async () => {});

        const tenantId = c.get('tenantId');
        const user = c.get('user');
        if (!tenantId || !user?.sub) throw Errors.Unauthorized();

        const body = c.req.valid('json');
        const result = await c.var.services.agent.invite(tenantId, user.sub, {
            email: body.email,
            ...(body.contactId ? { contactId: body.contactId } : {}),
        });

        return c.json({ success: true as const, data: result }, 200);
    })
    .openapi(acceptRoute, async (c) => {
        const body = c.req.valid('json');

        const links = getLegalLinks(c.env);
        if (links && body.termsAccepted !== true) {
            throw Errors.BadRequest('You must accept the terms to create an account.');
        }

        const result = await c.var.services.agent.acceptInvite(body.token, {
            password: body.password,
            name: body.name,
            ...(links ? { termsAccepted: buildTermsAcceptedBlob(links, {
                ip: c.req.header('CF-Connecting-IP'),
                country: (c.req.raw.cf?.country as string | undefined),
            }) } : {}),
        });

        // Mint the agent JWT — note the deliberate absence of a tenantId claim. Per
        // Agent Accounts A1 the JWT carries no tenant scope; agent routes resolve a
        // tenant per-request via resolveAgentTenant().
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

        setCookie(c, '__Host-inspector_token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'Strict',
            path: '/',
            maxAge: 60 * 60 * 24,
        });

        return c.json({
            success: true as const,
            data: { redirect: '/agent-dashboard', userId: result.userId },
        }, 200);
    })
    .openapi(listLinksRoute, async (c) => {
        await requireRole('owner', 'manager', 'inspector')(c, async () => {});
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized();
        const db = drizzle(c.env.DB);
        const rows = await db
            .select({
                id:          agentTenantLinks.id,
                agentUserId: agentTenantLinks.agentUserId,
                agentName:   users.name,
                agentEmail:  users.email,
                status:      agentTenantLinks.status,
                createdAt:   agentTenantLinks.createdAt,
                revokedAt:   agentTenantLinks.revokedAt,
            })
            .from(agentTenantLinks)
            .leftJoin(users, eq(users.id, agentTenantLinks.agentUserId))
            .where(eq(agentTenantLinks.tenantId, tenantId))
            .orderBy(desc(agentTenantLinks.createdAt))
            .all();
        const links = rows.map((r) => {
            const created = r.createdAt instanceof Date ? r.createdAt.getTime() : (r.createdAt ? Number(r.createdAt) : null);
            const revoked = r.revokedAt instanceof Date ? r.revokedAt.getTime() : (r.revokedAt ? Number(r.revokedAt) : null);
            return {
                id:          r.id,
                agentUserId: r.agentUserId,
                agentName:   r.agentName ?? null,
                agentEmail:  r.agentEmail ?? null,
                status:      (r.status as 'pending' | 'active' | 'revoked'),
                createdAt:   created,
                revokedAt:   revoked,
            };
        });
        return c.json({ success: true as const, data: { links } }, 200);
    })
    .openapi(revokeRoute, async (c) => {
        await requireRole('owner', 'manager', 'inspector')(c, async () => {});
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized();
        const { linkId } = c.req.valid('param');
        await c.var.services.agent.revokeLink(linkId, tenantId);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(inviteInfoRoute, async (c) => {
        const { token } = c.req.valid('query');
        const invite = await c.var.services.agent.resolveInvite(token);
        if (!invite || invite.expired || invite.used) {
            return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Invite not found' } }, 404);
        }
        return c.json({
            success: true as const,
            data: {
                token: invite.token,
                inspector: { name: invite.inspector.name },
                tenantName: invite.tenantName,
                inviteEmail: invite.email,
            },
        }, 200);
    });

export type AgentsApi = typeof agentsRoutes;

export default agentsRoutes;
