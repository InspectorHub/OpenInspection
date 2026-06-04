import { OpenAPIHono } from '@hono/zod-openapi';
import { Context, MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/cloudflare-workers';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { signObserverCookie } from './lib/observer-cookie';
import { verifyJwt } from './lib/jwt-keyring';
import { classifyJwtPayload } from './lib/auth/jwt-claims';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as schema from './lib/db/schema';

import { brandingMiddleware } from './lib/middleware/branding';
import { contextBootstrap } from './lib/middleware/context-bootstrap';
import { integrationSecretsMiddleware } from './lib/middleware/integration-secrets';
import { enforceTenantActive } from './lib/middleware/tenant-status-guard';
import { inspectorPaletteMiddleware } from './lib/middleware/inspector-palette';
import { touchLastActiveMiddleware } from './lib/middleware/touch-last-active';
import { tenantRouter } from './features/tenant-routing';
import { diMiddleware } from './lib/middleware/di';
import { requireActiveSubscription } from './lib/middleware/tier-guard';
import { securityHeaders } from './lib/middleware/security-headers';
import { AppError, ErrorCode, Errors } from './lib/errors';
import { sendError } from './lib/response';
import { HonoConfig } from './types/hono';
import { UserRole } from './types/auth';
import { logger } from './lib/logger';
import { BUILD } from './generated/version';

import { setupWizardRoutes } from './features/setup-wizard';

import { OBSERVER_EXPIRED_PATH } from './lib/middleware/observer-cookie';
import { agreementSignPath } from './lib/public-urls';
import { loadVerifyData } from './lib/verify-data';


import coreAuthRoutes from './api/auth';
import identityRoutes from './api/identity';
import integrationsApiRoutes from './api/integrations';
import analyticsRoutes from './api/analytics';
import guestRoutes from './api/guest';
import billingRoutes from './api/billing';
import { registerPortalIntegration } from './portal/integration.module';
import inspectionsRoutes from './api/inspections';
import tenantPresenceRoutes from './api/tenant-presence';
import inspectionPrefsRoutes from './api/inspection-prefs';
import aiRoutes from './api/ai';
import bookingsRoutes from './api/bookings';
import adminRoutes from './api/admin';
import adminBrandingRoutes from './api/admin/branding';
import secretsRoutes from './api/secrets';
import emailTemplateRoutes from './api/email-templates';
import agentRoutes from './api/agent';
import agentsRoutes from './api/agents';
import agentSignupRoutes from './api/agent-signup';
import placesRoutes from './api/places';
import availabilityRoutes from './api/availability';
import calendarRoutes from './api/calendar';
import calendarEventsRoutes from './api/calendar-events';
import teamRoutes from './api/team';
import contactRoutes from './api/contacts';
import contactsImportRoutes from './api/contacts/import';
import invoiceRoutes from './api/invoices';
import servicesRoutes from './api/services';
import automationsRoutes from './api/automations';
import metricsRoutes from './api/metrics';
import marketplaceRoutes from './api/marketplace';
import templateMigrationRoutes from './api/template-migrations';
import dataRoutes from './api/data';
import icsRoutes from './api/ics';
import userRoutes from './api/users';
import messageRoutes from './api/messages';
import widgetRoutes from './api/widget';
import notificationsRoutes from './api/notifications';
import inspectionSyncRoutes from './api/inspection-sync';
import recommendationsRoutes from './api/recommendations';
import ratingSystemsRoutes from './api/rating-systems';
import eventsRoutes from './api/events';
import inspectionRequestsRoutes from './api/inspection-requests';
import repairRequestRoutes from './api/repair-requests';
import tagsRoutes, { inspectionTagRoutes } from './api/tags';
import publicSlugRoutes from './api/public-slug';
import publicShareRoutes from './api/public-share';
import publicReportRoutes from './api/public-report';
import profileRoutes from './api/profile';
import conciergeRoutes from './api/concierge';
import sessionContextRoutes from './api/session-context';
import qboRoutes from './api/qbo';
import qboWebhookRoutes from './api/qbo-webhook';
import stripeWebhookRoutes from './api/stripe-webhook';
import agreementsRenderRoutes from './api/agreements-render';
import evidenceRoutes from './api/evidence';
import wellKnownRoutes from './api/well-known';

const app = new OpenAPIHono<HonoConfig>({
    // Intercept Zod validation failures so the response body carries a readable
    // `error.message` + per-field map, instead of the default ZodError dump that
    // leaks `[ { expected, code, path, message } ]` to the UI.
    defaultHook: (result, c) => {
        if (result.success) return;
        const issues = result.error.issues;
        const fields: Record<string, string> = {};
        for (const i of issues) {
            const key = i.path.length ? i.path.join('.') : '_';
            if (!fields[key]) fields[key] = i.message;
        }
        const summary = issues
            .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
            .join('; ');
        return c.json({
            success: false,
            error: {
                code: 'VALIDATION_ERROR',
                message: summary || 'Validation failed',
                fields,
            },
        }, 400);
    },
});

// CORS — allows React Router v7 frontend (separate origin in dev) to call API endpoints.
// In production both share the same origin; this is primarily for local dev
// where Vite runs on :5173 and the API Worker runs on :8787.
app.use('/api/*', cors({
    origin: (origin) => origin,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Token-Relay'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Set-Cookie'],
}));

