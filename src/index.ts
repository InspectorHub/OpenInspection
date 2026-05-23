import { OpenAPIHono } from '@hono/zod-openapi';
import { Context } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { signObserverCookie } from './lib/observer-cookie';
import { verifyJwt } from './lib/jwt-keyring';
import { classifyJwtPayload } from './lib/auth/jwt-claims';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, asc, desc, sql } from 'drizzle-orm';
import { users } from './lib/db/schema';
import * as schema from './lib/db/schema';

import { brandingMiddleware } from './lib/middleware/branding';
import { enforceTenantActive } from './lib/middleware/tenant-status-guard';
import { inspectorPaletteMiddleware } from './lib/middleware/inspector-palette';
import { touchLastActiveMiddleware } from './lib/middleware/touch-last-active';
import { tenantRouter } from './features/tenant-routing';
import { diMiddleware } from './lib/middleware/di';
import { requireActiveSubscription } from './lib/middleware/tier-guard';
import { securityHeaders } from './lib/middleware/security-headers';
import { issueCsrfCookie } from './lib/middleware/csrf';
import { AppError, ErrorCode, Errors } from './lib/errors';
import { sendError } from './lib/response';
import { HonoConfig } from './types/hono';
import { UserRole } from './types/auth';
import { logger } from './lib/logger';
import { BUILD } from './generated/version';

import { setupWizardRoutes } from './features/setup-wizard';

import { LoginPage } from './templates/pages/login';
import { DashboardPage } from './templates/pages/dashboard';
import { ReportsPage } from './templates/pages/reports';
import { SettingsPage } from './templates/pages/settings';
import { PublicBookingPage } from './templates/pages/booking';
import { FormRendererPage } from './templates/pages/form-renderer';
import { AgentDashboardPage } from './templates/pages/agent-dashboard';
import { AgentRecommendationsPage } from './templates/pages/agent-recommendations';
import { AgentInspectorsPage } from './templates/pages/agent-inspectors';
import { AgentSettingsProfilePage } from './templates/pages/agent-settings-profile';
import { AgentInviteAcceptPage } from './templates/pages/agent-invite-accept';
import { AgentInviteExpiredPage } from './templates/pages/agent-invite-expired';
import { AgentSignupPage } from './templates/pages/agent-signup';
import { TemplatesPage } from './templates/pages/templates';
import { TemplateEditorPage } from './templates/pages/template-editor';
import { MarketplacePage } from './templates/pages/marketplace';
import { RatingSystemsPage } from './templates/pages/rating-systems';
import { TagsPage } from './templates/pages/tags';
import { TeamPage } from './templates/pages/team';
import { ApprenticeReviewPage } from './templates/pages/apprentice-review';
import { AgreementsPage } from './templates/pages/agreements';
import { AgreementSignPage } from './templates/pages/agreement-sign';
import { AgreementPrintablePage } from './templates/pages/agreement-printable';
import { CertTemplatePage } from './templates/pages/cert.template';
import { VerifyPage } from './templates/pages/verify';
import { CalendarPage } from './templates/pages/calendar';
import { ContactsPage } from './templates/pages/contacts';
import { RecommendationsPage } from './templates/pages/recommendations';
import { CommentsPage } from './templates/pages/comments';
import { InvoicesPage } from './templates/pages/invoices';
import { ReportCardStackPage } from './templates/pages/report-card-stack';
import { InspectionEditPage } from './templates/pages/inspection-edit';
import { RepairListPage } from './templates/pages/inspection/repair-list';
import { CustomerRepairRequestPage } from './templates/pages/customer-repair-request';
import { FeatureDisabledPage } from './templates/pages/feature-disabled';
import { SettingsAutomationsPage } from './templates/pages/settings-automations';
import { SettingsWidgetPage } from './templates/pages/settings-widget';
import { SettingsServicesPage } from './templates/pages/settings-services';
import { SettingsEventTypesPage } from './templates/pages/settings-event-types';
import { MetricsPage } from './templates/pages/metrics';
import { SettingsDataPage } from './templates/pages/settings-data';
import { MessagesPublicPage } from './templates/pages/messages-public';
import { NotificationsPage } from './templates/pages/notifications';
import { SettingsSecurityPage } from './templates/pages/settings-security';
import { SettingsProfilePage } from './templates/pages/settings-profile';
import { SettingsWorkspacePage } from './templates/pages/settings-workspace';
import { SettingsCommunicationPage } from './templates/pages/settings-communication';
import { SettingsAccountPage } from './templates/pages/settings-account';
import { SettingsAdvancedPage } from './templates/pages/settings-advanced';
import { SettingsIntegrationsPage } from './templates/pages/settings-integrations';
import { IntegrationsGridPage } from './templates/pages/settings-integrations-grid';
import { SettingsIntegrationsQBOPage } from './templates/pages/settings-integrations-qbo';
import { NotFoundPage } from './templates/pages/not-found';
import { ObservePage, ObserverExpiredPage } from './templates/pages/observe';
import { VersionDiffPage } from './templates/pages/version-diff';
import { observerCookieGuard, OBSERVER_EXPIRED_PATH } from './lib/middleware/observer-cookie';
import { GuestJoinPage } from './templates/pages/guest-join';
import { SettingsBillingPage } from './templates/pages/settings-billing';
import { BookingNotFoundPage } from './templates/pages/booking-not-found';
import { BookingNoSlugLandingPage } from './templates/pages/booking-no-slug';
import { InspectorProfilePage } from './templates/pages/inspector-profile';
import { InspectorNotFoundPage } from './templates/pages/inspector-not-found';
import { BookingEmbedPage } from './templates/pages/booking-embed';
import { agreementSignPath } from './lib/public-urls';


import coreAuthRoutes from './api/auth';
import identityRoutes from './api/identity';
import integrationsApiRoutes from './api/integrations';
import analyticsRoutes from './api/analytics';
import guestRoutes from './api/guest';
import billingRoutes from './api/billing';
import integrationRoutes from './api/integration';
import inspectionsRoutes from './api/inspections';
import tenantPresenceRoutes from './api/tenant-presence';
import aiRoutes from './api/ai';
import bookingsRoutes from './api/bookings';
import adminRoutes from './api/admin';
import agentRoutes from './api/agent';
import agentsRoutes from './api/agents';
import agentSignupRoutes from './api/agent-signup';
import placesRoutes from './api/places';
import availabilityRoutes from './api/availability';
import calendarRoutes from './api/calendar';
import calendarEventsRoutes from './api/calendar-events';
import teamRoutes from './api/team';
import contactRoutes from './api/contacts';
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
import profileRoutes from './api/profile';
import conciergeRoutes from './api/concierge';
import qboRoutes from './api/qbo';
import qboWebhookRoutes from './api/qbo-webhook';
import { ConciergeConfirmPage } from './templates/pages/concierge-confirm';
import { ConciergeConfirmExpiredPage } from './templates/pages/concierge-confirm-expired';
import { ConciergeBookPage } from './templates/pages/concierge-book';
import { SettingsCatalogBookingPage } from './templates/pages/settings-catalog-booking';
import { getSeatUsage } from './features/seat-quota';

const app = new OpenAPIHono<HonoConfig>();

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
app.get('/static/*', serveStatic(staticOpts({ root: './' })));
app.get('/favicon.svg', serveStatic(staticOpts({ path: './favicon.svg' })));
app.get('/logo.svg', serveStatic(staticOpts({ path: './logo.svg' })));
app.get('/styles.css', serveStatic(staticOpts({ path: './styles.css' })));
app.get('/manifest.json', serveStatic(staticOpts({ path: './manifest.json' })));
app.get('/sw.js', serveStatic(staticOpts({ path: './sw.js' })));
app.get('/js/*', serveStatic(staticOpts({ root: './' })));
app.get('/css/*', serveStatic(staticOpts({ root: './' })));
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

// Global Middlewares
app.use('*', securityHeaders);
app.use('*', diMiddleware);
app.use('*', tenantRouter);
app.use('*', brandingMiddleware);
app.use('*', enforceTenantActive);

// Static asset extensions — these bypass JWT verification. We use a strict allowlist
// rather than path.includes('.') so a dot inside a path segment (e.g. "/inspections/foo.bar")
// can't trick the middleware into treating a protected route as public.
const STATIC_ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|json|txt|pdf)$/i;

// Global JWT Middleware — extracts tenantId / userRole from Bearer token or cookie.
app.use('*', async (c, next) => {
    const path = c.req.path;
    const isAuthPublic = path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/setup' || path === '/api/auth/login/2fa';
    // Agent Accounts A1 — both /agent-invite/* (HTML) and /api/agents/accept +
    // /agent-signup + /api/agent-signup are unauthenticated entry points.
    const isAgentPublic = path.startsWith('/agent-invite/') || path === '/api/agents/accept' || path === '/agent-signup' || path === '/api/agent-signup';
    // Agent Accounts A3 — concierge magic-link entry points (client-facing,
    // no JWT). The token in the URL is the secret.
    const isConciergePublic = path.startsWith('/confirm/') || path === '/api/concierge/confirm';
    const isPublic = path.startsWith('/api/public/') || path.startsWith('/api/integration/') || path.startsWith('/api/admin/') || path.startsWith('/api/ics/') || path.startsWith('/api/messages/public/') || path.startsWith('/api/guest/') || path === '/book' || path.startsWith('/book/') || path.startsWith('/inspector/') || path.startsWith('/embed/') || path.startsWith('/photos/') || path === '/widget.js' || path === '/' || path === '/status' || path.startsWith('/static/') || path.startsWith('/report/') || path.startsWith('/r/') || path.startsWith('/agreements/sign/') || path.startsWith('/sign/') || path.startsWith('/messages/') || path.startsWith('/m2m/') || path.startsWith('/verify/') || STATIC_ASSET_EXT.test(path) || path === '/api/integrations/qbo/webhook';

    // Design System 0520 subsystem D P5 — observer surfaces are gated by
    // the dedicated observer-cookie middleware, not JWT.
    const isObserverPublic = path.startsWith('/observe/') || path === OBSERVER_EXPIRED_PATH;

    if (isAuthPublic || isPublic || isAgentPublic || isConciergePublic || isObserverPublic || path === '/setup' || path === '/login' || path === '/join' || path === '/guest-join' || path.startsWith('/agreements/sign/')) return next();

    // Generate setup code if system is uninitialized and we are in standalone
    // (gated on `hasSetupWizard` — only the standalone profile enables it).
    if (c.var.profile.hasSetupWizard && c.env.TENANT_CACHE) {
        // Prefer explicit environment variable if set by user during deployment
        const storedCode = c.env.SETUP_CODE || await c.env.TENANT_CACHE.get('setup_verification_code');

        if (!storedCode) {
            const db = drizzle(c.env.DB);
            // Only count tenant-scoped users (admin/inspector). Global agents
            // (tenant_id IS NULL, A1) are unrelated to first-time setup state.
            const user = await db.select().from(users).where(sql`${users.tenantId} IS NOT NULL`).limit(1).get();
            if (!user) {
                // Use CSPRNG with rejection sampling so the one-hour bootstrap code is unbiased
                // and unpredictable. CodeQL js/biased-cryptographic-random — modulo on
                // crypto.getRandomValues introduces non-uniform distribution; reject any value
                // beyond the largest multiple of RANGE that still fits in Uint32.
                const RANGE = 900000;
                const MAX = Math.floor(0xFFFFFFFF / RANGE) * RANGE;
                let rand: number;
                do { rand = crypto.getRandomValues(new Uint32Array(1))[0]!; } while (rand >= MAX);
                const newCode = (100000 + (rand % RANGE)).toString();
                await c.env.TENANT_CACHE.put('setup_verification_code', newCode, { expirationTtl: 3600 });
                logger.warn('New system detected. System initialization code generated.');
                logger.info('Initialization code stored in KV. Use SETUP_CODE env var in production.');
            }
        } else if (c.env.SETUP_CODE) {
             // Just log that we are using the user-defined code
             const db = drizzle(c.env.DB);
             const user = await db.select().from(users).where(sql`${users.tenantId} IS NOT NULL`).limit(1).get();
             if (!user) {
                 logger.info('System initialization required. Using user-defined SETUP_CODE.');
             }
        }
    }

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
    // In SaaS mode, strictly verify that the token's tenant matches the requested subdomain's tenant.
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
});

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

