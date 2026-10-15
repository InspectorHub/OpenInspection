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
import type { Context, MiddlewareHandler } from 'hono';
import { verifyJwt } from '../jwt-keyring';
import { classifyJwtPayload } from '../auth/jwt-claims';
import { AppError, Errors } from '../errors';
import { logger } from '../logger';
import type * as schema from '../db/schema';
import type { HonoConfig } from '../../types/hono';
import type { UserRole } from '../../types/auth';
import { bearerToken, AUTH_COOKIE_NAME } from '../auth-helpers';
import { readPlatformActorClaim } from '../platform-actor-claims';
import { isUnauthenticatedPath } from '../auth/public-paths';
import { enforceApiAccess } from '../auth/api-access-policy';
import { memoOnce } from '../request-scope';
import { looksLikeOpaqueOAuthToken, resolveNativeToken } from '../auth/native-token';
import { enforceClientVersion } from '../native/client-version';
import { applyWsTicketIdentity } from '../native/ws-ticket';

/** Resolve a native OAuth access token to the request identity, or throw 401. */
async function applyNativeIdentity(c: Context<HonoConfig>, token: string): Promise<void> {
    const native = await memoOnce(c.env, `native:${token}`, () => resolveNativeToken(c.env, token));
    if (!native) throw Errors.Unauthorized('Invalid or expired token');
    c.set('tenantId', native.tenantId);
    c.set('userRole', native.role);
    c.set('user', { sub: native.userId, role: native.role, tenantId: native.tenantId });
    c.set('nativeClient', true);
    enforceClientVersion(c);
}

/** Verify a session JWT and write its identity onto the request context. */
async function applyJwtIdentity(c: Context<HonoConfig>, token: string): Promise<void> {
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

        // Same token, same keyring => same payload; verification is a pure
        // function of the two. A page render re-enters this chain 16 times
        // through the in-process API fan-out, and ECDSA verification of that one
        // token cost 14.84ms/request (measured 2026-09-06).
        const payload = await memoOnce(c.env, `jwt:${token}`, () => verifyJwt(token, keyring));
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
            // Workers KV is eventually consistent -- a write can take up to 60
            // seconds to propagate -- so re-reading this marker 16 times inside
            // one ~350ms render cannot observe anything a single read would
            // miss. The freshness those 15 extra reads appear to buy does not
            // exist. Only the read is shared; the comparison below still runs
            // on every pass.
            const invalidatedAt = await memoOnce(c.env, `pwchanged:${userId}`,
                () => cache.get(`pwchanged:${userId}`));
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
}

export const jwtAuthMiddleware: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const path = c.req.path;
    if (isUnauthenticatedPath(path)) return next();

    // First-time setup is gated solely by the SETUP_CODE secret, validated in
    // POST /api/auth/setup. No KV bootstrap code is generated here.

    const token = bearerToken(c) ?? getCookie(c, AUTH_COOKIE_NAME);

    // A token-less WebSocket upgrade may carry a one-time ticket instead (native
    // clients cannot set headers on a socket). Without one this is the usual
    // anonymous pass-through; with one, the identity lands here so the tenant
    // guard and scoped-DB injection below apply to it like any other.
    //
    // Otherwise native clients present the OAuth provider's opaque access token
    // and every other caller a session JWT. All end in the same identity shape.
    if (!token) {
        if (!(await applyWsTicketIdentity(c))) {
            enforceApiAccess(path, undefined);
            return next();
        }
    } else if (looksLikeOpaqueOAuthToken(token)) {
        await applyNativeIdentity(c, token);
    } else {
        await applyJwtIdentity(c, token);
    }
    // Default deny, in every mode: see ../auth/api-access-policy.ts.
    enforceApiAccess(path, c.get('userRole'));

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