// Global request logger
app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    logger.info('Request processed', {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration: `${duration}ms`,
        tenantId: c.get('tenantId'), // Might be unset but that's okay
    });
});

// Health check
app.get('/status', (c) => c.json({
    status: 'ok',
    app: 'openinspection-core',
    commit: BUILD.shortCommit,
    branch: BUILD.branch,
    buildTime: BUILD.buildTime,
    timestamp: new Date().toISOString(),
}));


/**
 * Global Error Handler
 * Standardizes all application errors into a JSON response.
 */
app.onError((err: unknown, c: Context<HonoConfig>) => {
    // Robust check for AppError or any object carrying a status and code
    const isAppError = err instanceof AppError || (
        typeof err === 'object' && err !== null &&
        'status' in err && typeof (err as Record<string, unknown>).status === 'number' &&
        'code' in err && typeof (err as Record<string, unknown>).code === 'string'
    );

    if (isAppError) {
        const appErr = err as Record<string, unknown>;
        const status = appErr.status as number;
        return sendError(c, appErr.message as string, appErr.code as string, status as 500, appErr.details as Record<string, unknown> | undefined);
    }

    // Strip the query string before logging so one-shot secrets in URLs (e.g. ?reset_token=…)
    // don't get captured by downstream log sinks.
    const pathOnly = c.req.url.split('?')[0];
    logger.error('Unhandled application error', {
        method: c.req.method,
        url: pathOnly,
    }, err instanceof Error ? err : undefined);

    return sendError(c, 'Internal server error', ErrorCode.INTERNAL_ERROR, 500);
});

// Static assets
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const staticOpts = (opts: Record<string, string>): any => opts;
app.get('/favicon.svg', serveStatic(staticOpts({ path: './favicon.svg' })));
app.get('/logo.svg', serveStatic(staticOpts({ path: './logo.svg' })));
app.get('/vendor/*', serveStatic(staticOpts({ root: './' })));
app.get('/fonts.css', serveStatic(staticOpts({ path: './fonts.css' })));
app.get('/fonts/*', serveStatic(staticOpts({ root: './' })));

