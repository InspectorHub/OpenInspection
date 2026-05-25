import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { setCookie } from 'hono/cookie';
import { drizzle } from 'drizzle-orm/d1';
import { desc, eq } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { Errors } from '../lib/errors';
import { requireRole } from '../lib/middleware/rbac';
import { signJwt } from '../lib/jwt-keyring';
import { agentTenantLinks, users } from '../lib/db/schema/tenant';
import { withMcpMetadata } from "../lib/route-metadata-standards";

/**
 * Agent Accounts A1 — invite + accept endpoints. The (existing) /api/agent
 * routes (singular, agent.ts) handle inspector-facing read-only views like
 * "my-reports" and "leaderboard". These plural /api/agents routes own the
 * invite + accept lifecycle for the new global-agent persona.
 */
const agentsRoutes = new OpenAPIHono<HonoConfig>();

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

agentsRoutes.openapi(inviteRoute, async (c) => {
    // RBAC moved inside to keep OpenAPIHono context typing happy. Owners, admins,
    // and rank-and-file inspectors can all invite agents.
    await requireRole(['owner', 'admin', 'inspector'])(c, async () => {});

    const tenantId = c.get('tenantId');
    const user = c.get('user');
    if (!tenantId || !user?.sub) throw Errors.Unauthorized();

    const body = c.req.valid('json');
    const result = await c.var.services.agent.invite(tenantId, user.sub, {
        email: body.email,
        ...(body.contactId ? { contactId: body.contactId } : {}),
    });

    return c.json({ success: true as const, data: result }, 200);
});

// --- POST /api/agents/accept ---

const AcceptBodySchema = z
    .object({
        token: z.string().min(8).describe('TODO describe token field for the OpenInspection MCP integration'),
        password: z.string().min(12).describe('TODO describe password field for the OpenInspection MCP integration'),
        name: z.string().min(2).max(120).describe('TODO describe name field for the OpenInspection MCP integration'),
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

agentsRoutes.openapi(acceptRoute, async (c) => {
    const body = c.req.valid('json');
    const result = await c.var.services.agent.acceptInvite(body.token, {
        password: body.password,
        name: body.name,
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
});

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

agentsRoutes.openapi(listLinksRoute, async (c) => {
    await requireRole(['owner', 'admin', 'inspector'])(c, async () => {});
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
});

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

agentsRoutes.openapi(revokeRoute, async (c) => {
    await requireRole(['owner', 'admin', 'inspector'])(c, async () => {});
    const tenantId = c.get('tenantId');
    if (!tenantId) throw Errors.Unauthorized();
    const { linkId } = c.req.valid('param');
    await c.var.services.agent.revokeLink(linkId, tenantId);
    return c.json({ success: true as const, data: { ok: true as const } }, 200);
});

export default agentsRoutes;
