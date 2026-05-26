import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { agentTenantLinks } from '../db/schema/tenant';
import { Errors } from '../errors';
import type { HonoConfig } from '../../types/hono';

/**
 * Agent Accounts A1 — resolve the candidate tenant for an agent request.
 *
 * Agent JWTs intentionally carry no `tenantId` claim because a single agent can
 * be linked to multiple tenants (multi-to-multi via `agent_tenant_links`). Each
 * agent-scoped handler must therefore explicitly resolve the tenant from the
 * request (typically `?tenant=<subdomain>` or a path segment) and confirm that
 * the agent has an active link to it.
 *
 * Throws:
 *   - 401 Unauthorized when the request is not authenticated as an agent.
 *   - 403 Forbidden when the agent has no active link to the candidate tenant.
 */
export async function resolveAgentTenant(
    c: Context<HonoConfig>,
    candidateTenantId: string,
): Promise<string> {
    const agentUserId = c.get('agentUserId');
    if (!agentUserId) throw Errors.Unauthorized();

    const db = drizzle(c.env.DB);
    const link = await db
        .select({ id: agentTenantLinks.id })
        .from(agentTenantLinks)
        .where(
            and(
                eq(agentTenantLinks.agentUserId, agentUserId),
                eq(agentTenantLinks.tenantId, candidateTenantId),
                eq(agentTenantLinks.status, 'active'),
            ),
        )
        .get();

    if (!link) throw Errors.Forbidden('Agent not linked to this tenant');
    return candidateTenantId;
}