// Booking #7 Sprint C-1 — public R2 photo passthrough used by inspector
// profile photos uploaded via POST /api/profile/photo. The R2 key is
// tenant-prefixed and includes the userId, so it isn't guessable; only
// inspector-photos/* paths are exposed to keep other tenant assets private.
app.get('/photos/tenants/:tenantId/inspector-photos/:filename', async (c) => {
    const tenantId = c.req.param('tenantId');
    const filename = c.req.param('filename');
    if (!c.env.PHOTOS) return c.notFound();
    const key = `tenants/${tenantId}/inspector-photos/${filename}`;
    const obj = await c.env.PHOTOS.get(key);
    if (!obj) return c.notFound();
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('etag', obj.httpEtag);
    return new Response(obj.body, { headers });
});

// Global Middlewares.
//
// ORDERING (A-16): the chain is two-phase around the JWT middleware.
//   Before JWT: contextBootstrap (profile + keyring — JWT awaits the keyring),
//   tenantRouter / branding / tenant-active (host- and slug-derived context).
//   After JWT:  integrationSecretsMiddleware + diMiddleware — both are
//   tenant-scoped and must see the JWT's `tenantId`. They used to run BEFORE
//   the JWT middleware, so on authed API requests the tenant was still unknown:
//   di's email/AI preloads never loaded (per-tenant sender identity + Gemini
//   BYOK silently fell back to platform defaults) and, in saas mode, the
//   tenant's integration secrets never merged into c.env.
app.use('*', securityHeaders);
app.use('*', contextBootstrap);
app.use('*', tenantRouter);
app.use('*', brandingMiddleware);
app.use('*', enforceTenantActive);

// Static asset extensions — these bypass JWT verification. We use a strict allowlist
// rather than path.includes('.') so a dot inside a path segment (e.g. "/inspections/foo.bar")
// can't trick the middleware into treating a protected route as public.
const STATIC_ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|json|txt|pdf)$/i;

// Global JWT Middleware — extracts tenantId / userRole from Bearer token or cookie.
// Named + exported so the middleware-order regression test can pin its position
// relative to the tenant-scoped middlewares that must run after it (A-16).
export const jwtAuthMiddleware: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const path = c.req.path;
    const isAuthPublic = path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/setup' || path === '/api/auth/login/2fa';
    // Agent Accounts A1 — both /agent-invite/* (HTML) and /api/agents/accept +
    // /agent-signup + /api/agent-signup are unauthenticated entry points.
    const isAgentPublic = path.startsWith('/agent-invite/') || path === '/api/agents/accept' || path === '/agent-signup' || path === '/api/agent-signup';
    // Agent Accounts A3 — concierge magic-link entry points (client-facing,
    // no JWT). The token in the URL is the secret.
    const isConciergePublic =
        path.startsWith('/confirm/') ||
        path === '/api/concierge/confirm' ||
        path === '/api/concierge/book-info' ||
        path === '/api/concierge/book' ||
        path === '/api/concierge/confirm-info';
    const isPublic = path.startsWith('/api/public/') || path.startsWith('/api/integration/') || path.startsWith('/api/admin/connect') || path.startsWith('/api/admin/silo') || path.startsWith('/api/ics/') || path.startsWith('/api/messages/public/') || path.startsWith('/api/guest/') || path === '/book' || path.startsWith('/book/') || path.startsWith('/inspector/') || path.startsWith('/embed/') || path.startsWith('/photos/') || path === '/' || path === '/status' || path.startsWith('/static/') || path.startsWith('/report/') || path.startsWith('/r/') || path.startsWith('/agreements/sign/') || path.startsWith('/sign/') || path.startsWith('/messages/') || path.startsWith('/m2m/') || path.startsWith('/verify/') || path.startsWith('/.well-known/') || STATIC_ASSET_EXT.test(path) || path === '/api/integrations/qbo/webhook' || path === '/api/integrations/stripe/webhook';

    // Design System 0520 subsystem D P5 — observer surfaces are gated by
    // the dedicated observer-cookie middleware, not JWT.
    const isObserverPublic = path.startsWith('/observe/') || path === OBSERVER_EXPIRED_PATH;

    if (isAuthPublic || isPublic || isAgentPublic || isConciergePublic || isObserverPublic || path === '/setup' || path === '/login' || path === '/join' || path === '/guest-join' || path.startsWith('/agreements/sign/')) return next();

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
                const header = JSON.parse(atob(headerPart.replace(/-/g, '+').replace(/_/g, '/')));
                if (header.typ && header.typ !== 'JWT') {
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
        if (userId && c.env.TENANT_CACHE) {
            const invalidatedAt = await c.env.TENANT_CACHE.get(`pwchanged:${userId}`);
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
        const { createScopedDb } = await import('./lib/db/scoped');
        const db = drizzle(c.env.DB);
        c.set('sdb', createScopedDb(db as unknown as ReturnType<typeof drizzle<typeof schema>>, tenantIdForDb));
    }

    return next();
};
app.use('*', jwtAuthMiddleware);