// Module Routes
// Mount auth routes at canonical API path AND at root so that /setup, /login (POST), /join (POST) work without redirects
app.route('/api/auth', coreAuthRoutes);
app.route('/', coreAuthRoutes);
// Design System 0520 subsystem C — guest + billing.
app.route('/api/guest', guestRoutes);
app.route('/api/billing', billingRoutes);
// Design System 0520 subsystem E — identity / integrations / analytics.
app.route('/api/identities', identityRoutes);
app.route('/api/integrations', integrationsApiRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/inspections', inspectionsRoutes);
// Design System 0520 subsystem B phase 2 — tenant-level presence channel
// (one WS per dashboard tab). Per-inspection presence is mounted inline on
// inspectionsRoutes above as /api/inspections/:id/presence/ws.
app.route('/api/tenant', tenantPresenceRoutes);

// Design System 0520 subsystem D phase 4/5 — anonymous observer claim.
// Public route — exchanges a one-time token for a __Host-observer_session
// cookie (HMAC-signed scope = inspection id + expiresAt). Subsequent
// /observe/inspections/:id loads carry the cookie; the middleware in
// src/lib/middleware/observer-cookie.ts verifies + scopes per-request.
app.get('/observe/:token', async (c) => {
    const token = c.req.param('token');
    if (!token) return c.text('Missing token', 400);

    const out = await c.var.services.observerLink.claim(token);
    if (out.kind === 'not_found' || out.kind === 'revoked') {
        return c.html('<html><body style="font-family:sans-serif;padding:2rem"><h1>Invalid link</h1><p>This observer link has been revoked or does not exist.</p></body></html>', 404);
    }
    if (out.kind === 'expired') {
        return c.html('<html><body style="font-family:sans-serif;padding:2rem"><h1>Link expired</h1><p>This observer link has expired. Ask your inspector for a fresh one.</p></body></html>', 410);
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
app.route('/api/inspections', inspectionSyncRoutes);
// Sprint 3 S3-3 — tag link/unlink endpoints share the /api/inspections root
// so the URL carries inspection id + item id directly. Mounted before the
// generic inspection routes finish registering so OpenAPI catches both.
app.route('/api/inspections', inspectionTagRoutes);
app.route('/api/tags', tagsRoutes);
app.route('/api/inspection-requests', inspectionRequestsRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/public', bookingsRoutes);
app.route('/api/public/widget', widgetRoutes);
// Booking #7 Sprint A — slug availability check; lives under /api/public so
// the slug input on /settings/profile (and any future un-authed pages) can
// hit it without a JWT.
app.route('/api/public', publicSlugRoutes);
// Booking #7 Sprint A — authenticated profile endpoints (slug write).
app.route('/api/profile', profileRoutes);
// Sprint 3 Track B (S3-2) — Customer-driven Repair Request export.
// Public, token-gated like /report/:id; the email endpoint validates the
// per-tenant enable_customer_repair_export flag + payment + agreement gates
// before sending.
app.route('/api/public', repairRequestRoutes);
// UC-C-7 — public share-token mint (customer Forward report flow).
app.route('/api/public', publicShareRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/agent', agentRoutes);
// Agent Accounts A1 — invite + accept endpoints
app.route('/api/agents', agentsRoutes);
// Agent Accounts A1 — self-serve signup
app.route('/api/agent-signup', agentSignupRoutes);
// Agent Accounts A3 — concierge magic-link confirmation (public, no JWT)
app.route('/api/concierge', conciergeRoutes);
app.route('/api/places', placesRoutes);
app.route('/api/availability', availabilityRoutes);
// Mount /api/calendar/events BEFORE /api/calendar so the more-specific path takes precedence.
app.route('/api/calendar/events', calendarEventsRoutes);
app.route('/api/calendar', calendarRoutes);
app.route('/api/team', teamRoutes);
app.route('/api/contacts', contactRoutes);
app.route('/api/recommendations', recommendationsRoutes);
app.route('/api/rating-systems', ratingSystemsRoutes);
app.route('/api', eventsRoutes);
app.route('/api/invoices', invoiceRoutes);
app.route('/api/services', servicesRoutes);
app.route('/api/automations', automationsRoutes);
app.route('/api/metrics', metricsRoutes);
app.route('/api/templates/marketplace', marketplaceRoutes);
// Sprint 2 S2-6 — migrate inspections from one template to another.
// Mounted at /api/templates so the path is /api/templates/:oldId/migrate-to/:newId.
app.route('/api/templates', templateMigrationRoutes);
app.route('/api/data', dataRoutes);
app.route('/api/integration', integrationRoutes);
app.route('/api/ics', icsRoutes);
app.route('/api/users', userRoutes);
app.route('/api/messages', messageRoutes);
app.route('/api/notifications', notificationsRoutes);
app.route('/settings/integrations/qbo', qboRoutes);
app.route('/api/integrations/qbo/webhook', qboWebhookRoutes);

// OpenAPI Documentation
app.doc('/doc', {
    openapi: '3.0.0',
    info: {
        version: '1.0.0-rc.1',
        title: 'OpenInspection Core API',
        description: 'Advanced property inspection platform API documentation.'
    },
});

// HTML Auth Guard Middleware
const htmlAuthGuard = (allowedRoles?: string[]) => {
    return async (c: Context<HonoConfig>, next: () => Promise<void>) => {
        const userRole = c.get('userRole');
        if (!userRole) return c.redirect('/login');

        if (allowedRoles && !allowedRoles.includes(userRole)) {
            // Agent JWTs carry no tenant, so the inspector dashboard would render
            // an empty shell. Send them to the agent dashboard instead, otherwise
            // bounce inspector-class users to /dashboard.
            const fallback = userRole === 'agent' ? '/agent-dashboard' : '/dashboard?error=unauthorized_role';
            return c.redirect(fallback);
        }

        return await next();
    };
};

// Swagger UI (owner/admin only)
app.get('/ui', htmlAuthGuard(['owner', 'admin']), (c) => {
    return c.html(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Swagger UI</title>
            <link rel="stylesheet" href="/vendor/swagger-ui.css" />
        </head>
        <body>
            <div id="swagger-ui"></div>
            <script src="/vendor/swagger-ui-bundle.js" crossorigin></script>
            <script>
                window.onload = () => {
                    window.ui = SwaggerUIBundle({
                        url: '/doc',
                        dom_id: '#swagger-ui',
                    });
                };
            </script>
        </body>
        </html>
    `);
});

// View Handlers
app.get('/login', async (c) => {
    // If user is already authenticated, redirect to the right dashboard.
    // Agent JWTs (role='agent') belong on /agent-dashboard, not the inspector
    // dashboard which would render an empty shell because agents have no tenant.
    const token = getCookie(c, '__Host-inspector_token');
    if (token) {
        try {
            const keyring = await c.var.keyringPromise!;
            const payload = await verifyJwt(token, keyring);
            const role = (payload as Record<string, unknown>)['custom:userRole'] || (payload as Record<string, unknown>).role;
            return c.redirect(role === 'agent' ? '/agent-dashboard' : '/dashboard');
        } catch {
            // Invalid/expired token — show login page
        }
    }
    // Shared-SaaS mode: a single core D1 holds users for many tenants and
    // `users.email` is unique per-(tenantId,email) (see migration 0072), so
    // a local email+password form cannot disambiguate which tenant the user
    // means. Portal owns the identity → membership picker; bounce there and
    // let portal SSO-handoff us back via /sso?code=. Standalone and silo
    // deploys keep the local form because their email-to-tenant mapping
    // is unambiguous.
    const profile = c.var.profile;
    if (profile?.mode === 'saas' && profile?.saasTopology === 'shared' && c.env.PORTAL_API_URL) {
        const portal = c.env.PORTAL_API_URL.replace(/\/$/, '');
        return c.redirect(`${portal}/login`, 302);
    }
    // Issue the CSRF cookie before rendering so the form's submit handler can echo it back.
    issueCsrfCookie(c);
    const branding = c.get('branding');
    return c.html(LoginPage({ branding }));
});

// Forgot password — renders the same LoginPage template but starts the
// Alpine `step` on 'forgot' so the email-input form paints on first render.
// The form POSTs to /api/auth/forgot-password which emails a reset link
// (when RESEND_API_KEY + SENDER_EMAIL are configured) pointing back at
// /login?reset_token=... The login.js bootstrap captures that token before
// scrubbing the URL bar, then flips step → 'reset' so the user can type a
// new password without ever leaving the same page.
app.get('/forgot-password', async (c) => {
    const token = getCookie(c, '__Host-inspector_token');
    if (token) {
        try {
            const keyring = await c.var.keyringPromise!;
            const payload = await verifyJwt(token, keyring);
            const role = (payload as Record<string, unknown>)['custom:userRole'] || (payload as Record<string, unknown>).role;
            return c.redirect(role === 'agent' ? '/agent-dashboard' : '/dashboard');
        } catch {
            // Invalid/expired token — show forgot-password page
        }
    }
    // Shared-SaaS: same reasoning as GET /login — password lives in portal's
    // identities table, not in core's per-tenant users row, so the recovery
    // UI must live on the portal side.
    const profile = c.var.profile;
    if (profile?.mode === 'saas' && profile?.saasTopology === 'shared' && c.env.PORTAL_API_URL) {
        const portal = c.env.PORTAL_API_URL.replace(/\/$/, '');
        return c.redirect(`${portal}/forgot-password`, 302);
    }
    issueCsrfCookie(c);
    const branding = c.get('branding');
    return c.html(LoginPage({ branding, initialStep: 'forgot' }));
});

// Design System 0520 subsystem D P5.1 — observer viewer (cookie-gated).
app.get('/observe/inspections/:id', observerCookieGuard, (c) => {
    const id = c.req.param('id');
    const b  = c.get('branding');
    return c.html(ObservePage({ inspectionId: id, ...(b ? { branding: b } : {}) }));
});
app.get(OBSERVER_EXPIRED_PATH, (c) => {
    const b = c.get('branding');
    return c.html(ObserverExpiredPage(b ? { branding: b } : {}));
});

// Design System 0520 subsystem D P8 — version diff viewer.
app.get('/inspections/:id/versions/:n/diff', htmlAuthGuard(), (c) => {
    const id = c.req.param('id');
    const n  = parseInt(c.req.param('n') ?? '1', 10);
    if (!id || Number.isNaN(n) || n < 1) {
        return c.html(NotFoundPage({ branding: c.get('branding') }), 404);
    }
    const b = c.get('branding');
    return c.html(VersionDiffPage({
        inspectionId: id,
        toVersion:    n,
        ...(b ? { branding: b } : {}),
    }));
});

// Design System 0520 subsystem C P6.3 — anonymous guest join landing.
app.get('/guest-join', (c) => {
    const branding = c.get('branding');
    const token = c.req.query('token') ?? '';
    return c.html(GuestJoinPage({ token, ...(branding ? { branding } : {}) }));
});

// Profile-gated setup wizard — 404s in saas modes (see features/setup-wizard).
app.route('/setup', setupWizardRoutes());

// Agent Accounts A1 — public invite acceptance landing.
// Lifecycle: missing/unknown/expired/used token -> friendly recovery page (410).
// Valid token -> personal hero + 3 value props + accept-form (HTTP 200).
app.get('/agent-invite/accept', async (c) => {
    const branding = c.get('branding');
    const token = c.req.query('token');
    if (!token) {
        return c.html(AgentInviteExpiredPage({
            reason: 'no-token',
            ...(branding ? { branding } : {}),
        }), 410);
    }
    const invite = await c.var.services.agent.resolveInvite(token);
    if (!invite) {
        return c.html(AgentInviteExpiredPage({
            reason: 'unknown',
            ...(branding ? { branding } : {}),
        }), 410);
    }
    if (invite.used) {
        return c.html(AgentInviteExpiredPage({
            reason: 'used',
            inviterName: invite.inspector.name,
            ...(invite.inviterEmail ? { inviterEmail: invite.inviterEmail } : {}),
            tenantName: invite.tenantName,
            ...(branding ? { branding } : {}),
        }), 410);
    }
    if (invite.expired) {
        return c.html(AgentInviteExpiredPage({
            reason: 'expired',
            inviterName: invite.inspector.name,
            ...(invite.inviterEmail ? { inviterEmail: invite.inviterEmail } : {}),
            tenantName: invite.tenantName,
            ...(branding ? { branding } : {}),
        }), 410);
    }
    return c.html(AgentInviteAcceptPage({
        token,
        inspector: { name: invite.inspector.name },
        tenantName: invite.tenantName,
        inviteEmail: invite.email,
        ...(branding ? { branding } : {}),
    }));
});

// Agent Accounts A3 — concierge magic-link client landing. Renders the
// inspector + property + date summary card with an inline agreement preview
// (when agreementRequired). Confirm CTA POSTs to /api/concierge/confirm.
//
// Lifecycle:
//   missing/unknown token  -> friendly recovery page (HTTP 410)
//   expired token          -> friendly expired page    (HTTP 410)
//   already-confirmed      -> redirect to /r/<inspection-id>  (HTTP 302)
//   live token             -> render confirm page              (HTTP 200)
app.get('/confirm/:token', async (c) => {
    const token = c.req.param('token');
    const branding = c.get('branding');
    if (!token) {
        return c.html(ConciergeConfirmExpiredPage({ reason: 'no-token', ...(branding ? { branding } : {}) }), 410);
    }
    const view = await c.var.services.concierge.resolveToken(token);
    if (!view) {
        return c.html(ConciergeConfirmExpiredPage({ reason: 'unknown', ...(branding ? { branding } : {}) }), 410);
    }
    if (view.expired) {
        return c.html(ConciergeConfirmExpiredPage({ reason: 'expired', ...(branding ? { branding } : {}) }), 410);
    }
    if (view.alreadyConfirmed) {
        return c.redirect(`/r/${view.inspection.id}`);
    }

    // Resolve a short snippet of the tenant's primary agreement template so
    // the page can preview what the client will be e-signing. Failures fall
    // back to a generic "you'll review and sign" notice on the page.
    let snippet: string | undefined;
    if (view.inspection.agreementRequired) {
        try {
            const agreements = await c.var.services.agreement.listAgreements(view.inspection.tenantId);
            const first = agreements[0];
            if (first?.content) {
                const stripped = String(first.content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                snippet = stripped.slice(0, 280) + (stripped.length > 280 ? '...' : '');
            }
        } catch {
            // Fall through — page will render the generic note.
        }
    }

    return c.html(ConciergeConfirmPage({
        token,
        inspector: view.inspector ?? { name: null, photoUrl: null, email: null },
        inspection: {
            propertyAddress:   view.inspection.propertyAddress,
            date:              view.inspection.date,
            clientName:        view.inspection.clientName,
            agreementRequired: view.inspection.agreementRequired,
        },
        ...(snippet ? { agreementSnippet: snippet } : {}),
        ...(branding ? { branding } : {}),
    }));
});

// Agent Accounts A1 — self-serve agent signup landing.
app.get('/agent-signup', (c) => {
    const branding = c.get('branding');
    return c.html(AgentSignupPage({
        ...(c.env.TURNSTILE_SITE_KEY ? { siteKey: c.env.TURNSTILE_SITE_KEY } : {}),
        ...(branding ? { branding } : {}),
    }));
});


// Booking #7 Sprint A — slug-less /book is a soft landing. Working booking
// forms live at /book/<slug>; the legacy first-inspector-wins fallback was
// removed because it could land a customer on a random team member.
app.get('/book', (c) => {
    const branding = c.get('branding');
    return c.html(BookingNoSlugLandingPage({ ...(branding ? { branding } : {}) }));
});

// Booking #7 Sprint C-1 — public editorial profile page. Served before
// /book/:slug so an inspector can share /inspector/<slug> as the SEO surface
// and the customer falls through to /book/<slug> via the page CTA.
app.get('/inspector/:tenant/:slug', async (c) => {
    const slug = c.req.param('slug');
    const tenantSlugFromPath = c.req.param('tenant');
    const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
    const branding = c.get('branding');
    // Tenant slug from path must match what tenant-router resolved.
    // The middleware only sets resolvedTenantId on a successful match,
    // so an unresolved path tenant manifests as a 404 here.
    if (!tenantId || c.get('requestedSubdomain') !== tenantSlugFromPath) {
        return c.html(InspectorNotFoundPage({ slug, companyName: branding?.siteName }), 404);
    }
    const profile = await c.var.services.user.getProfileBySlug(tenantId, slug);
    if (!profile) {
        return c.html(InspectorNotFoundPage({ slug, companyName: branding?.siteName }), 404);
    }
    const services = await c.var.services.service.listServices(tenantId).catch(() => []);
    const catalog = services.map(s => ({
        name: s.name,
        durationMinutes: s.durationMinutes,
        price: s.price,
    }));
    const host = (c.env.APP_BASE_URL?.replace(/^https?:\/\//, '').replace(/\/$/, '')) || c.req.header('host') || '';
    return c.html(InspectorProfilePage({ profile, services: catalog, host, tenantSlug: tenantSlugFromPath }));
});

// Booking #7 Sprint C-4 — iframe-friendly booking widget at /embed/book/<slug>.
// Renders a chrome-less booking form. The security-headers middleware drops
// X-Frame-Options + sets `frame-ancestors *` for any path under /embed/, so
// the iframe loads on any host page. The actual booking submit at
// POST /api/public/book still enforces the per-tenant origin allowlist
// configured in Settings → Embed Widget.
app.get('/embed/book/:tenant/:slug', async (c) => {
    const slug = c.req.param('slug');
    const tenantSlugFromPath = c.req.param('tenant');
    const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
    // Tenant slug from path must match what tenant-router resolved.
    // The middleware only sets resolvedTenantId on a successful match,
    // so an unresolved path tenant manifests as a 404 here.
    if (!tenantId || c.get('requestedSubdomain') !== tenantSlugFromPath) {
        return c.text('Not found', 404);
    }
    const inspector = await c.var.services.user.findBySlug(tenantId, slug);
    if (!inspector) return c.text('Not found', 404);
    const branding = c.get('branding');
    const styleParam = c.req.query('style');
    const variant: 'full' | 'compact' = styleParam === 'compact' ? 'compact' : 'full';
    // Display name fallback never leaks email. Setup wizard requires the
    // inspector's name; if a legacy account is missing one, surface the
    // tenant brand instead so the customer never sees a raw inbox address.
    const displayName = inspector.name || branding?.siteName || 'Your inspector';
    return c.html(BookingEmbedPage({
        slug,
        inspectorId: inspector.id,
        inspectorName: displayName,
        tenantSubdomain: branding?.bookingHost?.split('.')[0] ?? '',
        siteKey: c.env.TURNSTILE_SITE_KEY ?? '',
        style: variant,
    }));
});

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
    if (!tenantId || c.get('requestedSubdomain') !== tenantSlugFromPath) {
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

app.get('/book/:tenant/:slug', async (c) => {
    const slug = c.req.param('slug');
    const tenantSlugFromPath = c.req.param('tenant');
    const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
    const branding = c.get('branding');
    // Tenant slug from path must match what tenant-router resolved.
    // The middleware only sets resolvedTenantId on a successful match,
    // so an unresolved path tenant manifests as a 404 here.
    if (!tenantId || c.get('requestedSubdomain') !== tenantSlugFromPath) {
        return c.html(BookingNotFoundPage({ ...(branding ? { branding } : {}), slug }), 404);
    }
    const inspector = await c.var.services.user.findBySlug(tenantId, slug);
    if (!inspector) {
        return c.html(BookingNotFoundPage({ ...(branding ? { branding } : {}), slug }), 404);
    }

    const embedRaw = c.req.query('embed');
    const styleRaw = c.req.query('style') || 'light';
    const embed = embedRaw === '1';
    const style: 'light' | 'dark' | 'branded' =
        styleRaw === 'dark' || styleRaw === 'branded' ? styleRaw as 'dark' | 'branded' : 'light';
    // Same no-email-leak rule as /embed/book — fall back to tenant brand,
    // then a polite literal, before ever exposing the admin inbox.
    const displayName = inspector.name || branding?.siteName || 'Your inspector';
    // UC-A-1 — preserve the ?ref=<agentSlug> param so the form can submit
    // it as a hidden field. Server resolves the slug at booking submit time.
    const refRaw = c.req.query('ref');
    const agentRefSlug = refRaw && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(refRaw) ? refRaw : undefined;
    return c.html(PublicBookingPage({
        siteKey: c.env.TURNSTILE_SITE_KEY,
        ...(branding ? { branding } : {}),
        embed,
        style,
        inspector: { id: inspector.id, name: displayName },
        ...(agentRefSlug ? { agentRefSlug } : {}),
    }));
});

// Public agreement signing page (no auth required — token is the secret).
// :tenant in the path is defense-in-depth — the token alone is the cryptographic
// gate, but the URL-level slug lets tenant-router populate branding / audit /
// rate-limiting context BEFORE this handler runs. Slug-vs-agreement mismatch
// 404s the same way as a bad token.
app.get('/agreements/sign/:tenant/:token', async (c) => {
    const token = c.req.param('token') as string;
    const tenantSlugFromPath = c.req.param('tenant');
    const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
    const branding = c.get('branding');
    // Tenant slug from path must match what tenant-router resolved.
    // An unresolved path tenant manifests as a 404 here — reuse the
    // styled not-found redirect to match the catch handler below.
    if (!tenantId || c.get('requestedSubdomain') !== tenantSlugFromPath) {
        return c.redirect('/not-found?from=agreement-sign', 302);
    }
    try {
        const svc = c.var.services.agreement;
        const { request, agreement } = await svc.getAgreementByToken(token);
        // Cross-tenant token probe: the token resolves but to a different tenant.
        // Treat as not-found so this URL is indistinguishable from a bad token.
        if (request.tenantId !== tenantId) {
            return c.redirect('/not-found?from=agreement-sign', 302);
        }
        await svc.markViewed(token);

        // Spec 5H P0 — append request.viewed to the audit chain (best-effort).
        try {
            await c.var.services.auditLog.append(request.tenantId, request.id, 'request.viewed', {
                country: c.req.header('cf-ipcountry') || null,
                envelopeId: request.id,
                ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
                tsMs: Date.now(),
                ua: (c.req.header('user-agent') || '').slice(0, 200) || null,
            });
        } catch (e) {
            logger.warn('audit.append.viewed.failed', { token: token.slice(0, 8), error: (e as Error).message });
        }

        // Best-effort fetch of linked inspection + inspector for placeholder substitution.
        // Scoped to the request's tenantId — public token is the secret, but we still
        // refuse to leak data across tenants.
        const vars: { client_name?: string; property_address?: string; inspection_date?: string; inspector_name?: string; inspector_license?: string } = {
            client_name: request.clientName ?? '',
        };
        if (request.inspectionId) {
            try {
                const db = drizzle(c.env.DB, { schema });
                const insp = await db.select().from(schema.inspections)
                    .where(and(eq(schema.inspections.id, request.inspectionId), eq(schema.inspections.tenantId, request.tenantId)))
                    .get();
                if (insp) {
                    vars.property_address = insp.propertyAddress ?? '';
                    vars.inspection_date = insp.date ?? '';
                    if (!vars.client_name) vars.client_name = insp.clientName ?? '';
                    if (insp.inspectorId) {
                        const inspector = await db.select().from(schema.users)
                            .where(and(eq(schema.users.id, insp.inspectorId), eq(schema.users.tenantId, request.tenantId)))
                            .get();
                        if (inspector) {
                            vars.inspector_name = inspector.name ?? inspector.email ?? '';
                            vars.inspector_license = inspector.licenseNumber ?? '';
                        }
                    }
                }
            } catch (e) {
                logger.warn('agreement-sign: failed to load inspection vars', { token: token.slice(0, 8), error: (e as Error).message });
            }
        }

        return c.html(AgreementSignPage({
            token,
            agreementName: agreement.name,
            agreementContent: agreement.content,
            clientName: request.clientName ?? null,
            status: request.status as 'pending' | 'viewed' | 'signed',
            branding,
            vars,
        }));
    } catch {
        // Sprint 1 C-2 — styled 404 instead of monospace text.
        return c.redirect('/not-found?from=agreement-sign', 302);
    }
});

// Sprint 1 C-2 — public, branded not-found page. Used by:
//   * direct visit to /agreements/sign without a valid token
//   * report-share token miss
//   * Hono catch-all (app.notFound)
// `from` query selects context-specific copy (agreement-sign / report-share).
app.get('/not-found', (c) => {
    const from = c.req.query('from');
    return c.html(NotFoundPage({ branding: c.get('branding'), ...(from ? { from } : {}) }), 404);
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
// Public — no JWT required. tenantId resolves from the subdomain via
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
    if (!tenantId || c.get('requestedSubdomain') !== tenantSlugFromPath) {
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

// Spec 5H P1 — Internal render route consumed by SignCompletionWorkflow.
// Auth model: token IS the secret (256-bit hex from createSigningRequest).
// Originally M2M-authed via Bearer JWT_SECRET, but CF Browser Rendering
// doesn't forward custom Authorization headers reliably -> 404. The token
// itself is unguessable, so its secrecy is sufficient (same model as the
// public /agreements/sign/{token} route).
//
// :tenant in the path is the same defense-in-depth as on /agreements/sign:
// tenant-router resolves the slug into branding / context before the handler
// runs, and a slug↔token tenant mismatch 404s.
app.get('/m2m/agreement-render/:tenant/:token', async (c) => {
    const token = c.req.param('token') as string;
    const tenantSlugFromPath = c.req.param('tenant');
    const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
    if (!tenantId || c.get('requestedSubdomain') !== tenantSlugFromPath) {
        return c.notFound();
    }
    try {
        const { request, agreement } = await c.var.services.agreement.getAgreementByToken(token);
        if (request.tenantId !== tenantId) {
            return c.notFound();
        }

        // Substitute placeholders the same way agreement-sign does
        const vars: Record<string, string> = {
            client_name: request.clientName ?? '',
            property_address: '',
            inspection_date: '',
            inspector_name: '',
            inspector_license: '',
        };
        if (request.inspectionId) {
            try {
                const db = drizzle(c.env.DB, { schema });
                const insp = await db.select().from(schema.inspections)
                    .where(and(eq(schema.inspections.id, request.inspectionId), eq(schema.inspections.tenantId, request.tenantId)))
                    .get();
                if (insp) {
                    vars.property_address = insp.propertyAddress ?? '';
                    vars.inspection_date = insp.date ?? '';
                    if (!vars.client_name) vars.client_name = insp.clientName ?? '';
                    if (insp.inspectorId) {
                        const inspector = await db.select().from(schema.users)
                            .where(and(eq(schema.users.id, insp.inspectorId), eq(schema.users.tenantId, request.tenantId)))
                            .get();
                        if (inspector) {
                            vars.inspector_name = inspector.name ?? inspector.email ?? '';
                            vars.inspector_license = inspector.licenseNumber ?? '';
                        }
                    }
                }
            } catch (e) {
                logger.warn('agreement-render: vars load failed', { token: token.slice(0, 8), error: (e as Error).message });
            }
        }

        // Inline HTML body substitution (mirror agreement-sign.tsx logic)
        const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const trimmed = (agreement.content || '').trimStart();
        const html = trimmed.startsWith('<')
            ? agreement.content
            : '<p>' + escapeHtml(agreement.content || '').replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
        const bodyHtml = html.replace(/\{\{(client_name|property_address|inspection_date|inspector_name|inspector_license)\}\}/g,
            (_m, k: string) => escapeHtml(vars[k] ?? ''));

        return c.html(AgreementPrintablePage({
            agreementName: agreement.name,
            bodyHtml,
            clientName: request.clientName,
            clientEmail: request.clientEmail,
            signatureBase64: request.signatureBase64,
            signedAtUtcIso: request.signedAt ? new Date(request.signedAt).toISOString() : null,
            envelopeId: request.id,
        }));
    } catch (e) {
        logger.error('agreement-render: failed', { token: token.slice(0, 8) }, e instanceof Error ? e : undefined);
        return c.text('Render failed', 500);
    }
});

// Spec 5H P1.1 — Certificate of Completion render route. M2M-authed.
// Workflow Step 2 (render-certificate-pdf) hits this; Browser Rendering
// captures the response as cert.pdf. Reads esign_audit_logs to build
// the event timeline + signing_keys for the cryptographic proof block.
app.get('/m2m/cert-render/:token', async (c) => {
    // Same auth model as agreement-render — token secrecy gates access.
    const token = c.req.param('token') as string;
    try {
        const { request, agreement } = await c.var.services.agreement.getAgreementByToken(token);

        // Load full audit chain for this envelope
        const db = drizzle(c.env.DB, { schema });
        const auditRows = await db.select().from(schema.esignAuditLogs)
            .where(and(eq(schema.esignAuditLogs.tenantId, request.tenantId), eq(schema.esignAuditLogs.requestId, request.id)))
            .orderBy(asc(schema.esignAuditLogs.createdAt))
            .all();

        const timelineEvents = auditRows.map((r) => {
            let payload: Record<string, unknown> = {};
            try { payload = JSON.parse(r.payloadJson); } catch { /* ignore */ }
            return {
                event: r.event,
                timestampUtc: new Date(r.createdAt).toISOString(),
                actor: typeof payload.actorId === 'string' ? payload.actorId : undefined,
                ip: typeof payload.ip === 'string' ? payload.ip : null,
                country: typeof payload.country === 'string' ? payload.country : null,
                ua: typeof payload.ua === 'string' ? payload.ua : null,
            };
        });

        // Find document hash + signature image hash from existing audit rows
        let documentHash: string | null = null;
        let signatureImageHash: string | null = null;
        for (const r of auditRows) {
            try {
                const p = JSON.parse(r.payloadJson) as Record<string, unknown>;
                if (r.event === 'agreement.signed' && typeof p.signatureImageHash === 'string') {
                    signatureImageHash = (p.signatureImageHash as string).replace(/^sha256:/, '');
                }
                if (r.event === 'workflow.complete' && typeof p.signedPdfHash === 'string') {
                    documentHash = (p.signedPdfHash as string).replace(/^sha256:/, '');
                }
            } catch { /* ignore parse errors */ }
        }

        // Tenant signing key fingerprint (any audit row's key_fingerprint works since rotation is rare)
        const keyFingerprint = auditRows[0]?.keyFingerprint ?? null;

        const verifyBase = c.env.ESIGN_PUBLIC_VERIFY_BASE || 'https://openinspection-standalone.important-new.workers.dev';
        const verifyUrl = `${verifyBase}/verify/${request.id}`;
        const branding = c.get('branding');
        const siteName = branding?.siteName || 'OpenInspection';

        return c.html(CertTemplatePage({
            envelopeId: request.id,
            documentTitle: agreement.name,
            documentHash,
            recipientName: request.clientName,
            recipientEmail: request.clientEmail,
            identityMethod: 'Email link verification (token only)',
            signatureImageHash,
            signatureBase64: request.signatureBase64,
            events: timelineEvents,
            keyFingerprint,
            keyAlgorithm: 'Ed25519',
            verifyUrl,
            siteName,
            generatedAtUtcIso: new Date().toISOString(),
        }));
    } catch (e) {
        logger.error('cert-render: failed', { token: token.slice(0, 8) }, e instanceof Error ? e : undefined);
        return c.text('Cert render failed', 500);
    }
});

// Spec 5H P2 — Public verifier (no-auth, court-friendly).
// HTML page at /verify/{envelopeId} + JSON API at /api/public/verify/*
async function loadVerifyData(c: Context<HonoConfig>, envelopeId: string) {
    const db = drizzle(c.env.DB, { schema });
    const reqRow = await db.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, envelopeId)).get();
    if (!reqRow) return null;
    const agreement = await db.select().from(schema.agreements).where(eq(schema.agreements.id, reqRow.agreementId)).get();
    const auditRows = await db.select().from(schema.esignAuditLogs)
        .where(and(eq(schema.esignAuditLogs.tenantId, reqRow.tenantId), eq(schema.esignAuditLogs.requestId, envelopeId)))
        .orderBy(asc(schema.esignAuditLogs.createdAt))
        .all();
    const verify = await c.var.services.auditLog.verifyChain(reqRow.tenantId, envelopeId);
    const pubKey = await c.var.services.signingKey.getPublicKey(reqRow.tenantId);
    const tenantRow = await db.select({ subdomain: schema.tenants.subdomain })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, reqRow.tenantId))
        .get();
    const tenantSubdomain = tenantRow?.subdomain ?? '';
    return { reqRow, agreement, auditRows, verify, pubKey, tenantSubdomain };
}

app.get('/verify/:envelopeId', async (c) => {
    const envelopeId = c.req.param('envelopeId') as string;
    const data = await loadVerifyData(c, envelopeId);
    const branding = c.get('branding');
    const siteName = branding?.siteName || 'OpenInspection';
    const apiBase = c.env.ESIGN_PUBLIC_VERIFY_BASE || 'https://openinspection-standalone.important-new.workers.dev';
    if (!data) {
        return c.html(VerifyPage({
            envelopeId, found: false, chainValid: false, chainReason: null,
            documentTitle: null, clientName: null, clientEmail: null,
            keyFingerprint: null, keyAlgorithm: 'Ed25519', eventCount: 0, events: [],
            siteName, apiBase,
        }));
    }
    const events = data.auditRows.map((r) => {
        let payload: Record<string, unknown> = {};
        try { payload = JSON.parse(r.payloadJson); } catch { /* ignore */ }
        return {
            event: r.event, createdAtUtc: new Date(r.createdAt).toISOString(),
            valid: data.verify.valid, payload, hash: r.hash,
        };
    });
    return c.html(VerifyPage({
        envelopeId,
        found: true,
        chainValid: data.verify.valid,
        chainReason: data.verify.valid ? null : (data.verify.reason as string),
        documentTitle: data.agreement?.name ?? null,
        clientName: data.reqRow.clientName,
        clientEmail: data.reqRow.clientEmail,
        keyFingerprint: data.pubKey?.fingerprint ?? null,
        keyAlgorithm: 'Ed25519',
        eventCount: events.length,
        events,
        siteName, apiBase,
    }));
});

app.get('/api/public/verify/:envelopeId', async (c) => {
    const envelopeId = c.req.param('envelopeId') as string;
    const data = await loadVerifyData(c, envelopeId);
    if (!data) return c.json({ success: false, error: { message: 'Envelope not found', code: 'NOT_FOUND' } }, 404);
    return c.json({
        success: true,
        data: {
            envelopeId,
            documentTitle: data.agreement?.name ?? null,
            clientName: data.reqRow.clientName,
            clientEmail: data.reqRow.clientEmail,
            chainValid: data.verify.valid,
            chainReason: data.verify.valid ? null : (data.verify.reason as string),
            keyFingerprint: data.pubKey?.fingerprint ?? null,
            keyAlgorithm: 'Ed25519',
            eventCount: data.auditRows.length,
        },
    });
});

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
    return c.redirect(agreementSignPath(data.tenantSubdomain, data.reqRow.token), 302);
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

// Public report page (no auth required for the share link, but gated on
// payment + agreement state per Spec 3A). Sprint 1 C-7 — the gate now
// also fires on the public /report/:id route; previously only the
// authenticated /api/inspections/:id/report enforced it, which left the
// public link bypassable.
app.get('/report/:tenant/:id', async (c) => {
    const id = c.req.param('id') as string;
    const tenantSlugFromPath = c.req.param('tenant');
    const tenantId = c.get('resolvedTenantId') || c.get('tenantId');
    // Tenant slug from path must match what tenant-router resolved.
    // The middleware only sets resolvedTenantId on a successful match,
    // so an unresolved path tenant manifests as a 404 here. Plain-text
    // 404 matches the existing minimal failure mode of this handler.
    if (!tenantId || c.get('requestedSubdomain') !== tenantSlugFromPath) {
        return c.text('Not found', 404);
    }

    // Spec 5A.3 — ?summary=1 filters to defects-only (used by PDF Summary
    // renderer). ?print=1 already supported by main-layout (hides nav).
    const summaryMode = c.req.query('summary') === '1';

    // Inspector / admin / owner bypass — they can preview a gated report
    // from the dashboard without paying it themselves. We check the JWT
    // cookie directly (htmlAuthGuard would force a /login redirect for
    // unauthenticated customers, which we explicitly want to avoid here).
    let role: string | null = null;
    try {
        const { getCookie } = await import('hono/cookie');
        const tok = getCookie(c, '__Host-inspector_token');
        if (tok) {
            const keyring = await c.var.keyringPromise!;
            const payload = await verifyJwt(tok, keyring);
            role = (payload as { role?: string })?.role ?? null;
        }
    } catch { /* unauthenticated public view */ }
    const isInspectorOrAdmin = role === 'owner' || role === 'admin' || role === 'inspector';

    // BUG #21 — `/report/<id>?view=agent&token=<t>` skips payment/agreement
    // gates when the KV-resolved token matches this inspection + tenant.
    // Without it, the agent-view link emitted by InspectionService would hit
    // the public paywall instead of the report.
    const agentToken = c.req.query('view') === 'agent' ? c.req.query('token') : null;
    let isAgentTokenView = false;
    if (agentToken) {
        const resolved = await c.var.services.inspection.resolveAgentViewToken(agentToken);
        if (!resolved || resolved.inspectionId !== id || resolved.tenantId !== tenantId) {
            return c.html('<html><body><p style="font-family:sans-serif;padding:2rem">Invalid or expired agent view link.</p></body></html>', 403);
        }
        isAgentTokenView = true;
    }

    try {
        const service = c.var.services.inspection;

        // Sprint 1 C-7 — gate logic for public viewers only. We need the
        // inspection row's flags before pulling the (potentially expensive)
        // full report data. Loading just the row is cheap.
        if (!isInspectorOrAdmin && !isAgentTokenView) {
            const db = drizzle(c.env.DB);
            const insp = await db.select({
                id:                schema.inspections.id,
                propertyAddress:   schema.inspections.propertyAddress,
                date:              schema.inspections.date,
                inspectorId:       schema.inspections.inspectorId,
                paymentRequired:   schema.inspections.paymentRequired,
                paymentStatus:     schema.inspections.paymentStatus,
                agreementRequired: schema.inspections.agreementRequired,
            }).from(schema.inspections)
                .where(and(eq(schema.inspections.id, id), eq(schema.inspections.tenantId, tenantId as string)))
                .get();
            if (!insp) return c.text('Report not found', 404);

            const branding = c.get('branding');
            const companyName = branding?.siteName || c.env.APP_NAME || 'OpenInspection';
            const primaryColor = branding?.primaryColor || c.env.PRIMARY_COLOR || '#6366f1';
            const baseUrl = (c.env.APP_BASE_URL || '').replace(/\/$/, '') || (c.req.header('host') ? `https://${c.req.header('host')}` : '');

            // BUG #22 — gate copy promised "your inspector's contact details
            // are listed below" but the meta card had only name + property +
            // date. Pull email / phone / license here so the page honors the
            // promise. Same lookup also feeds the agreement branch below.
            let inspectorName: string | null = null;
            let inspectorEmail: string | null = null;
            let inspectorPhone: string | null = null;
            let inspectorLicense: string | null = null;
            if (insp.inspectorId) {
                const inspectorRow = await db.select({
                    name:          users.name,
                    email:         users.email,
                    phone:         users.phone,
                    licenseNumber: users.licenseNumber,
                })
                    .from(users)
                    .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, tenantId as string)))
                    .get();
                inspectorName    = inspectorRow?.name ?? null;
                inspectorEmail   = inspectorRow?.email ?? null;
                inspectorPhone   = inspectorRow?.phone ?? null;
                inspectorLicense = inspectorRow?.licenseNumber ?? null;
            }

            // iter-1 production bug #3 — the gate previously used
            // `=== true` strict equality, but D1 sometimes surfaces the
            // boolean column as the raw integer `1` depending on the
            // codepath (mode:'boolean' is a Drizzle-side conversion that
            // can be skipped when the row originated from a raw insert).
            // The inspection-edit sidebar toggle uses truthy coercion, so
            // the toggle could show ON while the gate skipped paywalling
            // — exactly what the live deploy traversal exposed. Treat any
            // truthy value as "gate enabled" so both surfaces agree.
            if (insp.paymentRequired && insp.paymentStatus !== 'paid') {
                // Pull the unpaid invoice amount so the CTA can carry the
                // dollar figure ("Pay $475 now") and the meta card can show
                // the amount due — both are higher-conversion than a generic
                // "View invoice & pay" link.
                const invoiceRow = await db.select({
                    amountCents: schema.invoices.amountCents,
                })
                    .from(schema.invoices)
                    .where(and(
                        eq(schema.invoices.inspectionId, id),
                        eq(schema.invoices.tenantId, tenantId as string),
                    ))
                    .orderBy(desc(schema.invoices.createdAt))
                    .limit(1)
                    .get();

                const { ReportGatePage } = await import('./templates/pages/report-gate');
                return c.html(ReportGatePage({
                    reason:           'payment',
                    companyName,
                    primaryColor,
                    actionUrl:        `${baseUrl}/r/${id}/invoice`,
                    actionLabel:      'View invoice & pay',
                    propertyAddress:  insp.propertyAddress ?? null,
                    inspectorName,
                    inspectorEmail,
                    inspectorPhone,
                    inspectorLicense,
                    scheduledDate:    insp.date ?? null,
                    amountCents:      invoiceRow?.amountCents ?? null,
                    currency:         'USD',
                }) as string);
            }

            if (insp.agreementRequired) {
                const signed = await db.select({ id: schema.agreementRequests.id })
                    .from(schema.agreementRequests)
                    .where(and(
                        eq(schema.agreementRequests.inspectionId, id),
                        eq(schema.agreementRequests.tenantId, tenantId as string),
                        eq(schema.agreementRequests.status, 'signed'),
                    ))
                    .limit(1);
                if (signed.length === 0) {
                    const { ReportGatePage } = await import('./templates/pages/report-gate');
                    return c.html(ReportGatePage({
                        reason:           'agreement',
                        companyName,
                        primaryColor,
                        actionUrl:        `${baseUrl}/sign/${tenantSlugFromPath}/${id}`,
                        actionLabel:      'Sign agreement',
                        propertyAddress:  insp.propertyAddress ?? null,
                        inspectorName,
                        inspectorEmail,
                        inspectorPhone,
                        inspectorLicense,
                        scheduledDate:    insp.date ?? null,
                    }) as string);
                }
            }
        }

        const data = await service.getReportData(id, tenantId as string);

        // UC-C-6 — lazily mint the conversation token for the public Reply
        // entry point. Only minted on delivered reports so a half-finished
        // draft can't accidentally surface a chat link in the toolbar.
        let messageToken: string | null = null;
        const isDelivered = data.inspection.status === 'delivered';
        if (isDelivered) {
            try {
                messageToken = await c.var.services.message.getOrCreateToken(id, tenantId as string);
            } catch (err) {
                logger.error('Failed to ensure message token for report', { inspectionId: id },
                    err instanceof Error ? err : undefined);
            }
        }

        // Track E1 — surface the per-tenant Repair List toggle so the report
        // viewer can render the "View repair list" top-right link only when
        // the workspace has opted in. Failure to read the column is treated
        // as opt-out (e.g. legacy tenants pre-migration 0044).
        // Sprint 3 S3-2 — same pattern for the customer repair-request export.
        let enableRepairList = false;
        let enableCustomerRepairExport = false;
        try {
            const cfgRow = await drizzle(c.env.DB).select({
                enableRepairList:           schema.tenantConfigs.enableRepairList,
                enableCustomerRepairExport: schema.tenantConfigs.enableCustomerRepairExport,
            })
                .from(schema.tenantConfigs)
                .where(eq(schema.tenantConfigs.tenantId, tenantId as string))
                .get();
            enableRepairList = !!cfgRow?.enableRepairList;
            enableCustomerRepairExport = !!cfgRow?.enableCustomerRepairExport;
        } catch { /* default off */ }

        const rawDate = data.inspection.date || '';
        const formattedDate = rawDate ? new Date(rawDate).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }) : '';

        return c.html(ReportCardStackPage({
            inspectionId: id,
            address: data.inspection.propertyAddress || 'Unknown Address',
            date: formattedDate || rawDate,
            inspectorName: data.inspection.inspectorName,
            theme: data.theme,
            stats: data.stats,
            sections: data.sections,
            ratingLevels: data.ratingLevels as import('./lib/report-utils').RatingLevel[],
            branding: c.get('branding'),
            summaryMode,
            // Sprint 2 S2-4 — gate "Estimated cost: $X – $Y" badges per tenant.
            showEstimates: data.showEstimates,
            // Competitor parity App.F.4 — drives the EDIT SECTION hover button.
            // Public viewers (no JWT) get `null` and never see the affordance.
            viewerRole: role,
            // Track E1 — show "View repair list" link only when opted in.
            enableRepairList,
            // Sprint 3 S3-2 — show "Generate repair request" link only when
            // the workspace has opted in to the customer-facing export.
            enableCustomerRepairExport,
            // Round-2 backlog G1 — Property Facts banner above the report
            // header. Auto-hidden when every field is empty.
            propertyFacts: data.propertyFacts,
            // UC-C-6 / UC-C-7 — customer-facing entry points to the existing
            // public messages page and the public share-token endpoint.
            // Both gate on isDelivered so they never appear on draft reports.
            messageToken,
            isDelivered,
        }));
    } catch {
        return c.text('Report not found', 404);
    }
});

