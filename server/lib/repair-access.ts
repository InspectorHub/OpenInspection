/**
 * Repair-builder access resolution.
 *
 * Resolves tenantId + Creator from the same three modes as the public report
 * route (portal token → legacy agent KV token → owner-preview JWT), returning
 * null when none succeed.
 *
 * Extracted from server/api/repair-builder.ts (pure movement).
 */

import type { Context } from 'hono';
import { resolvePortalAccess, resolveOwnerPreviewFull, resolveAgentSession } from './public-access';
import type { Creator } from '../services/repair-request.service';
import type { HonoConfig } from '../types/hono';

/**
 * Resolves tenantId + Creator from the same three modes as the public report
 * route (portal token → legacy agent KV token → owner-preview JWT), returning
 * null when none succeed.
 *
 * creator.ref semantics:
 *   client    → recipientEmail (stable per-recipient identifier from the token row)
 *   agent     → the raw legacy KV token string, OR the agent's stable userId when
 *               authenticated via a logged-in agent-portal session JWT
 *   inspector → userId from the verified owner-preview JWT
 */
/** Whether the resolved actor may read only, or read and write. */
export type BuilderAccessLevel = 'read' | 'readwrite';

export async function resolveBuilderAccess(
    c: Context<HonoConfig>,
    id: string,
): Promise<{ tenantId: string; creator: Creator; ownerPreview: boolean; accessLevel: BuilderAccessLevel } | null> {
    const token = c.req.query('token');

    // Whether/how an agent may act on the repair list is a tenant policy
    // (IA-35 / IA-73): off → no access at all, read → view only (writes 403),
    // readwrite → full. Both agent tracks (portal token and agent session) go
    // through here, so they can never disagree. client / inspector actors are
    // always readwrite.
    const agentLevel = async (tenantId: string): Promise<BuilderAccessLevel | null> => {
        const setting = await c.var.services.inspection.getAgentRepairAccess(tenantId);
        return setting === 'off' ? null : setting;
    };

    // Path 1: persistent portal token. The grant's role kind decides the actor —
    // assuming 'client' for every resolvable token let an agent-kind token
    // (buyer_agent / listing_agent) act as the client on the builder's five
    // write endpoints (IA-35), exactly what the sibling client-actor resolver
    // guards against. client/co_client → client; agent → agent; anything else
    // (attorney, title company, …) has no builder role → reject.
    const grant = await resolvePortalAccess(c.var.services.portalAccess, token, id);
    if (grant) {
        const kind = await c.var.services.portalAccess.getRoleKind(grant.tenantId, grant.role);
        if (kind === 'client') {
            return { tenantId: grant.tenantId, creator: { kind: 'client', ref: grant.recipientEmail }, ownerPreview: false, accessLevel: 'readwrite' };
        }
        if (kind === 'agent') {
            const accessLevel = await agentLevel(grant.tenantId);
            if (!accessLevel) return null;
            return { tenantId: grant.tenantId, creator: { kind: 'agent', ref: grant.recipientEmail }, ownerPreview: false, accessLevel };
        }
        return null;
    }

    // Path 2: legacy KV agent-view token (existing share links).
    if (token) {
        const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
        if (legacy && legacy.inspectionId === id) {
            const accessLevel = await agentLevel(legacy.tenantId);
            if (!accessLevel) return null;
            return { tenantId: legacy.tenantId, creator: { kind: 'agent', ref: token }, ownerPreview: false, accessLevel };
        }
    }

    // Path 3: owner-preview via session Bearer JWT (tenant user / inspector).
    const ownerFull = await resolveOwnerPreviewFull(c);
    if (ownerFull) {
        return { tenantId: ownerFull.tenantId, creator: { kind: 'inspector', ref: ownerFull.userId }, ownerPreview: true, accessLevel: 'readwrite' };
    }

    // Path 4: logged-in agent-portal session JWT (tokenless dashboard link).
    // The agent JWT classifies as kind:'agent' and carries NO tenantId, so it is
    // rejected by owner-preview above. Verify the session, then confirm the agent
    // is actually associated with THIS inspection — deriving the tenantId from the
    // inspection row, never from the URL `:tenant` segment.
    const agentSession = await resolveAgentSession(c);
    if (agentSession) {
        const assoc = await c.var.services.agent.accessToInspection(agentSession.userId, id);
        if (assoc) {
            const accessLevel = await agentLevel(assoc.tenantId);
            if (!accessLevel) return null;
            return { tenantId: assoc.tenantId, creator: { kind: 'agent', ref: agentSession.userId }, ownerPreview: false, accessLevel };
        }
    }

    return null;
}