// Secret UI化 — load encrypted integration secrets from DB and merge into
// c.env. Tenant comes from the JWT (authed API) or tenantRouter (standalone /
// public slug paths) — see the ORDERING note above. Worker env vars take
// precedence except for the tenant-owned Stripe trio.
app.use('*', integrationSecretsMiddleware);

// Service registry + tenant email/AI config (see the ORDERING note above —
// must run after the JWT middleware so `tenantId` is resolved).
app.use('*', diMiddleware);

// Sprint B-1 — after auth + branding, hydrate the booking-palette context
// (slug + booking host) into branding so MainLayout's <CommandPalette/> can
// render the "Copy my booking link" action without each page having to plumb
// the slug through manually.
app.use('*', inspectorPaletteMiddleware);

// Design System 0520 subsystem B phase 1 — debounced last-active touch. Runs
// after every authenticated request (30 s window per user / worker isolate)
// so TeamStrip's "last active Nm ago" pill stays accurate without hammering
// D1 on every fetch.
app.use('/api/*', touchLastActiveMiddleware);

// API Routes
app.use('/api/*', requireActiveSubscription);

// Module Routes — chained so that `typeof routes` accumulates every sub-router's
// path schema, enabling typed `hc<CoreApiType>()` API calls in the future.
//
// Currently the sub-routers themselves use void `.openapi()` calls, so the
// merged schema carries only path shapes (not request/response types). Once
// sub-routers are also refactored to chain their `.openapi()` calls, the full
// endpoint types will propagate automatically through this chain.
//
// Middleware `.use()` and inline `.get()` handlers are kept as separate `app.*`
// statements (above and below) since they don't affect the route type signature.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- referenced via `typeof routes` on line 800 (CoreApiType export)
const routes = app
  // Mount auth routes at canonical API path AND at root so that /setup, /login (POST), /join (POST) work without redirects
  .route('/api/auth', coreAuthRoutes)
  .route('/', coreAuthRoutes)
  // Design System 0520 subsystem C — guest + billing.
  .route('/api/guest', guestRoutes)
  .route('/api/billing', billingRoutes)
  // Design System 0520 subsystem E — identity / integrations / analytics.
  .route('/api/identities', identityRoutes)
  .route('/api/integrations', integrationsApiRoutes)
  .route('/api/analytics', analyticsRoutes)
  .route('/api/inspections', inspectionsRoutes)
  // Design System 0520 subsystem B phase 2 — tenant-level presence channel
  // (one WS per dashboard tab). Per-inspection presence is mounted inline on
  // inspectionsRoutes above as /api/inspections/:id/presence/ws.
  .route('/api/tenant', tenantPresenceRoutes)
  // Workflow shortcuts PR — tenant-scoped editor preferences (clone defaults,
  // auto-advance delay, pinned tag ids). GET returns merged defaults; PATCH
  // validates and persists.
  .route('/api/tenant/inspection-prefs', inspectionPrefsRoutes)
  .route('/api/inspections', inspectionSyncRoutes)
  // Sprint 3 S3-3 — tag link/unlink endpoints share the /api/inspections root
  // so the URL carries inspection id + item id directly. Mounted before the
  // generic inspection routes finish registering so OpenAPI catches both.
  .route('/api/inspections', inspectionTagRoutes)
  .route('/api/tags', tagsRoutes)
  .route('/api/inspection-requests', inspectionRequestsRoutes)
  .route('/api/ai', aiRoutes)
  // C-10 residual ③-A — public token-gated report/observe/invoice/inspector
  // endpoints. Mounted first so its static paths win over the other public routers.
  .route('/api/public', publicReportRoutes)
  .route('/api/public', bookingsRoutes)
  .route('/api/public/widget', widgetRoutes)
  // Booking #7 Sprint A — slug availability check; lives under /api/public so
  // the slug input on /settings/profile (and any future un-authed pages) can
  // hit it without a JWT.
  .route('/api/public', publicSlugRoutes)
  // Booking #7 Sprint A — authenticated profile endpoints (slug write).
  .route('/api/profile', profileRoutes)
  // Sprint 3 Track B (S3-2) — Customer-driven Repair Request export.
  // Public, token-gated like /report/:id; the email endpoint validates the
  // per-tenant enable_customer_repair_export flag + payment + agreement gates
  // before sending.
  .route('/api/public', repairRequestRoutes)
  // UC-C-7 — public share-token mint (customer Forward report flow).
  .route('/api/public', publicShareRoutes)
  .route('/api/admin', adminRoutes)
  // Branding sub-router — extracted to fix hono/client type-collapse (C-10)
  .route('/api/admin', adminBrandingRoutes)
  // Evidence download — GET /api/admin/agreement-requests/:id/pdf + certificate.pdf
  .route('/api/admin', evidenceRoutes)
  // Secret UI化 — GET/PUT/POST /api/admin/secrets for all 14 integration keys
  .route('/api/admin', secretsRoutes)
  // Email-template CRUD + preview — GET/PUT/POST /api/admin/email-templates
  .route('/api/admin', emailTemplateRoutes)
  .route('/api/agent', agentRoutes)
  // Agent Accounts A1 — invite + accept endpoints
  .route('/api/agents', agentsRoutes)
  // Agent Accounts A1 — self-serve signup
  .route('/api/agent-signup', agentSignupRoutes)
  // Agent Accounts A3 — concierge magic-link confirmation (public, no JWT)
  .route('/api/concierge', conciergeRoutes)
  // React Router v7 frontend session context (branding + user + deployment info)
  .route('/api/session', sessionContextRoutes)
  .route('/api/places', placesRoutes)
  .route('/api/availability', availabilityRoutes)
  // Mount /api/calendar/events BEFORE /api/calendar so the more-specific path takes precedence.
  .route('/api/calendar/events', calendarEventsRoutes)
  .route('/api/calendar', calendarRoutes)
  .route('/api/team', teamRoutes)
  .route('/api/contacts', contactRoutes)
  // Import sub-router — extracted to fix hono/client type-collapse (C-10)
  .route('/api/contacts', contactsImportRoutes)
  .route('/api/recommendations', recommendationsRoutes)
  .route('/api/rating-systems', ratingSystemsRoutes)
  .route('/api', eventsRoutes)
  .route('/api/invoices', invoiceRoutes)
  .route('/api/services', servicesRoutes)
  .route('/api/automations', automationsRoutes)
  .route('/api/metrics', metricsRoutes)
  .route('/api/templates/marketplace', marketplaceRoutes)
  // Sprint 2 S2-6 — migrate inspections from one template to another.
  // Mounted at /api/templates so the path is /api/templates/:oldId/migrate-to/:newId.
  .route('/api/templates', templateMigrationRoutes)
  .route('/api/data', dataRoutes)
  .route('/api/ics', icsRoutes)
  .route('/api/users', userRoutes)
  .route('/api/messages', messageRoutes)
  .route('/api/notifications', notificationsRoutes)
  .route('/settings/integrations/qbo', qboRoutes)
  .route('/api/integrations/qbo/webhook', qboWebhookRoutes)
  // Stripe webhook (bring-your-own-keys) — public, verified via the tenant's
  // own stripe-signature secret. Added to isPublic allowlist below.
  .route('/api/integrations/stripe/webhook', stripeWebhookRoutes)
  // Spec 5H — signed agreement render for Browser-Run PDF export (token-in-URL, no JWT).
  .route('/m2m', agreementsRenderRoutes)
  // Spec 5H — public key discovery for independent verification of tenant signing keys.
  .route('/.well-known', wellKnownRoutes)
  // Profile-gated setup wizard — 404s in saas modes (see features/setup-wizard).
  .route('/setup', setupWizardRoutes())
