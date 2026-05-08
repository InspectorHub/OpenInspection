import { OpenAPIHono } from '@hono/zod-openapi';
import { Context } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { deleteCookie, getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, asc } from 'drizzle-orm';
import { users } from './lib/db/schema';
import * as schema from './lib/db/schema';

import { brandingMiddleware } from './lib/middleware/branding';
import { tenantRouter } from './lib/middleware/tenant-router';
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

import { LoginPage } from './templates/pages/login';
import { DashboardPage } from './templates/pages/dashboard';
import { ReportsPage } from './templates/pages/reports';
import { SettingsPage } from './templates/pages/settings';
import { PublicBookingPage } from './templates/pages/booking';
import { FormRendererPage } from './templates/pages/form-renderer';
import { AgentDashboardPage } from './templates/pages/agent-dashboard';
import { TemplatesPage } from './templates/pages/templates';
import { TemplateEditorPage } from './templates/pages/template-editor';
import { MarketplacePage } from './templates/pages/marketplace';
import { TeamPage } from './templates/pages/team';
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
import { SetupPage } from './templates/pages/setup';
import { ReportCardStackPage } from './templates/pages/report-card-stack';
import { InspectionEditPage } from './templates/pages/inspection-edit';
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


import coreAuthRoutes from './api/auth';
import integrationRoutes from './api/integration';
import inspectionsRoutes from './api/inspections';
import aiRoutes from './api/ai';
import bookingsRoutes from './api/bookings';
import adminRoutes from './api/admin';
import agentRoutes from './api/agent';
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
import dataRoutes from './api/data';
import icsRoutes from './api/ics';
import userRoutes from './api/users';
import messageRoutes from './api/messages';
import widgetRoutes from './api/widget';
import notificationsRoutes from './api/notifications';
import inspectionSyncRoutes from './api/inspection-sync';
import recommendationsRoutes from './api/recommendations';
import eventsRoutes from './api/events';

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

// Global Middlewares
app.use('*', securityHeaders);
app.use('*', diMiddleware);
app.use('*', tenantRouter);
app.use('*', brandingMiddleware);

// Static asset extensions — these bypass JWT verification. We use a strict allowlist
// rather than path.includes('.') so a dot inside a path segment (e.g. "/inspections/foo.bar")
// can't trick the middleware into treating a protected route as public.
const STATIC_ASSET_EXT = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|json|txt|pdf)$/i;