// iter-2 production bug #10 — public invoice payment page.
//
// Replaces `/invoices?inspection=<id>` as the report-gate "Pay invoice"
// CTA target. The legacy `/invoices` route is JWT-protected (admin-only),
// so an unauthenticated customer who clicked the gate CTA was redirected
// to /login — a dead end for a buyer with no account.
//
// This route is public, scoped by inspection id; the inspection id itself
// IS the secret (same pattern as `/r/:id/repair-request` and `/report/:id`).
// We surface the invoice's line items, total, and either a hosted Stripe
// Checkout link (when the workspace has Stripe Connect configured) or a
// "Contact your inspector" fallback. No account required, no /login
// detour.
app.get('/r/:id/invoice', async (c) => {
    const id = c.req.param('id') as string;
    const tenantId = c.get('tenantId') || c.get('resolvedTenantId');
    if (!tenantId) return c.html(NotFoundPage({ branding: c.get('branding') }), 404);

    try {
        const db = drizzle(c.env.DB);
        const insp = await db.select({
            id:              schema.inspections.id,
            propertyAddress: schema.inspections.propertyAddress,
            date:            schema.inspections.date,
            inspectorId:     schema.inspections.inspectorId,
        }).from(schema.inspections)
            .where(and(eq(schema.inspections.id, id), eq(schema.inspections.tenantId, tenantId as string)))
            .get();
        if (!insp) return c.html(NotFoundPage({ branding: c.get('branding') }), 404);

        const branding = c.get('branding');
        const companyName = branding?.siteName || c.env.APP_NAME || 'OpenInspection';
        const primaryColor = branding?.primaryColor || c.env.PRIMARY_COLOR || '#6366f1';

        let inspectorName: string | null = null;
        let inspectorEmail: string | null = null;
        if (insp.inspectorId) {
            const inspectorRow = await db.select({ name: users.name, email: users.email })
                .from(users)
                .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, tenantId as string)))
                .get();
            inspectorName = inspectorRow?.name ?? null;
            inspectorEmail = inspectorRow?.email ?? null;
        }

        const invoice = await c.var.services.invoice.findByInspectionId(tenantId as string, id);

        // No Stripe Connect integration in core today — payUrl stays null
        // and the page renders the "Contact your inspector" fallback. When
        // STRIPE_SECRET_KEY is wired up, mint a Checkout session here and
        // pass its URL through. Tested by InvoicePublicPage's `payUrl=null`
        // path which is the live behavior on every standalone deploy.
        const payUrl: string | null = null;

        const { InvoicePublicPage } = await import('./templates/pages/invoice-public');
        return c.html(InvoicePublicPage({
            companyName,
            primaryColor,
            propertyAddress: insp.propertyAddress ?? null,
            inspectorName,
            inspectorEmail,
            scheduledDate: insp.date ?? null,
            invoice: invoice ? {
                id:          invoice.id,
                amountCents: invoice.amountCents,
                status:      invoice.status,
                dueDate:     invoice.dueDate ?? null,
                notes:       invoice.notes ?? null,
                lineItems:   invoice.lineItems ?? [],
            } : null,
            payUrl,
        }) as string);
    } catch (e) {
        logger.warn('public invoice page failed', { inspectionId: id.slice(0, 8), error: (e as Error).message });
        return c.html(NotFoundPage({ branding: c.get('branding') }), 404);
    }
});