;

// Mount the SaaS portal M2M integration routes (the one composition seam).
// No-op surface for standalone. The worker entry 404s these in standalone
// (APP_MODE ≠ saas).
registerPortalIntegration(app);

// Design System 0520 subsystem D phase 4/5 — anonymous observer claim.
// Public route — exchanges a one-time token for a __Host-observer_session
// cookie (HMAC-signed scope = inspection id + expiresAt). Subsequent
// /observe/inspections/:id loads carry the cookie; the middleware in
// server/lib/middleware/observer-cookie.ts verifies + scopes per-request.
app.get('/observe/:token', async (c) => {
    const token = c.req.param('token');
    if (!token) return c.text('Missing token', 400);

    const out = await c.var.services.observerLink.claim(token);
    if (out.kind === 'not_found' || out.kind === 'revoked') {
        return c.redirect('/not-found?reason=observer-invalid', 302);
    }
    if (out.kind === 'expired') {
        return c.redirect('/not-found?reason=observer-expired', 302);
    }

    const cookie = await signObserverCookie(
        { linkId: out.linkId, inspectionId: out.inspectionId, exp: out.exp },
        c.env.JWT_SECRET,
    );
    setCookie(c, '__Host-observer_session', cookie, {
        httpOnly: true,
        secure:   true,
        sameSite: 'Strict',
        path:     '/observe',
        maxAge:   Math.max(out.exp - Math.floor(Date.now() / 1000), 60),
    });
    return c.redirect(`/observe/inspections/${out.inspectionId}`);
});

