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
}

export async function resolveClientActor(
    c: Context<HonoConfig>,
    inspectionId: string,
): Promise<ClientActor | null> {
    const token = c.req.query('token');
    const grant = await resolvePortalAccess(c.var.services.portalAccess, token, inspectionId);
    if (grant && (grant.role === 'client' || grant.role === 'co_client')) {
        return { tenantId: grant.tenantId, kind: grant.role, ref: grant.recipientEmail, name: null };
    }
    const cookie = getCookie(c, '__Host-portal_session');
    const sess = cookie ? await verifyPortalSession(c.env.JWT_SECRET, cookie) : null;
    if (sess) {
        const row = await c.var.services.portalAccess.resolveByEmailAndInspection(sess.email, inspectionId);
        if (row && (row.role === 'client' || row.role === 'co_client')) {
            return { tenantId: row.tenantId, kind: row.role, ref: sess.email, name: null };
        }
    }
    return null;
}