// Sprint 3 Track B (S3-2) — Public Customer Repair Request export.
//
// Token-gated companion to the inspector-facing /inspections/:id/repair-list
// (Track E1). Mirrors the same payment + agreement gates that protect the
// report itself — the customer cannot bypass them by jumping straight to
// the repair-request export. Tenant must opt in via the
// enable_customer_repair_export tenant_configs flag.
app.get('/r/:id/repair-request', async (c) => {
    const id = c.req.param('id') as string;
    const tenantId = c.get('tenantId') || c.get('resolvedTenantId');
    if (!tenantId) return c.text('Not found', 404);

    // Inspector / admin / owner bypass — same logic as /report/:id so a
    // logged-in inspector can preview the export without the gate firing
    // against them.
    let role: string | null = null;
    try {
        const { getCookie } = await import('hono/cookie');
        const tok = getCookie(c, '__Host-inspector_token');
        if (tok) {
            const keyring = await c.var.keyringPromise!;
            const payload = await verifyJwt(tok, keyring);
            role = (payload as { role?: string })?.role ?? null;
        }
    } catch { /* unauthenticated public view */ }
    const isInspectorOrAdmin = role === 'owner' || role === 'admin' || role === 'inspector';

    try {
        // Per-tenant opt-in toggle. Failure to read = treat as off.
        let enableCustomerRepairExport = false;
        let enableRepairList = false;
        try {
            const cfgRow = await drizzle(c.env.DB).select({
                enableCustomerRepairExport: schema.tenantConfigs.enableCustomerRepairExport,
                enableRepairList:           schema.tenantConfigs.enableRepairList,
            })
                .from(schema.tenantConfigs)
                .where(eq(schema.tenantConfigs.tenantId, tenantId as string))
                .get();
            enableCustomerRepairExport = !!cfgRow?.enableCustomerRepairExport;
            enableRepairList = !!cfgRow?.enableRepairList;
        } catch { /* default off */ }
        // Iter-2 Bug #14 — when the tenant has not enabled the customer
        // repair-request export, render a friendly disabled-feature page that
        // tells the customer to contact their inspector. Previously returned a
        // generic 404 which made the link look broken from the customer's POV.
        if (!enableCustomerRepairExport) {
            return c.html(
                FeatureDisabledPage({ from: 'customer-repair-request', branding: c.get('branding') }),
                403,
            );
        }
        // Suppress unused-var lint — enableRepairList is read for symmetry
        // with /report/:id but the customer view never surfaces the link.
        void enableRepairList;

        // Pre-fetch the inspection row so we can run the same payment +
        // agreement gate as /report/:id before pulling the (more expensive)
        // repair-list data set.
        if (!isInspectorOrAdmin) {
            const db = drizzle(c.env.DB);
            const insp = await db.select({
                id:                schema.inspections.id,
                propertyAddress:   schema.inspections.propertyAddress,
                date:              schema.inspections.date,
                inspectorId:       schema.inspections.inspectorId,
                paymentRequired:   schema.inspections.paymentRequired,
                paymentStatus:     schema.inspections.paymentStatus,
                agreementRequired: schema.inspections.agreementRequired,
            }).from(schema.inspections)
                .where(and(eq(schema.inspections.id, id), eq(schema.inspections.tenantId, tenantId as string)))
                .get();
            if (!insp) return c.text('Report not found', 404);

            const branding = c.get('branding');
            const companyName = branding?.siteName || c.env.APP_NAME || 'OpenInspection';
            const primaryColor = branding?.primaryColor || c.env.PRIMARY_COLOR || '#6366f1';
            const baseUrl = (c.env.APP_BASE_URL || '').replace(/\/$/, '') || (c.req.header('host') ? `https://${c.req.header('host')}` : '');

            let inspectorName: string | null = null;
            if (insp.inspectorId) {
                const inspectorRow = await drizzle(c.env.DB).select({ name: users.name })
                    .from(users)
                    .where(and(eq(users.id, insp.inspectorId), eq(users.tenantId, tenantId as string)))
                    .get();
                inspectorName = inspectorRow?.name ?? null;
            }

            // iter-1 bug #3 — same truthy coercion as the /report/:id gate
            // (see comment at the first gate site). Keeps the repair-list
            // page paywall in lockstep with the canonical report page.
            if (insp.paymentRequired && insp.paymentStatus !== 'paid') {
                const { ReportGatePage } = await import('./templates/pages/report-gate');
                return c.html(ReportGatePage({
                    reason:          'payment',
                    companyName,
                    primaryColor,
                    actionUrl:       `${baseUrl}/r/${id}/invoice`,
                    actionLabel:     'View invoice & pay',
                    propertyAddress: insp.propertyAddress ?? null,
                    inspectorName,
                    scheduledDate:   insp.date ?? null,
                }) as string);
            }

            if (insp.agreementRequired) {
                const signed = await drizzle(c.env.DB).select({ id: schema.agreementRequests.id })
                    .from(schema.agreementRequests)
                    .where(and(
                        eq(schema.agreementRequests.inspectionId, id),
                        eq(schema.agreementRequests.tenantId, tenantId as string),
                        eq(schema.agreementRequests.status, 'signed'),
                    ))
                    .limit(1);
                if (signed.length === 0) {
                    const { ReportGatePage } = await import('./templates/pages/report-gate');
                    return c.html(ReportGatePage({
                        reason:          'agreement',
                        companyName,
                        primaryColor,
                        actionUrl:       `${baseUrl}/sign/${c.get('requestedSubdomain') ?? ''}/${id}`,
                        actionLabel:     'Sign agreement',
                        propertyAddress: insp.propertyAddress ?? null,
                        inspectorName,
                        scheduledDate:   insp.date ?? null,
                    }) as string);
                }
            }
        }

        // Pull the repair-list data set + the inspection's clientEmail for
        // the email pre-fill input. clientEmail is a separate cheap select —
        // getRepairList() doesn't surface it.
        const data = await c.var.services.inspection.getRepairList(id, tenantId as string);
        const clientRow = await drizzle(c.env.DB).select({ clientEmail: schema.inspections.clientEmail })
            .from(schema.inspections)
            .where(and(eq(schema.inspections.id, id), eq(schema.inspections.tenantId, tenantId as string)))
            .get();

        const rawDate = data.inspection.date || '';
        const formattedDate = rawDate ? new Date(rawDate).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        }) : null;

        // Strip recommendationId from the cards — the customer doesn't need
        // the slug, only the human-readable label.
        const defects = data.defects.map(d => ({
            sectionId:           d.sectionId,
            sectionTitle:        d.sectionTitle,
            itemId:              d.itemId,
            itemLabel:           d.itemLabel,
            comment:             d.comment,
            location:            d.location,
            category:            d.category,
            recommendationLabel: d.recommendationLabel,
            estimateLow:         d.estimateLow,
            estimateHigh:        d.estimateHigh,
            photos:              d.photos,
        }));

        return c.html(CustomerRepairRequestPage({
            inspectionId:    id,
            propertyAddress: data.inspection.propertyAddress || 'Inspection',
            inspectionDate:  formattedDate,
            inspectorName:   data.inspection.inspectorName,
            clientEmail:     clientRow?.clientEmail ?? null,
            defects,
            showEstimates:   data.showEstimates,
            branding:        c.get('branding'),
        }));
    } catch {
        return c.html(NotFoundPage({ branding: c.get('branding') }), 404);
    }
});

