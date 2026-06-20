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
export async function resolveBuilderAccess(
    c: Context<HonoConfig>,
    id: string,
): Promise<{ tenantId: string; creator: Creator; ownerPreview: boolean } | null> {
    const token = c.req.query('token');

    // Path 1: persistent portal token (client / co_client / agent role).
    const grant = await resolvePortalAccess(c.var.services.portalAccess, token, id);
    if (grant) {
        const creator: Creator = { kind: 'client', ref: grant.recipientEmail };
        return { tenantId: grant.tenantId, creator, ownerPreview: false };
    }

    // Path 2: legacy KV agent-view token (existing share links).
    if (token) {
        const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
        if (legacy && legacy.inspectionId === id) {
            const creator: Creator = { kind: 'agent', ref: token };
            return { tenantId: legacy.tenantId, creator, ownerPreview: false };
        }
    }

    // Path 3: owner-preview via session Bearer JWT (tenant user / inspector).
    const ownerFull = await resolveOwnerPreviewFull(c);
    if (ownerFull) {
        const creator: Creator = { kind: 'inspector', ref: ownerFull.userId };
        return { tenantId: ownerFull.tenantId, creator, ownerPreview: true };
    }

    // Path 4: logged-in agent-portal session JWT (tokenless dashboard link).
    // The agent JWT classifies as kind:'agent' and carries NO tenantId, so it is
    // rejected by owner-preview above. Verify the session, then confirm the agent
    // is actually associated with THIS inspection — deriving the tenantId from the
    // inspection row, never from the URL `:tenant` segment.
    const agentSession = await resolveAgentSession(c);
    if (agentSession) {
        const access = await c.var.services.agent.accessToInspection(agentSession.userId, id);
        if (access) {
            const creator: Creator = { kind: 'agent', ref: agentSession.userId };
            return { tenantId: access.tenantId, creator, ownerPreview: false };
        }
    }

    return null;
}