// OpenAPI Documentation
app.doc('/doc', {
    openapi: '3.0.0',
    info: {
        version: '1.0.0-rc.1',
        title: 'OpenInspection Core API',
        description: 'Advanced property inspection platform API documentation.'
    },
});


// Swagger UI moved to a React Router route (GET /ui -> app/routes/docs.tsx) so hono
// renders no browser pages. The OpenAPI document is still served here at /doc above.

// ---------- SSR page handlers removed — React Router v7 frontend serves all HTML pages ----------




// Booking #7 Sprint C-2 — busy-only iCal feed. Subscribers (partner agents,
// the inspector's own personal calendar) see opaque "Busy" blocks with no
// addresses, client names, or emails. Cancelled inspections drop out so
// freed slots become bookable again.
//
// PR 2 T9: path carries the tenant slug because the path-tenant resolver
// (T1) eats the first segment after /inspector/. Without :tenant the
// resolver would treat the inspector slug as the tenant in shared/silo
// modes. Standalone deploys would still work via fixed-tenant fallback,
// but the unified shape applies across all modes.
app.get('/inspector/:tenant/:slug/calendar.ics', async (c) => {
    const slug = c.req.param('slug');
    const tenantSlugFromPath = c.req.param('tenant');
    const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
    // Tenant slug from path must match what tenant-router resolved.
    // The middleware only sets resolvedTenantId on a successful match,
    // so an unresolved path tenant manifests as a 404 here.
    if (!tenantId || c.get('requestedTenantSlug') !== tenantSlugFromPath) {
        return c.text('Not found', 404);
    }
    const ics = await c.var.services.ics.busyFeedForInspector(tenantId, slug);
    return new Response(ics, {
        status: 200,
        headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
            'Content-Disposition': `inline; filename="${slug}-busy.ics"`,
        },
    });
});