// Global JWT Middleware — extracts tenantId / userRole from Bearer token or cookie.
app.use('*', async (c, next) => {
    const path = c.req.path;
    const isAuthPublic = path === '/api/auth/login' || path === '/api/auth/register' || path === '/api/auth/setup' || path === '/api/auth/login/2fa';
    const isPublic = path.startsWith('/api/public/') || path.startsWith('/api/integration/') || path.startsWith('/api/ics/') || path.startsWith('/api/messages/public/') || path === '/book' || path === '/widget.js' || path === '/' || path === '/status' || path.startsWith('/static/') || path.startsWith('/report/') || path.startsWith('/agreements/sign/') || path.startsWith('/messages/') || path.startsWith('/m2m/') || path.startsWith('/verify/') || STATIC_ASSET_EXT.test(path);

    if (isAuthPublic || isPublic || path === '/setup' || path === '/login' || path === '/join' || path.startsWith('/agreements/sign/')) return next();

    // Generate setup code if system is uninitialized and we are in standalone
    if (c.env.APP_MODE === 'standalone' && c.env.TENANT_CACHE) {
        // Prefer explicit environment variable if set by user during deployment
        const storedCode = c.env.SETUP_CODE || await c.env.TENANT_CACHE.get('setup_verification_code');

        if (!storedCode) {
            const db = drizzle(c.env.DB);
            const user = await db.select().from(users).limit(1).get();
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
             const user = await db.select().from(users).limit(1).get();
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

    // Fail closed if the signing key is missing or too weak to meaningfully resist offline brute force.
    if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32) {
        logger.error('JWT_SECRET is missing or shorter than 32 characters; refusing to verify tokens');
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

        const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
        const tenantId = (payload['custom:tenantId'] ?? payload['tenantId']) as string | undefined;
        const userRole = (payload['custom:userRole'] ?? payload['role']) as string | undefined;
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

        if (tenantId) c.set('tenantId', tenantId);
        if (userRole) c.set('userRole', userRole as UserRole);

        // Populate the per-request user context. Email is intentionally not carried in the JWT
        // anymore — routes that need it (e.g. /me) look it up from the DB.
        if (userRole) {
            c.set('user', {
                sub: payload.sub as string,
                role: userRole as UserRole,
                tenantId: tenantId as string
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
    if (c.env.APP_MODE === 'saas') {
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

// API Routes
app.use('/api/*', requireActiveSubscription);

// Module Routes
// Mount auth routes at canonical API path AND at root so that /setup, /login (POST), /join (POST) work without redirects
app.route('/api/auth', coreAuthRoutes);
app.route('/', coreAuthRoutes);
app.route('/api/inspections', inspectionsRoutes);
app.route('/api/inspections', inspectionSyncRoutes);
app.route('/api/ai', aiRoutes);
app.route('/api/public', bookingsRoutes);
app.route('/api/public/widget', widgetRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/agent', agentRoutes);
app.route('/api/places', placesRoutes);
app.route('/api/availability', availabilityRoutes);
// Mount /api/calendar/events BEFORE /api/calendar so the more-specific path takes precedence.
app.route('/api/calendar/events', calendarEventsRoutes);
app.route('/api/calendar', calendarRoutes);
app.route('/api/team', teamRoutes);
app.route('/api/contacts', contactRoutes);
app.route('/api/recommendations', recommendationsRoutes);
app.route('/api', eventsRoutes);
app.route('/api/invoices', invoiceRoutes);
app.route('/api/services', servicesRoutes);
app.route('/api/automations', automationsRoutes);
app.route('/api/metrics', metricsRoutes);
app.route('/api/templates/marketplace', marketplaceRoutes);
app.route('/api/data', dataRoutes);
app.route('/api/integration', integrationRoutes);
app.route('/api/ics', icsRoutes);
app.route('/api/users', userRoutes);
app.route('/api/messages', messageRoutes);
app.route('/api/notifications', notificationsRoutes);

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
            return c.redirect('/dashboard?error=unauthorized_role');
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
    // If user is already authenticated, redirect to dashboard
    const token = getCookie(c, '__Host-inspector_token');
    if (token && c.env.JWT_SECRET) {
        try {
            await verify(token, c.env.JWT_SECRET, 'HS256');
            return c.redirect('/dashboard');
        } catch {
            // Invalid/expired token — show login page
        }
    }
    // Issue the CSRF cookie before rendering so the form's submit handler can echo it back.
    issueCsrfCookie(c);
    const branding = c.get('branding');
    return c.html(LoginPage({ branding }));
});

app.get('/setup', (c) => {
    return c.html(SetupPage({ branding: c.get('branding') }));
});


app.get('/book', (c) => {
    const branding = c.get('branding');
    const embedRaw = c.req.query('embed');
    const styleRaw = c.req.query('style') || 'light';
    const embed = embedRaw === '1';
    const style: 'light' | 'dark' | 'branded' =
        styleRaw === 'dark' || styleRaw === 'branded' ? styleRaw as 'dark' | 'branded' : 'light';
    return c.html(PublicBookingPage({
        siteKey: c.env.TURNSTILE_SITE_KEY,
        ...(branding ? { branding } : {}),
        embed,
        style,
    }));
});

// Public agreement signing page (no auth required — token is the secret)
app.get('/agreements/sign/:token', async (c) => {
    const token = c.req.param('token') as string;
    const branding = c.get('branding');
    try {
        const svc = c.var.services.agreement;
        const { request, agreement } = await svc.getAgreementByToken(token);
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
        return c.text('Agreement not found or link has expired.', 404);
    }
});

// Spec 5H P1 — Internal render route consumed by SignCompletionWorkflow.
// Auth model: token IS the secret (256-bit hex from createSigningRequest).
// Originally M2M-authed via Bearer JWT_SECRET, but CF Browser Rendering
// doesn't forward custom Authorization headers reliably -> 404. The token
// itself is unguessable, so its secrecy is sufficient (same model as the
// public /agreements/sign/{token} route).
app.get('/m2m/agreement-render/:token', async (c) => {
    const token = c.req.param('token') as string;
    try {
        const { request, agreement } = await c.var.services.agreement.getAgreementByToken(token);

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
    return { reqRow, agreement, auditRows, verify, pubKey };
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
    return c.redirect(`/agreements/sign/${data.reqRow.token}`, 302);
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

// Public report page (no auth required)
app.get('/report/:id', async (c) => {
    const id = c.req.param('id') as string;
    const tenantId = c.get('tenantId') || c.get('resolvedTenantId');
    if (!tenantId) return c.text('Not found', 404);

    // Spec 5A.3 — ?summary=1 filters to defects-only (used by PDF Summary
    // renderer). ?print=1 already supported by main-layout (hides nav).
    const summaryMode = c.req.query('summary') === '1';

    try {
        const service = c.var.services.inspection;
        const data = await service.getReportData(id, tenantId as string);

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
        }));
    } catch {
        return c.text('Report not found', 404);
    }
});

// Phase T (T24) — Public client messages page (token-gated, no JWT)
app.get('/messages/:token', (c) => {
    const token = c.req.param('token') as string;
    return c.html(MessagesPublicPage({ token, branding: c.get('branding') }));
});

// Pages with Auth
app.get('/dashboard', htmlAuthGuard(), (c) => c.html(DashboardPage({ branding: c.get('branding') })));
app.get('/reports', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const b = c.get('branding');
    return c.html(ReportsPage(b ? { branding: b } : {}));
});
app.get('/agent-dashboard', htmlAuthGuard(['agent']), (c) => c.html(AgentDashboardPage({ branding: c.get('branding') })));
app.get('/templates', htmlAuthGuard(['owner', 'admin']), (c) => c.html(TemplatesPage({ branding: c.get('branding') })));
app.get('/templates/:id/edit', htmlAuthGuard(['owner', 'admin']), (c) => {
    const id = c.req.param('id') as string;
    return c.html(TemplateEditorPage({ templateId: id, branding: c.get('branding') }));
});
app.get('/marketplace', htmlAuthGuard(['owner', 'admin']), (c) => c.html(MarketplacePage({ branding: c.get('branding') })));
// Settings hub (group cards)
app.get('/settings', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsPage({ branding: c.get('branding') })));

// Profile group (single sub-page; group page IS the sub-page)
app.get('/settings/profile', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsProfilePage({ branding: c.get('branding') })));

// Workspace group
app.get('/settings/workspace', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/workspace/branding'));
app.get('/settings/workspace/branding', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsWorkspacePage({ branding: c.get('branding'), subPage: 'branding' })));
app.get('/settings/workspace/theme', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsWorkspacePage({ branding: c.get('branding'), subPage: 'theme' })));
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
    return c.html(SettingsWidgetPage(b ? { branding: b } : {}));
});

// Communication group
app.get('/settings/communication', htmlAuthGuard(['owner', 'admin']), (c) => c.redirect('/settings/communication/email'));
app.get('/settings/communication/email', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsCommunicationPage({ branding: c.get('branding'), subPage: 'email' })));
app.get('/settings/communication/automations', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsAutomationsPage({ branding: c.get('branding') })));
app.get('/settings/communication/calendar', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsCommunicationPage({ branding: c.get('branding'), subPage: 'calendar' })));
app.get('/settings/communication/integrations', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsCommunicationPage({ branding: c.get('branding'), subPage: 'integrations' })));

