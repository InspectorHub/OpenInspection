/**
 * Grant management API for the remote MCP OAuth server.
 *
 * Routes:
 *   GET  /grants       — self: list caller's own OAuth grants
 *   DELETE /grants/:id — self: revoke own grant; admin (?admin=1): revoke any tenant member's grant
 *   GET  /grants/all   — admin (owner/manager): list all grants across every tenant member
 *
 * All routes are tier:excluded — they are NOT surfaced as MCP tool definitions.
 * Tenant-scoping for admin paths is enforced by construction: grants are only
 * enumerated from users who belong to the caller's tenant (via getMembers).
 */
import { createRoute, z } from '@hono/zod-openapi';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { mcpEnabled } from '../lib/mcp/flag';
import { auditFromContext } from '../lib/audit';
import { Errors } from '../lib/errors';
import type { McpGrant } from '../lib/validations/mcp.schema';
import { McpGrantListResponseSchema } from '../lib/validations/mcp.schema';
import { SuccessResponseSchema } from '../lib/validations/shared.schema';

// ─── Route definitions ─────────────────────────────────────────────────────

const listSelfGrantsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/grants',
    tags: ['admin'] as const,
    summary: 'List current user OAuth grants',
    description: 'Returns all active OAuth grants for the currently authenticated user, enabling visibility into which MCP clients have been authorized.',
    operationId: 'listSelfMcpGrants',
    responses: {
        200: {
            content: { 'application/json': { schema: McpGrantListResponseSchema } },
            description: 'List of OAuth grants for the calling user',
        },
        404: { description: 'MCP feature is not enabled on this instance' },
    },
}, { scopes: ['read'], tier: 'excluded' }));

const revokeMcpGrantRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/grants/:id',
    tags: ['admin'] as const,
    summary: 'Revoke an OAuth grant by ID',
    description: 'Revokes an OAuth grant. Self-path revokes the caller\'s own grant; admin path (?admin=1) allows owner or manager to revoke any tenant member\'s grant with full audit logging.',
    operationId: 'revokeMcpGrant',
    request: {
        params: z.object({
            id: z.string().describe('Unique grant identifier to be revoked by this operation'),
        }),
        query: z.object({
            admin: z.string().optional().describe('Pass 1 to use admin revocation path for any tenant member grant'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Grant successfully revoked from the OAuth provider',
        },
        403: { description: 'Admin role required; caller is not owner or manager' },
        404: { description: 'Grant not found or MCP feature is not enabled' },
    },
}, { scopes: ['write'], tier: 'excluded' }));

const listAllGrantsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/grants/all',
    tags: ['admin'] as const,
    summary: 'List all tenant member OAuth grants',
    description: 'Returns all active OAuth grants across all members of the current tenant. Requires owner or manager role. Each grant includes user identity fields for audit visibility.',
    operationId: 'listAllTenantMcpGrants',
    middleware: [requireRole('owner', 'manager')] as const,
    responses: {
        200: {
            content: { 'application/json': { schema: McpGrantListResponseSchema } },
            description: 'All OAuth grants for every member of the calling user\'s tenant',
        },
        403: { description: 'Requires owner or manager role to list tenant grants' },
        404: { description: 'MCP feature is not enabled on this instance' },
    },
}, { scopes: ['admin'], tier: 'excluded' }));

// ─── Mapping helper ─────────────────────────────────────────────────────────

type RawGrant = {
    id: string;
    clientId: string;
    scope: string[];
    metadata: unknown;
    createdAt: number;
    expiresAt?: number;
};

/**
 * Maps a raw GrantSummary from the OAuth provider to the API display shape.
 * `extra` carries the admin-only user identity fields (userId, userEmail, userRole).
 */
function mapGrant(g: RawGrant, extra?: { userId?: string; userEmail?: string; userRole?: string }): McpGrant {
    return {
        id: g.id,
        clientId: g.clientId,
        clientName: ((g.metadata as { clientName?: string } | null)?.clientName) ?? null,
        scopes: g.scope,
        createdAt: g.createdAt,
        expiresAt: g.expiresAt ?? null,
        ...extra,
    };
}

// ─── Router ─────────────────────────────────────────────────────────────────

