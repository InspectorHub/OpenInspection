import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { Errors } from '../lib/errors';
import { requireRole } from '../lib/middleware/rbac';
import { users } from '../lib/db/schema/tenant';
import { contacts } from '../lib/db/schema/contact';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { getDrizzle } from '../lib/route-helpers';

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
        status:      z.enum(['active', 'revoked']).describe('TODO describe status field for the OpenInspection MCP integration'),
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
    description: "Lists the company's partner-agent links: agent contacts that are bound to an agent account, with the agent's account name and email, an active or revoked status, and when the link was created and (if applicable) revoked. Revoked links are included. Ordinary agent contacts with no account are not links and are not listed. Newest link first, not paginated. The link id is the contact id used by the revoke route. Read-only. Available to owner, manager and inspector roles.",
    responses: {
        200: {
            content: { 'application/json': { schema: ListLinksResponseSchema } },
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
    linkId: z.string().min(1).describe('Id of the partner-agent link to revoke, as returned in the id field of the link list. It is the agent\'s contact id and must belong to this company'),
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
    description: "Withdraw a linked agent's access to this company's inspections in the agent portal. The link is the "
        + "agent's contact record; revoking stamps it as revoked and keeps the history of who held it. The contact "
        + "itself is not archived, so the person stays usable as an agent on existing inspections, and the "
        + "agent's account is not deleted. A revoked agent can no longer book through this company on their own "
        + "account. Returns 404 when the id is not a contact in this company. Calling it again succeeds and "
        + "refreshes the revocation time. Open to owners, managers and inspectors.",
    request: { params: RevokeParamsSchema },
    responses: {
        200: {
            content: { 'application/json': { schema: RevokeResponseSchema } },
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
        const db = getDrizzle(c);
        // IA-104 — the "links" are contact rows carrying an account binding.
        // `id` is the contact id, which is what POST /{linkId}/revoke now
        // takes. Only bound rows are listed: an ordinary agent contact with no
        // account is not a link, it is just a contact, and it belongs on
        // /contacts rather than here.
        const rows = await db
            .select({
                id:          contacts.id,
                agentUserId: contacts.agentUserId,
                agentName:   users.name,
                agentEmail:  users.email,
                createdAt:   contacts.agentLinkedAt,
                revokedAt:   contacts.agentRevokedAt,
            })
            .from(contacts)
            .leftJoin(users, eq(users.id, contacts.agentUserId))
            .where(and(eq(contacts.tenantId, tenantId), isNotNull(contacts.agentUserId)))
            .orderBy(desc(contacts.agentLinkedAt))
            .all();
        const links = rows.map((r) => {
            const created = r.createdAt instanceof Date ? r.createdAt.getTime() : (r.createdAt ? Number(r.createdAt) : null);
            const revoked = r.revokedAt instanceof Date ? r.revokedAt.getTime() : (r.revokedAt ? Number(r.revokedAt) : null);
            return {
                id:          r.id,
                agentUserId: r.agentUserId ?? '',
                agentName:   r.agentName ?? null,
                agentEmail:  r.agentEmail ?? null,
                // Derived rather than stored: the old `status` column had three
                // values but only ever held two, since nothing wrote 'pending'.
                status:      (revoked ? 'revoked' : 'active') as 'active' | 'revoked',
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
