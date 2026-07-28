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

// Static asset extensions — these bypass JWT verification. We use a strict allowlist
// rather than path.includes('.') so a dot inside a path segment (e.g. "/inspections/foo.bar")
// can't trick the middleware into treating a protected route as public.
const STATIC_ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|json|txt|pdf)$/i;

export const jwtAuthMiddleware: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const path = c.req.path;
    const isAuthPublic = path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/setup' || path === '/api/auth/login/2fa';
    // Agent Accounts A1 + the agent unified link (Spec 3 — report token or one-time KV code, never a session).
    // Spec 3 Task 5 — core /agent-login dual-mode front door (password +
    // magic-link request); both are unauthenticated by design (the caller
    // holds neither a session nor a report token yet).
    const isAgentPublic = path.startsWith('/agent-invite/') || path === '/api/agents/accept' || path === '/agent-signup' || path === '/api/agent-signup' || path === '/agent/magic-login' || path === '/api/agent/magic-login/request' || path === '/api/agent/report-context' || path === '/api/agent/login' || path === '/api/agent/login-link';
    // Agent Accounts A3 — concierge magic-link entry points (client-facing,
    // no JWT). The token in the URL is the secret.
    const isConciergePublic =
        path.startsWith('/confirm/') ||
        path === '/api/concierge/confirm' ||
        path === '/api/concierge/book-info' ||
        path === '/api/concierge/book' ||
        path === '/api/concierge/confirm-info';
    const isPublic = path.startsWith('/api/__test__/') || path.startsWith('/api/public/') || path.startsWith('/api/integration/') || path.startsWith('/api/admin/connect') || path.startsWith('/api/admin/silo') || path.startsWith('/api/ics/') || path === '/book' || path.startsWith('/book/') || path.startsWith('/inspector/') || path.startsWith('/embed/') || path.startsWith('/photos/') || path === '/' || path === '/status' || path.startsWith('/static/') || path.startsWith('/report/') || path.startsWith('/report-view/') || path.startsWith('/invoice/') || path.startsWith('/agreements/sign/') || path.startsWith('/checkout/') || path.startsWith('/sign/') || path.startsWith('/m2m/') || path.startsWith('/verify/') || path.startsWith('/v/') || path.startsWith('/.well-known/') || STATIC_ASSET_EXT.test(path) || path === '/api/integrations/qbo/webhook' || path === '/api/integrations/stripe/webhook' || path.startsWith('/api/integrations/stripe/webhook/') || path.startsWith('/repair-request/') || path.startsWith('/repair-builder/') || path.startsWith('/api/portal/') || path.startsWith('/portal/');

    if (isAuthPublic || isPublic || isAgentPublic || isConciergePublic || path === '/setup' || path === '/login' || path === '/join') return next();

    // First-time setup is gated solely by the SETUP_CODE secret, validated in
    // POST /api/auth/setup. No KV bootstrap code is generated here.

    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : getCookie(c, '__Host-inspector_token');

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