const mcpGrantsRoutes = createApiRouter()
    // GET /grants — self: list caller's own grants only
    .openapi(listSelfGrantsRoute, async (c) => {
        const oauth = (c.env as { OAUTH_PROVIDER?: OAuthHelpers }).OAUTH_PROVIDER;
        if (!mcpEnabled(c.env as { MCP_ENABLED?: string }) || !oauth) {
            throw Errors.NotFound('MCP feature is not enabled');
        }

        const userId = c.get('user').sub;
        const result = await oauth.listUserGrants(userId);
        const grants = result.items.map((g) => mapGrant(g));

        return c.json({ data: grants }, 200);
    })

    // DELETE /grants/:id — self or admin revoke
    .openapi(revokeMcpGrantRoute, async (c) => {
        const oauth = (c.env as { OAUTH_PROVIDER?: OAuthHelpers }).OAUTH_PROVIDER;
        if (!mcpEnabled(c.env as { MCP_ENABLED?: string }) || !oauth) {
            throw Errors.NotFound('MCP feature is not enabled');
        }

        const { id } = c.req.valid('param');
        const { admin: adminFlag } = c.req.valid('query');
        const isAdminPath = adminFlag === '1';
        const callerId = c.get('user').sub;
        const tenantId = c.get('tenantId');

        if (isAdminPath) {
            // Inline role check — NOT via middleware so non-admins can still reach
            // the self-revoke path on the same DELETE /grants/:id route.
            const userRole = c.get('userRole');
            if (userRole !== 'owner' && userRole !== 'manager') {
                throw Errors.Forbidden('Admin role required for grant oversight');
            }

            // Enumerate tenant members and their grants to find the target grant
            // owner. This is the cross-tenant guard: we only ever call
            // revokeGrant() with a userId that belongs to this tenant.
            const adminService = c.var.services.admin;
            const { members } = await adminService.getMembers(tenantId);

            let ownerUserId: string | null = null;
            for (const member of members) {
                const memberResult = await oauth.listUserGrants(member.id);
                const found = memberResult.items.find((g) => g.id === id);
                if (found) {
                    ownerUserId = member.id;
                    break;
                }
            }

            if (!ownerUserId) {
                // Grant not found in this tenant — either it doesn't exist or it
                // belongs to a different tenant. 404 without leaking cross-tenant
                // grant existence.
                throw Errors.NotFound('Grant not found in this tenant');
            }

            await oauth.revokeGrant(id, ownerUserId);
            auditFromContext(c, 'mcp.grant.revoked', 'mcp_grant', {
                entityId: id,
                metadata: { admin: true, targetUserId: ownerUserId },
            });
            return c.json({ success: true as const }, 200);
        }

        // Self path: verify the grant is among the caller's own grants before
        // revoking. 404 if not found — never reveal that another user's grant
        // exists (avoids grant-id enumeration via error-code differences).
        const result = await oauth.listUserGrants(callerId);
        const ownGrant = result.items.find((g) => g.id === id);
        if (!ownGrant) {
            throw Errors.NotFound('Grant not found');
        }

        await oauth.revokeGrant(id, callerId);
        auditFromContext(c, 'mcp.grant.revoked', 'mcp_grant', { entityId: id });
        return c.json({ success: true as const }, 200);
    })

    // GET /grants/all — admin: list grants for all tenant members
    .openapi(listAllGrantsRoute, async (c) => {
        const oauth = (c.env as { OAUTH_PROVIDER?: OAuthHelpers }).OAUTH_PROVIDER;
        if (!mcpEnabled(c.env as { MCP_ENABLED?: string }) || !oauth) {
            throw Errors.NotFound('MCP feature is not enabled');
        }

        const tenantId = c.get('tenantId');
        const adminService = c.var.services.admin;
        const { members } = await adminService.getMembers(tenantId);

        const grants: McpGrant[] = [];
        for (const member of members) {
            const result = await oauth.listUserGrants(member.id);
            for (const g of result.items) {
                grants.push(mapGrant(g, {
                    userId: member.id,
                    userEmail: member.email,
                    userRole: member.role,
                }));
            }
        }

        return c.json({ data: grants }, 200);
    });

export type McpGrantsApi = typeof mcpGrantsRoutes;
export default mcpGrantsRoutes;