// Sprint 1 C-2 — friendly redirects for token-less agreement / report links.
// Inspectors and customers occasionally type or share the bare path; without
// these handlers the request would fall through to the generic Hono 404.
app.get('/agreement-sign', (c) => c.redirect('/not-found?from=agreement-sign', 302));
app.get('/agreements/sign', (c) => c.redirect('/not-found?from=agreement-sign', 302));

// iter-2 production bug #9 — `/sign/:id` redirect target for the
// ReportGatePage "Sign agreement" CTA. Sprint 1 D-7 minted the URL
// `${baseUrl}/sign/${id}` with id = inspection id, but no route was
// registered, so the customer who hit the gate landed on a 404.
//
// Resolves the inspection's most recent non-terminal agreement request
// and 302s to the canonical token-gated page `/agreements/sign/:token`.
// When no live request exists (every row is signed / declined / expired
// / never created), redirects to the friendly not-found page so the
// customer at least sees branded copy instead of the bare 404.
//
// Public — no JWT required. tenantId resolves from the slug via
// tenantRouter middleware (`resolvedTenantId`), the same way the public
// `/report/:id` viewer is scoped.
app.get('/sign/:tenant/:id', async (c) => {
    const id = c.req.param('id') as string;
    const tenantSlugFromPath = c.req.param('tenant');
    const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
    // Tenant slug from path must match what tenant-router resolved.
    // The middleware only sets resolvedTenantId on a successful match,
    // so an unresolved path tenant manifests as a 404 here. Use the
    // friendly not-found page to match the rest of this handler's
    // failure modes (token miss / no live request).
    if (!tenantId || c.get('requestedTenantSlug') !== tenantSlugFromPath) {
        return c.redirect('/not-found?from=agreement-sign', 302);
    }

    try {
        const pending = await c.var.services.agreement.findPendingByInspectionId(tenantId as string, id);
        if (pending) {
            return c.redirect(agreementSignPath(tenantSlugFromPath as string, pending.token), 302);
        }
    } catch (e) {
        logger.warn('sign-redirect: lookup failed', { inspectionId: id.slice(0, 8), error: (e as Error).message });
    }
    return c.redirect('/not-found?from=agreement-sign', 302);
});



// Spec 5H P2 — Public verifier (no-auth, court-friendly). The base JSON route
// `GET /api/public/verify/:envelopeId` is now the typed route in
// server/api/public-report.ts; these siblings stay raw (not consumed via hc).
// `loadVerifyData` moved to server/lib/verify-data.ts.
app.get('/api/public/verify/:envelopeId/public-key', async (c) => {
    const envelopeId = c.req.param('envelopeId') as string;
    const data = await loadVerifyData(c, envelopeId);
    if (!data || !data.pubKey) return c.text('Not found', 404);
    c.header('Content-Type', 'application/x-pem-file');
    c.header('Content-Disposition', `attachment; filename="pubkey-${envelopeId.slice(0, 8)}.pem"`);
    return c.body(data.pubKey.pem);
});

// Spec 5H D-patch — view the signed document. Looks up the envelope's
// public token and redirects to /agreements/sign/{token} which renders
// the same printable agreement (now with Download PDF button on signed status).
app.get('/api/public/verify/:envelopeId/document', async (c) => {
    const envelopeId = c.req.param('envelopeId') as string;
    const data = await loadVerifyData(c, envelopeId);
    if (!data) return c.text('Not found', 404);
    return c.redirect(agreementSignPath(data.tenantSlug, data.reqRow.token), 302);
});

