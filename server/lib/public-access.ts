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

import type { Context } from 'hono';
import { verifyJwt, type JwtKeyring } from './jwt-keyring';
import { classifyJwtPayload } from './auth/jwt-claims';
import type { HonoConfig } from '../types/hono';

// A role-profile KEY (tenant.contact_role_profiles.key) — free-form, not a
// fixed set. `client` remains the seeded default; validation against the
// tenant's active role profiles happens in PortalAccessService.issueToken.
export type PortalRole = string;

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
type ObserverClaim =
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

/**
 * Testable core of the owner-session preview fallback. Given a raw session JWT
 * (Bearer value, already stripped of the "Bearer " prefix), the per-request
 * keyring, and an optional KV getter for password-change invalidation, returns
 * the authenticated user's tenantId — or null on ANY failure (missing token,
 * bad signature, expired, non-tenant class, or KV-invalidated). Fail-closed so
 * an invalid token can never widen public access.
 *
 * Ownership of a specific inspection is NOT asserted here; the caller hands the
 * returned tenantId to a tenant-scoped query (getReportData), which 404s on a
 * cross-tenant id.
 *
 * Moved here from public-report.ts (where it was exported) so the builder
 * and other lib-level callers can import it without going through an api module.
 */
export async function resolveOwnerPreviewToken(
    token: string | undefined,
    keyring: JwtKeyring | undefined,
    kvGet?: (key: string) => Promise<string | null>,
): Promise<string | null> {
    if (!token || !keyring) return null;
    try {
        const payload = await verifyJwt(token, keyring);
        const classification = classifyJwtPayload(payload);
        if (classification?.kind !== 'tenant') return null;
        // Honor KV session invalidation (password change/reset/delete) — mirror
        // the global jwtAuthMiddleware so a revoked owner token can't preview.
        const userId = payload.sub as string | undefined;
        const tokenIat = payload.iat as number | undefined;
        if (userId && kvGet) {
            const invalidatedAt = await kvGet(`pwchanged:${userId}`);
            if (invalidatedAt) {
                const invalidatedTs = parseInt(invalidatedAt, 10);
                if (!tokenIat || tokenIat < invalidatedTs) return null;
            }
        }
        return classification.tenantId;
    } catch {
        return null;
    }
}

/**
 * Extended owner-preview resolution that returns both tenantId and userId.
 * Used by the builder source endpoint so it can populate `creator.ref` with
 * the inspector/admin's userId (needed for `RepairRequestService.listMine`).
 */
async function resolveOwnerPreviewTokenFull(
    token: string | undefined,
    keyring: JwtKeyring | undefined,
    kvGet?: (key: string) => Promise<string | null>,
): Promise<{ tenantId: string; userId: string } | null> {
    if (!token || !keyring) return null;
    try {
        const payload = await verifyJwt(token, keyring);
        const classification = classifyJwtPayload(payload);
        if (classification?.kind !== 'tenant') return null;
        const userId = payload.sub as string | undefined;
        if (!userId) return null;
        const tokenIat = payload.iat as number | undefined;
        if (kvGet) {
            const invalidatedAt = await kvGet(`pwchanged:${userId}`);
            if (invalidatedAt) {
                const invalidatedTs = parseInt(invalidatedAt, 10);
                if (!tokenIat || tokenIat < invalidatedTs) return null;
            }
        }
        return { tenantId: classification.tenantId, userId };
    } catch {
        return null;
    }
}

/**
 * Testable core of the agent-session fallback. Given a raw session JWT (Bearer
 * value, already stripped of "Bearer "), the per-request keyring, and an
 * optional KV getter for password-change invalidation, returns the agent's
 * stable userId — or null on ANY failure (missing token, bad signature,
 * expired, non-agent class, or KV-invalidated). Fail-closed.
 *
 * Agent JWTs classify as `{ kind: 'agent' }` (tenantId is NOT in the token —
 * agents are global users). Tenant association for a specific inspection is
 * asserted by the CALLER (AgentService.accessToInspection), never here.
 */
async function resolveAgentSessionToken(
    token: string | undefined,
    keyring: JwtKeyring | undefined,
    kvGet?: (key: string) => Promise<string | null>,
): Promise<{ userId: string } | null> {
    if (!token || !keyring) return null;
    try {
        const payload = await verifyJwt(token, keyring);
        const classification = classifyJwtPayload(payload);
        if (classification?.kind !== 'agent') return null;
        const userId = classification.userId;
        const tokenIat = payload.iat as number | undefined;
        if (kvGet) {
            const invalidatedAt = await kvGet(`pwchanged:${userId}`);
            if (invalidatedAt) {
                const invalidatedTs = parseInt(invalidatedAt, 10);
                if (!tokenIat || tokenIat < invalidatedTs) return null;
            }
        }
        return { userId };
    } catch {
        return null;
    }
}

/**
 * Agent-session fallback for per-inspection agent capabilities (repair builder).
 * Reads + verifies the relayed session Bearer JWT (the same token the agent
 * portal dashboard holds) and returns the agent's userId, or null. The global
 * JWT middleware skips `/api/public/*`, so we verify the token HERE.
 */
export async function resolveAgentSession(
    c: Context<HonoConfig>,
): Promise<{ userId: string } | null> {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) return null;
    const keyring = await c.var.keyringPromise?.catch(() => undefined);
    const kv = c.env?.TENANT_CACHE;
    return resolveAgentSessionToken(token, keyring, kv ? (k) => kv.get(k) : undefined);
}

/**
 * Owner-session preview fallback for the public report endpoints.
 *
 * The owner's "View report" link (dashboard / inspection hub) deep-links into
 * the public report tokenlessly so the inspector/admin can preview exactly what
 * a client sees. Those routes are otherwise gated by a per-recipient portal
 * token, which the owner does not hold. The global JWT middleware skips
 * `/api/public/*` (server/index.ts), so the owner's relayed session Bearer token
 * is never verified upstream — we verify it HERE instead.
 *
 * Returns the resolved tenantId, or null on any failure.
 */
export async function resolveOwnerPreview(c: Context<HonoConfig>): Promise<string | null> {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    // Public client viewers carry no Bearer token — bail before touching the
    // keyring or KV so the common (tokenless-public) path stays side-effect-free.
    if (!token) return null;
    const keyring = await c.var.keyringPromise?.catch(() => undefined);
    const kv = c.env?.TENANT_CACHE;
    return resolveOwnerPreviewToken(token, keyring, kv ? (k) => kv.get(k) : undefined);
}

/**
 * Extended owner-preview fallback that also returns the userId, for callers
 * (e.g. the builder source endpoint) that need to populate creator.ref.
 */
export async function resolveOwnerPreviewFull(
    c: Context<HonoConfig>,
): Promise<{ tenantId: string; userId: string } | null> {
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) return null;
    const keyring = await c.var.keyringPromise?.catch(() => undefined);
    const kv = c.env?.TENANT_CACHE;
    return resolveOwnerPreviewTokenFull(token, keyring, kv ? (k) => kv.get(k) : undefined);
}
