/**
 * Default-deny for the API surface, applied centrally by the JWT middleware.
 *
 * Until this existed, a request with no session reached every handler that did
 * not demand a role for itself, and in a single-tenant deployment the tenant is
 * resolved from configuration, so such a handler answered with real data (or
 * accepted a write). A deployment with a tenant claim in the token happened to
 * fail closed only because no tenant was present. This module makes both modes
 * fail closed by rule instead of by accident.
 *
 * Two rules, both on `/api/` paths only (pages are rendered by the SSR layer,
 * which forwards the visitor's cookie to the API on their behalf):
 *
 *   1. ANONYMOUS: a request with no identity is refused (401) unless the path
 *      is unauthenticated by design. That is `isUnauthenticatedPath` (the
 *      prefixes the middleware has always skipped: public booking, token-link
 *      tracks, webhooks, status, ...) or an entry of ANONYMOUS_API_ALLOW below.
 *   2. AGENT: an agent principal is a global account with no company context.
 *      It may only use the agent surface (AGENT_API_ALLOW); any other API path
 *      is refused (403) so an agent session never acquires staff context.
 *
 * Adding an entry is a security review item: write the reason, and prefer a
 * per-route requireRole over an allow-list entry.
 */
import { Errors } from '../errors';
import { isUnauthenticatedPath } from './public-paths';

export interface PathRule {
    /** Exact path, or a prefix when it ends with '/'; a RegExp for patterned paths. */
    readonly match: string | RegExp;
    readonly why: string;
}

/** Paths under /api/ that answer without a session, beyond `isUnauthenticatedPath`. */
export const ANONYMOUS_API_ALLOW: readonly PathRule[] = [
    { match: '/api/auth/sso', why: 'SSO code redemption: the one-time code is the credential' },
    { match: '/api/auth/invite-info', why: 'Invitation landing page: the invite token is the credential' },
    { match: '/api/auth/setup-status', why: 'First-run wizard asks whether setup is still open' },
    { match: '/api/auth/join', why: 'Accepting an invitation: the invite token is the credential' },
    { match: '/api/auth/forgot-password', why: 'Password reset request, by definition sent without a session' },
    { match: '/api/auth/reset-password', why: 'Password reset completion: the emailed token is the credential' },
    { match: '/api/auth/logout', why: 'Clears the cookie; harmless without a session' },
    { match: '/api/concierge/confirm-view', why: 'Concierge confirmation page: the magic-link token is the credential' },
    { match: '/api/calendar/callback', why: 'OAuth redirect from the calendar provider; authorized by its single-use state' },
    {
        match: /^\/api\/inspections\/[^/]+\/media\/video\/r2-object\/[^/]+(\/poster)?$/,
        why: 'The published web report plays R2 clips with no session; the pool-row id (UUID) is the capability',
    },
];

/** What an agent principal may reach. Everything else under /api/ is staff surface. */
export const AGENT_API_ALLOW: readonly PathRule[] = [
    { match: '/api/agent/', why: 'The agent portal API (each route still declares its own role gate)' },
    { match: '/api/agent-signup', why: 'Agent account signup and terms' },
    { match: '/api/identities/', why: 'Account export and deletion for any signed-in identity' },
    { match: '/api/auth/me', why: 'The signed-in identity, read by every layout' },
    { match: '/api/auth/logout', why: 'Ends the session, for every signed-in role' },
    { match: '/api/session/', why: 'Session context loaded by every signed-in page' },
];

export function matchesRule(rules: readonly PathRule[], path: string): boolean {
    return rules.some((r) => typeof r.match === 'string'
        ? (r.match.endsWith('/') ? path.startsWith(r.match) : path === r.match)
        : r.match.test(path));
}

/**
 * Throws 401 for an identity-less request to a protected API path, and 403 for
 * an agent principal on a staff path. No-op for non-API paths and public ones.
 */
export function enforceApiAccess(path: string, role: string | undefined): void {
    if (!path.startsWith('/api/')) return;
    if (!role) {
        if (isUnauthenticatedPath(path) || matchesRule(ANONYMOUS_API_ALLOW, path)) return;
        throw Errors.Unauthorized('Authentication required');
    }
    if (role === 'agent' && !isUnauthenticatedPath(path) && !matchesRule(AGENT_API_ALLOW, path)) {
        throw Errors.Forbidden('Agent accounts cannot use this endpoint');
    }
}