app.get('/api/public/verify-by-token/:token', async (c) => {
    const token = c.req.param('token') as string;
    const db = drizzle(c.env.DB, { schema });
    const row = await db.select({ id: schema.agreementRequests.id })
        .from(schema.agreementRequests)
        .where(eq(schema.agreementRequests.verificationToken, token))
        .get();
    if (!row) return c.json({ success: false, error: { message: 'Not found', code: 'NOT_FOUND' } }, 404);
    return c.json({ success: true, data: { envelopeId: row.id } });
});

app.get('/api/public/verify/:envelopeId/audit-trail', async (c) => {
    const envelopeId = c.req.param('envelopeId') as string;
    const data = await loadVerifyData(c, envelopeId);
    if (!data) return c.json({ error: 'Not found' }, 404);
    const payload = {
        envelopeId,
        algorithm: 'Ed25519',
        publicKeyPem: data.pubKey?.pem ?? null,
        keyFingerprint: data.pubKey?.fingerprint ?? null,
        events: data.auditRows.map((r) => ({
            id: r.id, event: r.event, createdAt: r.createdAt,
            payloadJson: r.payloadJson, prevHash: r.prevHash,
            hash: r.hash, signature: r.signature, keyFingerprint: r.keyFingerprint,
        })),
        chainValid: data.verify.valid,
        exportedAt: new Date().toISOString(),
    };
    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="audit-${envelopeId.slice(0, 8)}.json"`);
    return c.body(JSON.stringify(payload, null, 2));
});

app.get('/', (c) => c.redirect('/dashboard'));

// Global catch-all 404. API requests get JSON; everything else gets plain text
// (the React Router v7 frontend handles HTML 404 rendering).
app.notFound((c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith('/api/')) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
    }
    return c.text('Not found', 404);
});

// CF Workers ESM expects { fetch, scheduled } on the default export.
// Named exports of `scheduled` aren't recognized by the runtime —
// without this `Handler does not export a scheduled() function` fires
// on every cron tick and the automation flush never runs.
import { scheduled as baseScheduled } from './scheduled';
import { handleSyncDlqBatch } from './portal/integration.module';
export default {
    fetch: app.fetch.bind(app),
    scheduled: async (event: ScheduledEvent, env: HonoConfig['Bindings'], ctx: ExecutionContext) => {
        await baseScheduled(event, env, ctx);
    },
    // Queue consumer: this worker consumes ONLY the sync DLQ
    // (`inspectorhub-sync-dlq-saas`). Each dead message's outbox row is marked
    // `failed` so the failure is durable + visible in the console. Never throws.
    queue: async (batch: MessageBatch<unknown>, env: HonoConfig['Bindings'], _ctx: ExecutionContext) => {
        await handleSyncDlqBatch(env.DB, batch);
    },
};
export { SignCompletionWorkflow } from './workflows/sign-completion-workflow';

// Design System 0520 subsystem B phase 2 — presence Durable Objects.
// wrangler needs them re-exported from the entrypoint so it can discover
// the class names referenced by [[durable_objects.bindings]] in wrangler.jsonc.
export { InspectionPresenceDO } from './durable-objects/inspection-presence';
export { TenantPresenceDO     } from './durable-objects/tenant-presence';

// Exported for the route-metadata vitest gate; OpenAPIHono.getOpenAPIDocument()
// inspects the doc without needing a live request.
export { app };

// React Router v7 migration — typed RPC client for the frontend React Router v7 app.
// `routes` carries the accumulated path schemas from all chained `.route()`
// calls. Currently the sub-routers use void `.openapi()` calls (not chained),
// so request/response types are blank. Once sub-routers also chain their
// `.openapi()` calls, `hc<CoreApiType>()` will provide full type inference.
//
// Known limitation: TypeScript can't verify that the deeply nested
// `OpenAPIHono<E, S_merged, B>` satisfies `Hono<any,any,any>` when S_merged
// has 40+ intersected MergeSchemaPath entries. The frontend uses `as any` to
// bridge this constraint until sub-router types are individually chained.
export type CoreApiType = typeof routes;