// Phase T (T24) — Public client messages page (token-gated, no JWT)
app.get('/messages/:token', (c) => {
    const token = c.req.param('token') as string;
    return c.html(MessagesPublicPage({ token, branding: c.get('branding') }));
});

// Pages with Auth
app.get('/dashboard', htmlAuthGuard(['owner', 'admin', 'inspector']), async (c) => {
    const branding = c.get('branding');
    const tenantId = c.get('tenantId');
    // PR 3 Task 4 — surface a seat-quota status banner on the dashboard
    // whenever the active deployment profile enforces seat quotas. When the
    // profile carries no quota (standalone / saas-silo) we skip
    // the DB hit entirely and the page renders identically to before.
    const seatProps = c.var.profile.hasSeatQuota && tenantId
        ? {
              seatUsage: await getSeatUsage(tenantId, c.env.DB),
              billingPortalUrl: c.var.profile.billingPortalUrl,
          }
        : {};
    return c.html(DashboardPage({ ...(branding ? { branding } : {}), ...seatProps }));
});
app.get('/reports', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const b = c.get('branding');
    return c.html(ReportsPage(b ? { branding: b } : {}));
});
app.get('/agent-dashboard', htmlAuthGuard(['agent']), async (c) => {
    const branding = c.get('branding');
    const user = c.get('user');
    if (!user?.sub) return c.redirect('/login');
    // Resolve display name + email directly. Agents have tenant_id NULL so
    // tenant-scoped services don't apply.
    let agentName: string | null = null;
    let agentEmail: string | null = null;
    let agentSlug: string | null = null;
    try {
        const db = drizzle(c.env.DB);
        const row = await db.select({
            name: schema.users.name,
            email: schema.users.email,
            slug: schema.users.slug,
        }).from(schema.users).where(eq(schema.users.id, user.sub)).get();
        agentName = row?.name ?? null;
        agentEmail = row?.email ?? null;
        agentSlug = row?.slug ?? null;
    } catch (err) {
        logger.warn('agent.dashboard.identity.lookup.failed', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    const referrals = await c.var.services.agent.listReferrals(user.sub, { limit: 100 });
    // UC-A-6 — load inspector links so the ⌘K palette can offer "Copy booking
    // link — {inspector}" actions on the dashboard too. listInspectors is
    // tenant-scoped + cached, so the cost is bounded.
    const inspectors = await c.var.services.agent.listInspectors(user.sub);
    // "Reports ready to read" = delivered referrals. Sprint A2 ships without a
    // last-read timestamp, so the count surfaces every published report; future
    // sprints can add a per-row read marker.
    const unreadReports = referrals.filter((r) => (r.status || '').toLowerCase() === 'delivered').length;
    // 7-day sparkline for the 'Active referrals' card. Skipped on empty
    // tenant lists — the empty-state checklist replaces stat cards there.
    const sparkline = await c.var.services.agent.referralsByDay(user.sub, 7).catch(() => ({ created: [] as number[] }));
    return c.html(AgentDashboardPage({
        ...(branding ? { branding } : {}),
        agent: { name: agentName, email: agentEmail, slug: agentSlug },
        referrals,
        unreadReports,
        sparklineCreated: sparkline.created,
        inspectors,
        bookingHost: c.req.header('host') || 'localhost',
    }));
});
// UC-A-5 — agent recommendations export. Server renders the static shell;
// the page hits /api/agent/my-recommendations on init and groups defects
// by Safety / Recommendation / Maintenance.
app.get('/agent-recommendations', htmlAuthGuard(['agent']), (c) => {
    const branding = c.get('branding');
    return c.html(AgentRecommendationsPage(branding ? { branding } : {}));
});

// Agent Accounts A2 — /agent-inspectors directory of linked inspector cards
// with copy-able booking links. host suffix is derived from APP_BASE_URL when
// set so the rendered link stays stable across environments; falls back to the
// production root when missing so the locally-booted preview doesn't render
// "/book/<slug>" URLs that 404 on a different host.
app.get('/agent-inspectors', htmlAuthGuard(['agent']), async (c) => {
    const branding = c.get('branding');
    const user = c.get('user');
    if (!user?.sub) return c.redirect('/login');
    let agentSlug: string | null = null;
    let agentName: string | null = null;
    try {
        const db = drizzle(c.env.DB);
        const row = await db.select({ slug: schema.users.slug, name: schema.users.name })
            .from(schema.users)
            .where(eq(schema.users.id, user.sub))
            .get();
        agentSlug = row?.slug ?? null;
        agentName = row?.name ?? null;
    } catch (err) {
        logger.warn('agent.inspectors.identity.lookup.failed', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    const inspectors = await c.var.services.agent.listInspectors(user.sub);
    // PR 2 — booking links are uniformly `/<host>/book/<tenant>/<slug>` across
    // every deploy mode. The agent dashboard's host is the only host the agent
    // is signed in on; the path-tenant prefix carries the tenant context.
    const host = c.req.header('host') || 'localhost';
    return c.html(AgentInspectorsPage({
        ...(branding ? { branding } : {}),
        agent: { name: agentName, slug: agentSlug },
        inspectors,
        host,
    }));
});
// Agent Accounts A3 — Book on Behalf form. Lives under /agent-inspectors so the
// agent's mental model stays "I'm acting as a partner of <inspector>". The
// inspector slug in the URL identifies which tenant + inspector contact this
// concierge booking is for.
app.get('/agent-inspectors/:slug/concierge', htmlAuthGuard(['agent']), async (c) => {
    const slug = c.req.param('slug');
    if (!slug) return c.redirect('/agent-inspectors');
    const branding = c.get('branding');
    const user = c.get('user');
    if (!user?.sub) return c.redirect('/login');

    // Resolve the agent + their linked inspectors (tenant-scoped). Find the
    // inspector card whose slug matches the URL. This guarantees the agent
    // can only concierge-book against tenants they're actively linked to.
    let agentName: string | null = null;
    try {
        const db = drizzle(c.env.DB);
        const me = await db.select({ name: schema.users.name })
            .from(schema.users)
            .where(eq(schema.users.id, user.sub))
            .get();
        agentName = me?.name ?? null;
    } catch (err) {
        logger.warn('concierge.book.identity.failed', {
            error: err instanceof Error ? err.message : String(err),
        });
    }

    const inspectors = await c.var.services.agent.listInspectors(user.sub);
    const match = inspectors.find((row) => row.inspectorSlug === slug);
    if (!match) {
        // Slug doesn't map to an active link — bounce back to the directory
        // so the agent doesn't get a dead end.
        return c.redirect('/agent-inspectors');
    }

    // Resolve the inspector's contact id in this tenant. The agent's link
    // carries `inspectorContactId` (the agent's own contact row); the form
    // needs the *inspector's* contact row, which we look up via email match.
    let inspectorContactId: string | null = null;
    try {
        const db = drizzle(c.env.DB);
        // The inspector is the user with this slug in the matched tenant.
        const inspector = await db.select({ email: schema.users.email })
            .from(schema.users)
            .where(and(
                eq(schema.users.tenantId, match.tenantId),
                eq(schema.users.slug, slug),
            ))
            .get();
        if (inspector?.email) {
            const c0 = await db.select({ id: schema.contacts.id })
                .from(schema.contacts)
                .where(and(
                    eq(schema.contacts.tenantId, match.tenantId),
                    eq(schema.contacts.email, inspector.email),
                ))
                .get();
            inspectorContactId = c0?.id ?? null;
        }
    } catch (err) {
        logger.warn('concierge.book.contact.failed', {
            error: err instanceof Error ? err.message : String(err),
            slug,
        });
    }
    if (!inspectorContactId) {
        // Inspector's contact row is missing — render an empty-state page or
        // redirect. We bounce back so the agent isn't stuck on a broken form.
        return c.redirect('/agent-inspectors');
    }

    return c.html(ConciergeBookPage({
        inspector: {
            name: match.inspectorName,
            slug: match.inspectorSlug,
            contactId: inspectorContactId,
        },
        agent: { name: agentName },
        tenantId: match.tenantId,
        tenantName: match.tenantName,
        ...(branding ? { branding } : {}),
    }));
});

// Agent Accounts A2 — /agent-settings/profile slug + 3 notification toggles.
app.get('/agent-settings/profile', htmlAuthGuard(['agent']), async (c) => {
    const branding = c.get('branding');
    const user = c.get('user');
    if (!user?.sub) return c.redirect('/login');
    const db = drizzle(c.env.DB);
    const row = await db.select({
        name:             schema.users.name,
        email:            schema.users.email,
        slug:             schema.users.slug,
        notifyOnReferral: schema.users.notifyOnReferral,
        notifyOnReport:   schema.users.notifyOnReport,
        notifyOnPaid:     schema.users.notifyOnPaid,
    })
        .from(schema.users)
        .where(eq(schema.users.id, user.sub))
        .get();
    if (!row) return c.redirect('/login');
    // UC-A-6 — load inspector links so the ⌘K palette has "Copy booking link"
    // actions on the settings page as well.
    const inspectors = await c.var.services.agent.listInspectors(user.sub);
    return c.html(AgentSettingsProfilePage({
        ...(branding ? { branding } : {}),
        agent: {
            name:             row.name,
            email:            row.email,
            slug:             row.slug,
            notifyOnReferral: row.notifyOnReferral,
            notifyOnReport:   row.notifyOnReport,
            notifyOnPaid:     row.notifyOnPaid,
        },
        inspectors,
        bookingHost: c.req.header('host') || 'localhost',
    }));
});
app.get('/templates', htmlAuthGuard(['owner', 'admin']), (c) => c.html(TemplatesPage({ branding: c.get('branding') })));
app.get('/templates/:id/edit', htmlAuthGuard(['owner', 'admin']), (c) => {
    const id = c.req.param('id') as string;
    return c.html(TemplateEditorPage({ templateId: id, branding: c.get('branding') }));
});
app.get('/marketplace', htmlAuthGuard(['owner', 'admin']), (c) => c.html(MarketplacePage({ branding: c.get('branding') })));
// Sprint 2 S2-1 — Library / Rating Systems CRUD page replaces the Sprint 1 stub.
app.get('/library/rating-systems', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => c.html(RatingSystemsPage({ branding: c.get('branding') })));
// Sprint 3 S3-3 — Library → Tags CRUD page (mounts above the inspection-edit
// T-key picker; both share the same /api/tags backend).
app.get('/library/tags', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => c.html(TagsPage({ branding: c.get('branding') })));
// Settings hub (group cards)
app.get('/settings', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsPage({ branding: c.get('branding') })));

// Profile group (single sub-page; group page IS the sub-page)
// Booking #7 Sprint A — inspectors can also visit /settings/profile to set
// their booking slug, so the role guard now includes 'inspector'. We also
// resolve the current slug + tenant subdomain server-side so the slug card
// can render without a flash of "no slug" state.
app.get('/settings/profile', htmlAuthGuard(['owner', 'admin', 'inspector']), async (c) => {
    const branding = c.get('branding');
    const tenantId = c.get('tenantId');
    const userId = c.get('user')?.sub;
    const db = drizzle(c.env.DB);
    const [userRow, tenantRow] = await Promise.all([
        // Sprint B-4b — fetch the full identity card so the "My email signature"
        // preview can render. Slug stays the only field the slug card needs;
        // the rest powers the signature card client-side.
        userId
            ? db.select({
                slug:          schema.users.slug,
                name:          schema.users.name,
                email:         schema.users.email,
                phone:         schema.users.phone,
                licenseNumber: schema.users.licenseNumber,
                // Sprint C-1 — public profile fields used by the new editor.
                bio:           schema.users.bio,
                photoUrl:      schema.users.photoUrl,
                serviceAreas:  schema.users.serviceAreas,
            }).from(schema.users)
                .where(and(eq(schema.users.id, userId), eq(schema.users.tenantId, tenantId)))
                .get()
            : Promise.resolve(null),
        tenantId
            ? db.select({ subdomain: schema.tenants.subdomain }).from(schema.tenants)
                .where(eq(schema.tenants.id, tenantId))
                .get()
            : Promise.resolve(null),
    ]);
    // Sprint C-1 — parse persisted serviceAreas JSON for the editor. Defensive
    // try/catch keeps a malformed blob from breaking the whole settings page.
    let parsedAreas: Array<{ city: string; state: string; zip: string }> = [];
    if (userRow?.serviceAreas) {
        try {
            const parsed = JSON.parse(userRow.serviceAreas);
            if (Array.isArray(parsed)) {
                parsedAreas = parsed.filter((a) =>
                    a && typeof a === 'object' && typeof a.city === 'string' && typeof a.state === 'string' && typeof a.zip === 'string',
                );
            }
        } catch { /* malformed blob — render empty list */ }
    }
    return c.html(SettingsProfilePage({
        ...(branding ? { branding } : {}),
        currentSlug: userRow?.slug ?? null,
        tenantSubdomain: tenantRow?.subdomain ?? '',
        currentUser: userRow ? {
            name:          userRow.name,
            email:         userRow.email,
            phone:         userRow.phone,
            licenseNumber: userRow.licenseNumber,
        } : null,
        currentProfile: userRow ? {
            bio:          userRow.bio,
            photoUrl:     userRow.photoUrl,
            serviceAreas: parsedAreas,
        } : null,
    }));
});

// Workspace group
app.get('/settings/workspace', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/workspace/branding'));
app.get('/settings/workspace/branding', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsWorkspacePage({ branding: c.get('branding'), subPage: 'branding' })));
app.get('/settings/workspace/theme', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsWorkspacePage({ branding: c.get('branding'), subPage: 'theme' })));
// Sprint 2 S2-4 — Reports sub-page hosts the "Show estimate ranges" toggle.
// We resolve the persisted value via the BrandingService so the checkbox
// reflects state on first paint without a flash.
app.get('/settings/workspace/reports', htmlAuthGuard(['owner', 'admin']), async (c) => {
    const tenantId = c.get('tenantId');
    const cfg = await c.var.services.branding.getBranding(tenantId, {
        siteName: c.env.APP_NAME || 'OpenInspection',
        primaryColor: c.env.PRIMARY_COLOR || '#4f46e5',
        supportEmail: c.env.SENDER_EMAIL || 'support@example.com',
    });
    const showEstimates              = Boolean((cfg as { showEstimates?: boolean | number }).showEstimates);
    const enableRepairList           = Boolean((cfg as { enableRepairList?: boolean | number }).enableRepairList);
    const enableCustomerRepairExport = Boolean((cfg as { enableCustomerRepairExport?: boolean | number }).enableCustomerRepairExport);
    // Round-2 #10 — surface tenant-wide block-report policy so the toggles
    // hydrate with persisted state on first paint (no off-then-on flash).
    const blockUnpaid                = Boolean((cfg as { blockUnpaid?: boolean | number }).blockUnpaid);
    const blockUnsignedAgreement     = Boolean((cfg as { blockUnsignedAgreement?: boolean | number }).blockUnsignedAgreement);
    // Migration 0059 — Workers Paid PDF pipeline opt-in.
    const enablePdfPipeline          = Boolean((cfg as { enablePdfPipeline?: boolean | number }).enablePdfPipeline);
    return c.html(SettingsWorkspacePage({ branding: c.get('branding'), subPage: 'reports', showEstimates, enableRepairList, enableCustomerRepairExport, blockUnpaid, blockUnsignedAgreement, enablePdfPipeline }));
});
// Round-2 backlog G3 — Custom referral sources sub-page. Reads
// tenant_configs.custom_referral_sources via the BrandingService so the
// textarea hydrates with the saved values on first paint.
app.get('/settings/workspace/referral', htmlAuthGuard(['owner', 'admin']), async (c) => {
    const tenantId = c.get('tenantId');
    let customReferralSources: string[] | undefined;
    try {
        const cfg = await drizzle(c.env.DB).select({ customReferralSources: schema.tenantConfigs.customReferralSources })
            .from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, tenantId))
            .get();
        const raw = cfg?.customReferralSources;
        if (Array.isArray(raw)) customReferralSources = raw as string[];
    } catch { /* default empty */ }
    return c.html(SettingsWorkspacePage({
        branding: c.get('branding'),
        subPage: 'referral',
        ...(customReferralSources ? { customReferralSources } : {}),
    }));
});
app.get('/settings/workspace/telemetry', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsWorkspacePage({ branding: c.get('branding'), subPage: 'telemetry' })));

