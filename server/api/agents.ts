import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { desc, eq } from 'drizzle-orm';
import { Errors } from '../lib/errors';
import { requireRole } from '../lib/middleware/rbac';
import { agentTenantLinks, users } from '../lib/db/schema/tenant';
import { withMcpMetadata } from "../lib/route-metadata-standards";

/**
 * Inspector-side partner-agent links. The (existing) /api/agent routes
 * (singular, agent.ts) handle inspector-facing read-only views like
 * "my-reports" and "leaderboard"; these plural /api/agents routes own the
 * link lifecycle between a tenant and a global agent account.
 *
 * The invite/accept endpoints that used to live here are gone. An agent reads
 * a report through a per-inspection access token that needs no account, so an
 * invitation gated nothing — and the POST had no caller in the UI. Agents who
 * want a standing account sign up at /agent-signup; autoLinkSameEmail then
 * connects them to every tenant that already holds them as a contact.
 */


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

const agentsRoutes = createApiRouter()
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
    });

export type AgentsApi = typeof agentsRoutes;

export default agentsRoutes;
