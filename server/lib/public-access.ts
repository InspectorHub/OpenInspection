/**
 * Shared guard for the public, no-login portal endpoints (`/api/public/*`).
 *
 * Validates a PERSISTENT per-(recipient, order) portal token against the
 * inspection it claims to grant access to, and returns the AUTHORITATIVE
 * {tenantId, role, recipientEmail} from the token row — NEVER the URL `:tenant`
 * segment. Callers MUST 404 on null and use the returned tenantId for every
 * subsequent query. `now` is injectable for deterministic tests.
 *
 * See memory project_client_portal_token_model.
 */

export type PortalRole = 'client' | 'co_client' | 'agent';

export interface PortalAccessRow {
    inspectionId: string;
    tenantId: string;
    role: PortalRole;
    recipientEmail: string;
    revokedAt: number | null;
    expiresAt: number | null;
}

export interface PortalAccessResolver {
    resolveToken(token: string): Promise<PortalAccessRow | null>;
}

export interface PortalAccessGrant {
    tenantId: string;
    role: PortalRole;
    recipientEmail: string;
}

export async function resolvePortalAccess(
    svc: PortalAccessResolver,
    token: string | undefined,
    requestedInspectionId: string,
    now: number = Date.now(),
): Promise<PortalAccessGrant | null> {
    if (!token) return null;
    const row = await svc.resolveToken(token);
    if (!row) return null;
    if (row.inspectionId !== requestedInspectionId) return null;
    if (row.revokedAt != null) return null;
    if (row.expiresAt != null && row.expiresAt <= now) return null;
    return { tenantId: row.tenantId, role: row.role, recipientEmail: row.recipientEmail };
}

/**
 * Guard for the public live-observer view (`/observe/inspections/:id`). The
 * OBSERVER link is a DISTINCT capability from the portal token — it is resolved
 * via ObserverLinkService.claim(), which short-circuits on revoked/expired and
 * returns the row's tenantId. We return the AUTHORITATIVE tenantId (from the
 * claimed link, never the URL) only when the link grants access to exactly the
 * requested inspection; otherwise null (→ caller 404s).
 */
export type ObserverClaim =
    | { kind: 'ok'; inspectionId: string; tenantId: string }
    | { kind: 'expired' | 'revoked' | 'not_found' };

export interface ObserverAccessResolver {
    claim(token: string): Promise<ObserverClaim>;
}

export async function resolveObserverAccess(
    svc: ObserverAccessResolver,
    token: string | undefined,
    requestedInspectionId: string,
): Promise<{ tenantId: string } | null> {
    if (!token) return null;
    const claim = await svc.claim(token);
    if (claim.kind !== 'ok') return null;
    if (claim.inspectionId !== requestedInspectionId) return null;
    return { tenantId: claim.tenantId };
}