// Catalog group
app.get('/settings/catalog', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/catalog/services'));
app.get('/settings/catalog/services', htmlAuthGuard(['owner', 'admin']), (c) => {
    const b = c.get('branding');
    return c.html(SettingsServicesPage(b ? { branding: b } : {}));
});
app.get('/settings/catalog/event-types', htmlAuthGuard(['owner', 'admin']), (c) => {
    const b = c.get('branding');
    return c.html(SettingsEventTypesPage(b ? { branding: b } : {}));
});
app.get('/settings/catalog/widget', htmlAuthGuard(['owner', 'admin']), (c) => {
    const b = c.get('branding');
    // Sprint C-4 — pass slug + bookingHost so the personal-snippet generator
    // can render. Both come from the inspectorPaletteMiddleware that already
    // populates branding for the ⌘K palette.
    return c.html(SettingsWidgetPage({
        ...(b ? { branding: b } : {}),
        currentUserSlug: b?.currentUserSlug ?? null,
        bookingHost: b?.bookingHost ?? '',
        tenantSubdomain: c.get('requestedSubdomain') ?? null,
    }));
});
// Agent Accounts A3 — concierge toggle.
app.get('/settings/catalog/booking', htmlAuthGuard(['owner', 'admin']), async (c) => {
    const b = c.get('branding');
    const tenantId = c.get('tenantId');
    let conciergeReviewRequired = false;
    if (tenantId) {
        try {
            const db = drizzle(c.env.DB);
            const row = await db.select({ flag: schema.tenantConfigs.conciergeReviewRequired })
                .from(schema.tenantConfigs)
                .where(eq(schema.tenantConfigs.tenantId, tenantId))
                .get();
            conciergeReviewRequired = !!row?.flag;
        } catch (err) {
            logger.warn('settings.booking.config.failed', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return c.html(SettingsCatalogBookingPage({
        ...(b ? { branding: b } : {}),
        tenantConfig: { conciergeReviewRequired },
    }));
});

// Communication group
app.get('/settings/communication', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/communication/email'));
app.get('/settings/communication/email', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsCommunicationPage({ branding: c.get('branding'), subPage: 'email' })));
app.get('/settings/communication/automations', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsAutomationsPage({ branding: c.get('branding') })));
app.get('/settings/communication/calendar', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsCommunicationPage({ branding: c.get('branding'), subPage: 'calendar' })));
app.get('/settings/communication/integrations', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsCommunicationPage({ branding: c.get('branding'), subPage: 'integrations' })));

// Integrations group
app.get('/settings/integrations', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsIntegrationsPage({ branding: c.get('branding') })));
// Design System 0520 subsystem E P6 — IntegrationGrid (M22) at a
// distinct path so the existing per-integration settings page stays
// the default for legacy in-bound links.
app.get('/settings/integrations-grid', htmlAuthGuard(['owner', 'admin']), (c) => {
    const b = c.get('branding');
    return c.html(IntegrationsGridPage(b ? { branding: b } : {}));
});
app.get('/settings/integrations/qbo', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsIntegrationsQBOPage({ branding: c.get('branding') })));

