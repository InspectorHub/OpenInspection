/**
 * Shared client-actor resolver for `/api/public/*` per-inspection routes.
 *
 * The unified client portal exposes per-inspection resources (documents,
 * messages, …) under `/api/public/inspections/:id/*`. The global JWT middleware
 * skips `/api/public/*` (server/index.ts isPublic allowlist), so each of these
 * routes must authenticate the CLIENT itself. Both client-documents and
 * client-messages share the exact same gate, so it lives here (DRY).
 *
 * A request is accepted when EITHER:
 *   - a per-inspection `?token=` (the persistent per-recipient portal token)
 *     resolves to a live client/co_client grant for THIS inspection, OR
 *   - the unified-portal session cookie `__Host-portal_session` (verified here,
 *     because the portal session middleware only runs on `/api/portal/*`)
 *     resolves to a live client/co_client grant for THIS inspection via
 *     PortalAccessService.resolveByEmailAndInspection.
 *
 * Only `client` / `co_client` roles are accepted (agents are NOT clients here).
 * Returns null → caller responds 401/403. The returned actor is always scoped to
 * the inspection id passed in, so the caller can trust `actor.tenantId` for all
 * downstream tenant scoping (never trust client input for tenant).
 */
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { resolvePortalAccess } from './public-access';
import { verifyPortalSession } from './portal-session';

export interface ClientActor {
    tenantId: string;
    kind: 'client' | 'co_client';
    ref: string;          // recipient email (uploader / sender identity)
    name: string | null;
    /**
     * `inspection_access_tokens.id` for the grant that authorised this actor —
     * the same value on BOTH entry paths. Per-recipient state hangs off this
     * row (the delivery-confirmation counter, the Art. 21 view-tracking
     * objection); resolving it here is what stops a right from working over
     * `?token=` and silently not over the session cookie.
     */
    accessTokenId: string;
}

/**
 * Any live recipient of this inspection — client, co_client, agent, or a
 * tenant-custom role — reached by EITHER portal entry path.
 *
 * `resolveClientActor` below is this function plus a client/co_client filter.
 * They must stay one implementation: the pair of entry paths is the thing that
 * drifts, and a second copy of it is a second place for one of them to be
 * forgotten.
 *
 * Callers that act on a recipient's OWN rights (rather than on the client's
 * documents/messages/invoice) want THIS one. An Art. 21 objection restricted
 * to client-kind roles would be unreachable for exactly the recipients the LIA
 * identifies as having the weakest expectation — agents and one-off shares.
 */
export interface PortalRecipient {
    tenantId: string;
    role: string;
    ref: string;
    accessTokenId: string;
}

export async function resolvePortalRecipient(
    c: Context<HonoConfig>,
    inspectionId: string,
    /**
     * Optional role filter. Applied INDEPENDENTLY to each entry path, so a
     * request that carries a non-matching `?token=` still falls through to the
     * session cookie — the pre-existing `resolveClientActor` behaviour.
     */
    accept: (role: string) => boolean = () => true,
): Promise<PortalRecipient | null> {
    const token = c.req.query('token');
    const grant = await resolvePortalAccess(c.var.services.portalAccess, token, inspectionId);
    if (grant && accept(grant.role)) {
        return {
            tenantId: grant.tenantId, role: grant.role,
            ref: grant.recipientEmail, accessTokenId: grant.accessTokenId,
        };
    }
    const cookie = getCookie(c, '__Host-portal_session');
    const sess = cookie ? await verifyPortalSession(c.env.JWT_SECRET, cookie) : null;
    if (sess) {
        const row = await c.var.services.portalAccess.resolveByEmailAndInspection(sess.email, inspectionId);
        if (row && accept(row.role)) {
            return { tenantId: row.tenantId, role: row.role, ref: sess.email, accessTokenId: row.id };
        }
    }
    return null;
}

const isClientKind = (role: string) => role === 'client' || role === 'co_client';

export async function resolveClientActor(
    c: Context<HonoConfig>,
    inspectionId: string,
): Promise<ClientActor | null> {
    const r = await resolvePortalRecipient(c, inspectionId, isClientKind);
    if (!r) return null;
    return {
        tenantId: r.tenantId, kind: r.role as 'client' | 'co_client',
        ref: r.ref, name: null, accessTokenId: r.accessTokenId,
    };
}