// Account group (per-user, all roles allowed)
app.get('/settings/account', htmlAuthGuard(), (c) => c.redirect('/settings/account/password'));
app.get('/settings/account/password', htmlAuthGuard(), (c) => c.html(SettingsAccountPage({ branding: c.get('branding'), subPage: 'password' })));
app.get('/settings/account/security', htmlAuthGuard(), (c) => {
    const b = c.get('branding');
    return c.html(SettingsSecurityPage(b ? { branding: b } : {}));
});
app.get('/settings/account/bot-protection', htmlAuthGuard(['owner', 'admin']), (c) => c.html(SettingsAccountPage({ branding: c.get('branding'), subPage: 'bot-protection' })));

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
app.get('/team', htmlAuthGuard(['owner', 'admin']), (c) => c.html(TeamPage({ branding: c.get('branding') })));
app.get('/agreements', htmlAuthGuard(['owner', 'admin', 'agent']), (c) => c.html(AgreementsPage({ branding: c.get('branding') })));
app.get('/contacts', htmlAuthGuard(['owner', 'admin']), (c) => c.html(ContactsPage({ branding: c.get('branding') })));
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

// Inspection Edit Page - Inspector + Admin/Owner
app.get('/inspections/:id/edit', htmlAuthGuard(['owner', 'admin', 'inspector']), (c) => {
    const id = c.req.param('id');
    if (!id) return c.redirect('/dashboard');
    return c.html(InspectionEditPage({ inspectionId: id, branding: c.get('branding') }));
});

app.get('/', (c) => c.redirect('/dashboard'));

export default app;
export { scheduled } from './scheduled';
export { SignCompletionWorkflow } from './workflows/sign-completion-workflow';
