/**
 * Global JWT middleware — resolves tenantId / userRole from a Bearer token or
 * the `__Host-inspector_token` cookie, then injects the tenant-scoped DB.
 *
 * It lives here rather than in the composition root for a reason that is not
 * cosmetic: `server/index.ts` imports every route module, and type-aware linting
 * a file with that import fan-in exhausts a 6GB heap (measured: SIGABRT at 4GB
 * after 91s, at 6GB after 189s), so the entry file is exempt from type-aware
 * rules in eslint.config.js. This is authentication code — cross-tenant guard,
 * token invalidation, ScopedDB injection — and it must stay under
 * `no-floating-promises` and the rest of the typed rule set. Anything
 * security-bearing belongs on this side of that line, not in the entry.
 *
 * ORDERING (A-16): registered after contextBootstrap / tenantRouter / branding
 * (which resolve host- and slug-derived context) and before
 * integrationSecretsMiddleware + diMiddleware (both tenant-scoped, so they must
 * see the tenantId this sets). `tests/unit/platform/middleware-order.spec.ts`
 * pins that position.
 */
import { getCookie, deleteCookie } from 'hono/cookie';
import { drizzle } from 'drizzle-orm/d1';
import type { MiddlewareHandler } from 'hono';
import { verifyJwt } from '../jwt-keyring';
import { classifyJwtPayload } from '../auth/jwt-claims';
import { AppError, Errors } from '../errors';
import { logger } from '../logger';
import type * as schema from '../db/schema';
import type { HonoConfig } from '../../types/hono';
import type { UserRole } from '../../types/auth';
import { bearerToken, AUTH_COOKIE_NAME } from '../auth-helpers';
import { readPlatformActorClaim } from '../platform-actor-claims';
import { QBO_CALLBACK_PATH } from '../qbo-oauth-paths';

// Static asset extensions — these bypass JWT verification. We use a strict allowlist
// rather than path.includes('.') so a dot inside a path segment (e.g. "/inspections/foo.bar")
// can't trick the middleware into treating a protected route as public.
const STATIC_ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|json|txt|pdf)$/i;

/**
 * Is this path a static asset, and therefore outside authentication?
 *
 * ⚠️ AN EXTENSION IS NOT A CLASSIFICATION ON ITS OWN. The test used to be the
 * bare regex above, and it matched `/api/...` too -- so EVERY API route whose
 * path ends in one of those extensions skipped authentication entirely, before
 * a token was even read.
 *
 * Measured on `/api/inspections/{id}/statutory-form.pdf`: the middleware
 * returned early, `userRole` was never set, and the route's own `requireRole`
 * answered 401 'No role found in context' -- so an inspector pressing Download
 * on a statutory form got an error, on every workspace, always. That one failed
 * CLOSED, which is why it read as a broken button rather than as this.
 *
 * The shape that does NOT fail closed is the same rule on a route that reads
 * `tenantId` without demanding a role: in standalone the tenant resolves from
 * the host, so such a route would have answered with real data and no session
 * at all. Naming one is not the point -- the point is that adding a `.json`
 * endpoint would have opened it silently, and nothing here would have said so.
 *
 * Static assets are served by the Cloudflare assets layer before this worker
 * runs; what reaches here under an asset extension is either a miss or an API
 * route wearing a file name. Neither is a reason to skip authentication.
 */
function isStaticAssetPath(path: string): boolean {
    if (path.startsWith('/api/')) return false;
    return STATIC_ASSET_EXT.test(path);
}