// Account group (per-user, all roles allowed)
app.get('/settings/account', htmlAuthGuard(), (c) => c.redirect('/settings/account/password'));
app.get('/settings/account/password', htmlAuthGuard(), (c) => c.html(SettingsAccountPage({ branding: c.get('branding'), subPage: 'password' })));
app.get('/settings/account/security', htmlAuthGuard(), (c) => {
    const b = c.get('branding');
    return c.html(SettingsSecurityPage(b ? { branding: b } : {}));
});
app.get('/settings/account/bot-protection', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsAccountPage({ branding: c.get('branding'), subPage: 'bot-protection' })));

// Design System 0520 subsystem C P9 — read-only seat-quota + billing
// portal CTA. Owner/admin only — non-admins don't see billing UI.
app.get('/settings/billing', htmlAuthGuard(['owner', 'admin']), (c) => {
    const b = c.get('branding');
    const p = c.var.profile;
    // The page's three modes (standalone / saas-silo / saas-shared) are
    // entirely driven by the deployment profile; we pass through the two
    // flags the page actually branches on so the template stays a pure
    // function of props.
    return c.html(SettingsBillingPage({
        ...(b ? { branding: b } : {}),
        hasBilling:   p.hasBilling,
        hasSeatQuota: p.hasSeatQuota,
        saasTopology: p.saasTopology ?? null,
    }));
});