export const jwtAuthMiddleware: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const path = c.req.path;
    const isAuthPublic = path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/setup' || path === '/api/auth/login/2fa';
    // Agent Accounts A1 + the agent unified link (Spec 3 — report token or one-time KV code, never a session).
    // Spec 3 Task 5 — core /agent-login dual-mode front door (password +
    // magic-link request); both are unauthenticated by design (the caller
    // holds neither a session nor a report token yet).
    //
    // `/api/agent-signup/terms` is listed SEPARATELY because these are exact
    // matches, not prefixes: `path === '/api/agent-signup'` does not cover a
    // child path. The signup page must display the agent terms before anyone
    // has an account, so a document nobody can read without a session would
    // leave the tick asserting a presentation that never happened.
    const isAgentPublic = path.startsWith('/agent-invite/') || path === '/api/agents/accept' || path === '/agent-signup' || path === '/api/agent-signup' || path === '/api/agent-signup/terms' || path === '/agent/magic-login' || path === '/api/agent/magic-login/request' || path === '/api/agent/report-context' || path === '/api/agent/login' || path === '/api/agent/login-link';
    // Agent Accounts A3 — concierge magic-link entry points (client-facing,
    // no JWT). The token in the URL is the secret.
    const isConciergePublic =
        path.startsWith('/confirm/') ||
        path === '/api/concierge/confirm' ||
        path === '/api/concierge/book-info' ||
        path === '/api/concierge/book' ||
        path === '/api/concierge/confirm-info';
    // `/unsubscribe/:token` is listed for a reason worth writing down: it is the
    // PAGE the emailed link lands on, and the person clicking it may well be
    // signed in — an agent reading their mail in the browser they work in. If
    // the JWT middleware classified them here, `agentUserId` would be set and
    // `agentTermsGate` (mounted on `*`, so it covers pages too) would hold the
    // page as well as the API. Listing it keeps the whole flow outside the
    // gate's reckoning rather than exempted from it; the API half is already
    // covered by the `/api/public/` prefix. See `server/api/unsubscribe.ts`.
    // `/webhooks/` below covers every inbound provider webhook in one prefix:
    // they mount at the top level (see server/index.ts) precisely so they inherit
    // none of the /api/* middleware, and each one authenticates itself by
    // verifying the producer's signature over the raw body. A per-path list here
    // was one forgotten entry away from a webhook that 401s in production only.
    // `QBO_CALLBACK_PATH` is public for the same shape of reason but is NOT a
    // webhook — it is the OAuth callback, so it keeps its own exact-match entry.
    // Neither caller can hold a session. Intuit returns the
    // user by cross-site top-level navigation, and `__Host-inspector_token` is
    // SameSite=Strict, so no cookie is on that request — the route is authorized
    // by a single-use, 600s, owner/manager-issued `state` instead. See
    // `server/api/qbo-oauth.ts`.
    const isPublic = path.startsWith('/api/__test__/') || path.startsWith('/api/public/') || path.startsWith('/api/platform/') || path.startsWith('/api/admin/connect') || path.startsWith('/api/admin/silo') || path.startsWith('/api/ics/') || path === '/book' || path.startsWith('/book/') || path.startsWith('/inspector/') || path.startsWith('/embed/') || path.startsWith('/photos/') || path === '/' || path === '/status' || path.startsWith('/static/') || path.startsWith('/report/') || path.startsWith('/report-view/') || path.startsWith('/invoice/') || path.startsWith('/agreements/sign/') || path.startsWith('/checkout/') || path.startsWith('/sign/') || path.startsWith('/m2m/') || path.startsWith('/verify/') || path.startsWith('/v/') || path.startsWith('/.well-known/') || isStaticAssetPath(path) || path.startsWith('/webhooks/') || path === QBO_CALLBACK_PATH || path.startsWith('/unsubscribe/') || path.startsWith('/repair-request/') || path.startsWith('/repair-builder/') || path.startsWith('/api/portal/') || path.startsWith('/portal/');

    if (isAuthPublic || isPublic || isAgentPublic || isConciergePublic || path === '/setup') return next();

    // First-time setup is gated solely by the SETUP_CODE secret, validated in
    // POST /api/auth/setup. No KV bootstrap code is generated here.

    const token = bearerToken(c) ?? getCookie(c, AUTH_COOKIE_NAME);

    if (!token) return next();

    // Resolve the per-request keyring (built lazily in diMiddleware). If the
    // worker is misconfigured (no JWT_CURRENT_KID or no matching keypair),
    // buildKeyring rejects — surface as 500 so the request fails closed.
    let keyring;
    try {
        keyring = await c.var.keyringPromise!;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('JWT keyring failed to build', { message: msg });
        throw Errors.Internal('Server configuration error');
    }

    try {
        // Decode header first so we can reject non-JWT-typed tokens before spending CPU on
        // signature verification.
        const headerPart = token.split('.')[0];
        if (headerPart) {
            try {
                // JSON.parse returns `any`, and this value came off the wire: an
                // attacker picks its shape. Read it as unknown so the `typ`
                // comparison below is the only thing we ever do with it.
                const header = JSON.parse(atob(headerPart.replace(/-/g, '+').replace(/_/g, '/'))) as { typ?: unknown } | null;
                const typ = header?.typ;
                if (typ && typ !== 'JWT') {
                    throw Errors.Unauthorized('Unsupported token type');
                }
            } catch (err) {
                if (err instanceof AppError) throw err;
                // Malformed header — fall through to verify() which will reject.
            }
        }

        const payload = await verifyJwt(token, keyring);
        const classification = classifyJwtPayload(payload);
        const userId = payload.sub as string | undefined;
        const tokenIat = payload.iat as number | undefined;

        // Reject tokens issued before the user's last password change / reset.
        //
        // TENANT_CACHE is declared as a required binding, so the type says this
        // guard can never fail; it is annotated as optional here because a
        // misconfigured deploy is exactly the case it exists for. Note what that
        // means: with no KV bound, session invalidation is SKIPPED rather than
        // enforced, so a token issued before a password reset keeps working.
        // Making it fail closed instead is a deliberate change, not a cleanup.
        const cache = c.env.TENANT_CACHE as KVNamespace | undefined;
        if (userId && cache) {
            const invalidatedAt = await cache.get(`pwchanged:${userId}`);
            if (invalidatedAt) {
                const invalidatedTs = parseInt(invalidatedAt, 10);
                if (!tokenIat || tokenIat < invalidatedTs) {
                    throw Errors.Unauthorized('Token has been invalidated');
                }
            }
        }

        // Agent Accounts A1 — JWTs minted for global agent accounts intentionally
        // carry no `tenantId` claim. Set `agentUserId` instead so per-route
        // handlers can resolve a tenant via resolveAgentTenant() and confirm the
        // active link before any tenant-scoped query runs.
        if (classification?.kind === 'agent') {
            c.set('userRole', 'agent' as UserRole);
            c.set('agentUserId', classification.userId);
            c.set('user', {
                sub: classification.userId,
                role: 'agent',
                // tenantId intentionally undefined — per-route resolution required.
            });
        } else if (classification?.kind === 'tenant') {
            c.set('tenantId', classification.tenantId);
            c.set('userRole', classification.role);
            // Populate the per-request user context. Email is intentionally not carried in the JWT
            // anymore — routes that need it (e.g. /me) look it up from the DB.
            c.set('user', {
                sub: classification.userId,
                role: classification.role,
                tenantId: classification.tenantId,
            });
        } else if (classification?.kind === 'unscoped') {
            // Inspector-class role without a tenantId claim — historically this branch
            // was tolerated. Preserve behavior for backwards-safety on existing tokens.
            c.set('userRole', classification.role);
            c.set('user', {
                sub: classification.userId,
                role: classification.role,
                tenantId: '' as string,
            });
        }

        // A SUPPORT SESSION SAYS SO IN ITS OWN TOKEN.
        //
        // Somebody at the deployment operator opens a workspace by being signed in
        // AS one of its own administrators, so `sub` is a real member of that
        // workspace and stays that way — it is the account the action ran under.
        // This carries the second fact nothing recorded before: somebody else was
        // driving. Trustworthy for the same reason `custom:tenantId` is — the
        // keyring signed it — and never read from a request header. The pair rule
        // and the claim names live in ./platform-actor-claims.ts.
        const supportActor = readPlatformActorClaim(payload as Record<string, unknown>);
        if (supportActor) c.set('platformActor', supportActor);

    } catch (err: unknown) {
        // Clear the bad cookie so the browser stops re-sending it on every request.
        deleteCookie(c, '__Host-inspector_token', { path: '/', secure: true, sameSite: 'Strict' });
        if (err instanceof AppError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.info(`[JWT] Token verification failed: ${message}`);
        throw Errors.Unauthorized('Invalid or expired token');
    }

    // --- Tenant Isolation Guard (Fail-Fast) ---
    // In SaaS mode, strictly verify that the token's tenant matches the requested slug's tenant.
    if (c.var.profile.mode === 'saas') {
        const tokenTenantId = c.get('tenantId');
        const resolvedTenantId = c.get('resolvedTenantId');

        // If both are present and they DON'T match, it's a cross-tenant breach attempt.
        if (tokenTenantId && resolvedTenantId && tokenTenantId !== resolvedTenantId) {
            logger.warn(`[Guard] BLOCKING cross-tenant access: Token(${tokenTenantId}) -> Host(${resolvedTenantId})`);
            logger.error('Cross-tenant access attempt blocked', {
                tokenTenantId,
                requestedTenantId: resolvedTenantId,
                path: c.req.path
            });
            throw Errors.Forbidden('Access denied: cross-tenant authorization failure.');
        }
    }


    // --- Scoped DB Injection ---
    const tenantIdForDb = c.get('tenantId') || c.get('resolvedTenantId');
    if (tenantIdForDb) {
        const { createScopedDb } = await import('../db/scoped');
        const db = drizzle(c.env.DB);
        c.set('sdb', createScopedDb(db as unknown as ReturnType<typeof drizzle<typeof schema>>, tenantIdForDb));
    }

    return next();
};