// Advanced group
app.get('/settings/advanced', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/advanced/payments'));
app.get('/settings/advanced/payments', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsAdvancedPage({ branding: c.get('branding'), subPage: 'payments' })));
app.get('/settings/advanced/ai', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsAdvancedPage({ branding: c.get('branding'), subPage: 'ai' })));
app.get('/settings/advanced/data', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsDataPage({ branding: c.get('branding') })));

// Deep-link aliases — preserve old URLs that might be bookmarked or hard-coded in JS
app.get('/settings/services', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/catalog/services'));
app.get('/settings/event-types', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/catalog/event-types'));
app.get('/settings/widget', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/catalog/widget'));
app.get('/settings/automations', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/communication/automations'));
// Spec 4A — TOTP 2FA settings page (per-user, all roles allowed).
app.get('/settings/security', htmlAuthGuard(), (c) => c.redirect('/settings/account/security'));
app.get('/settings/data', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/advanced/data'));
app.get('/metrics', htmlAuthGuard(['owner', 'admin']), (c) => c.html(MetricsPage({ branding: c.get('branding') })));
// Sprint 1 Sub-spec B Task 2 — Team relocates under Settings.
// Old /team URL kept as a 301 redirect so deep links from other tabs still work.
app.get('/settings/team', htmlAuthGuard(['owner', 'admin']), async (c) => {
    const branding = c.get('branding');
    const tenantId = c.get('tenantId');
    // PR 3 Task 4 — seat-quota banner on team page mirrors the dashboard
    // wiring. The team page is where invite blocks actually surface, so the
    // banner is most actionable here.
    const seatProps = c.var.profile.hasSeatQuota && tenantId
        ? {
              seatUsage: await getSeatUsage(tenantId, c.env.DB),
              billingPortalUrl: c.var.profile.billingPortalUrl,
          }
        : {};
    return c.html(TeamPage({ ...(branding ? { branding } : {}), ...seatProps }));
});
app.get('/team', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/team', 301));
// Design System 0520 subsystem C P3 — mentor-facing apprentice review queue.
// PreflightChecks (publish modal) and the Apprentices side-rail link in here.
app.get('/apprentice-review', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const branding = c.get('branding');
    return c.html(ApprenticeReviewPage(branding ? { branding } : {}));
});
app.get('/agreements', htmlAuthGuard(['owner', 'admin', 'agent']), (c) => c.html(AgreementsPage({ branding: c.get('branding') })));
app.get('/contacts', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => c.html(ContactsPage({ branding: c.get('branding') })));
app.get('/recommendations', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const b = c.get('branding');
    return c.html(RecommendationsPage(b ? { branding: b } : {}));
});
app.get('/comments', htmlAuthGuard(['owner', 'admin']), (c) => {
    const b = c.get('branding');
    return c.html(CommentsPage(b ? { branding: b } : {}));
});
app.get('/invoices', htmlAuthGuard(['owner', 'admin']), (c) => c.html(InvoicesPage({ branding: c.get('branding') })));
app.get('/calendar', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => c.html(CalendarPage({ branding: c.get('branding') })));
app.get('/notifications', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const b = c.get('branding');
    return c.html(NotificationsPage(b ? { branding: b } : {}));
});

// Field Inspection Form
app.get('/inspections/:id/form', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const id = c.req.param('id');
    const branding = c.get('branding');
    if (!id) return c.redirect('/dashboard');
    return c.html(FormRendererPage({ inspectionId: id, branding }));
});

// Inspection sub-routes (Sprint 2 S2-5).
//
// `/edit` is preserved as a 302 redirect to `/report` for backward
// compatibility with bookmarks and existing JS that still constructs the
// legacy URL. The primary surface is:
//   /inspections/:id/report     — single-view editor (inspection-edit)
//
// All ancillary tabs were retired in the design-alignment rollback and
// folded back into the editor:
//   - Summary    → editor's Preview link (renders /api/inspections/:id/report)
//   - Photos     → slide-over sheet, triggered by toolbar Photos button
//   - Signatures → collapsible block at the bottom of PublishModal
//   - Settings   → slide-over sheet, triggered by toolbar gear button
// /inspections/:id/settings still 302s to /report so external links
// don't break.
//
// All sub-routes share <InspectionShell> for sub-nav + breadcrumb. The Report
// tab keeps the existing BareLayout-based editor untouched so the Alpine
// sticky header and full-canvas drawing surface continue to work.
async function loadInspectionShellData(c: Context<HonoConfig>, inspectionId: string) {
    const tenantId = c.get('tenantId');
    if (!tenantId) return null;
    try {
        const insp = await c.var.services.inspection.getInspection(inspectionId, tenantId);
        const propertyAddress = insp.inspection.propertyAddress || 'Inspection';
        const parent = await c.var.services.inspectionRequest.getByInspectionId(tenantId, inspectionId);
        let siblings: Array<{ id: string; templateName: string; status: string }> | undefined;
        let requestId: string | undefined;
        if (parent && parent.inspections.length > 1) {
            requestId = parent.id;
            // Look up template names for siblings (best-effort — falls back to id).
            const tplIds = Array.from(new Set(parent.inspections.map(i => i.templateId).filter((x): x is string => !!x)));
            const tplNameById = new Map<string, string>();
            if (tplIds.length > 0) {
                const db = drizzle(c.env.DB);
                const rows = await db.select({ id: schema.templates.id, name: schema.templates.name })
                    .from(schema.templates)
                    .where(and(eq(schema.templates.tenantId, tenantId), tplIds.length === 1
                        ? eq(schema.templates.id, tplIds[0]!)
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        : (await import('drizzle-orm')).inArray(schema.templates.id, tplIds as any)))
                    .all();
                rows.forEach(r => tplNameById.set(r.id, r.name));
            }
            siblings = parent.inspections.map(i => ({
                id: i.id,
                templateName: (i.templateId && tplNameById.get(i.templateId)) || 'Inspection',
                status: i.status,
            }));
        }
        // Track E1 — per-tenant Repair List toggle drives the 6th sub-nav
        // tab. Failure to read defaults to false so the existing 5-tab nav
        // stays the baseline.
        // Round-2 backlog G3 — `customReferralSources` extends the seven
        // seed referral labels on the inspection settings dropdown.
        let enableRepairList = false;
        let customReferralSources: string[] | undefined;
        try {
            const cfgRow = await drizzle(c.env.DB).select({
                enableRepairList:      schema.tenantConfigs.enableRepairList,
                customReferralSources: schema.tenantConfigs.customReferralSources,
            }).from(schema.tenantConfigs)
              .where(eq(schema.tenantConfigs.tenantId, tenantId))
              .get();
            enableRepairList = !!cfgRow?.enableRepairList;
            const raw = cfgRow?.customReferralSources;
            if (Array.isArray(raw)) customReferralSources = raw as string[];
        } catch { /* default off */ }
        return { propertyAddress, requestId, siblings, enableRepairList, customReferralSources };
    } catch {
        return null;
    }
}

app.get('/inspections/:id/edit', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const id = c.req.param('id');
    if (!id) return c.redirect('/dashboard');
    return c.redirect(`/inspections/${id}/report`, 302);
});

app.get('/inspections/:id/report', htmlAuthGuard(['owner', 'admin', 'inspector']), async (c) => {
    const id = c.req.param('id');
    if (!id) return c.redirect('/dashboard');
    // Track E1 — surface the per-tenant Repair List toggle so the editor's
    // sub-nav optionally renders the 6th tab.
    // Round-2 G3 — also read customReferralSources for the settings sheet's
    // Referral Source dropdown (merged with the seven seeds in the sheet).
    const tenantId = c.get('tenantId');
    let enableRepairList = false;
    let customReferralSources: string[] | undefined;
    if (tenantId) {
        try {
            const cfgRow = await drizzle(c.env.DB).select({
                enableRepairList:      schema.tenantConfigs.enableRepairList,
                customReferralSources: schema.tenantConfigs.customReferralSources,
            })
                .from(schema.tenantConfigs)
                .where(eq(schema.tenantConfigs.tenantId, tenantId))
                .get();
            enableRepairList = !!cfgRow?.enableRepairList;
            const raw = cfgRow?.customReferralSources;
            if (Array.isArray(raw)) customReferralSources = raw as string[];
        } catch { /* default off */ }
    }
    return c.html(InspectionEditPage({
        inspectionId: id,
        branding: c.get('branding'),
        enableRepairList,
        ...(customReferralSources ? { customReferralSources } : {}),
    }));
});

// Design-alignment B+C — /inspections/:id/settings is no longer a
// standalone tab; the settings form is folded into a slide-over on the
// editor. Redirect any deep links to /report so users land on the
// editor (where the gear button opens the settings sheet).
app.get('/inspections/:id/settings', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const id = c.req.param('id');
    if (!id) return c.redirect('/dashboard');
    return c.redirect(`/inspections/${id}/report`, 302);
});


// Track E1 (ITB §11, UC-ITB-07) — Repair List sub-route. Server-renders
// the punch-list of every flagged defect across the inspection. Available
// only when the tenant has opted in via Settings → Workspace → Reports;
// otherwise the route 404s so it cannot be deep-linked accidentally.
app.get('/inspections/:id/repair-list', htmlAuthGuard(['owner', 'admin', 'inspector']), async (c) => {
    const id = c.req.param('id');
    if (!id) return c.redirect('/dashboard');
    const tenantId = c.get('tenantId');
    if (!tenantId) return c.redirect('/dashboard');

    const shell = await loadInspectionShellData(c, id);

    // Gate on the tenant toggle so an admin can't deep-link past the opt-in.
    // Iter-2 Bug #13 — replaced the generic 404 with a friendly disabled-feature
    // page so admins/inspectors are told WHY (toggle is off) and HOW to enable
    // it (deep-link CTA to Settings → Workspace → Reports).
    if (!shell?.enableRepairList) {
        return c.html(
            FeatureDisabledPage({ from: 'repair-list', branding: c.get('branding') }),
            403,
        );
    }
    try {
        const data = await c.var.services.inspection.getRepairList(id, tenantId);
        const rawDate = data.inspection.date || '';
        const formattedDate = rawDate ? new Date(rawDate).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        }) : null;
        return c.html(RepairListPage({
            inspectionId:    id,
            propertyAddress: shell?.propertyAddress ?? data.inspection.propertyAddress ?? 'Inspection',
            inspectionDate:  formattedDate,
            inspectorName:   data.inspection.inspectorName,
            defects:         data.defects,
            totals:          data.totals,
            showEstimates:   data.showEstimates,
            branding:        c.get('branding'),
        }));
    } catch {
        return c.html(NotFoundPage({ branding: c.get('branding') }), 404);
    }
});

app.get('/', (c) => c.redirect('/dashboard'));

// Sprint 1 C-2 — global catch-all 404. API requests under /api/* fall back
// to the JSON error middleware (handled by app.onError when a route throws);
// HTML requests get the styled NotFoundPage.
app.notFound((c) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith('/api/')) {
        return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
    }
    return c.html(NotFoundPage({ branding: c.get('branding') }), 404);
});

// CF Workers ESM expects { fetch, scheduled } on the default export.
// Named exports of `scheduled` aren't recognized by the runtime —
// without this `Handler does not export a scheduled() function` fires
// on every cron tick and the automation flush never runs.
import { scheduled as baseScheduled } from './scheduled';
export default {
    fetch: app.fetch.bind(app),
    scheduled: async (event: ScheduledEvent, env: HonoConfig['Bindings'], ctx: ExecutionContext) => {
        await baseScheduled(event, env, ctx);
    },
};
export { SignCompletionWorkflow } from './workflows/sign-completion-workflow';

// Design System 0520 subsystem B phase 2 — presence Durable Objects.
// wrangler needs them re-exported from the entrypoint so it can discover
// the class names referenced by [[durable_objects.bindings]] in wrangler.toml.
export { InspectionPresenceDO } from './durable-objects/inspection-presence';
export { TenantPresenceDO     } from './durable-objects/tenant-presence';

// Exported for the route-metadata vitest gate; OpenAPIHono.getOpenAPIDocument()
// inspects the doc without needing a live request.
export { app };
